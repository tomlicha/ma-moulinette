import { IDLE_POWER_W } from '../domain/group/follow';
import type { GroupRef } from '../domain/group/group-pace';
import type { Workout } from '../domain/workout/model';
import type { GroupClosedReason, GroupMember, GroupState, GroupSummary, OnlineRider, ServerGroupMessage } from '../infra/net/group-protocol';
import { TypedEmitter } from '../shared/util/typed-emitter';

/** La part de la salle dont les groupes ont besoin (et rien de plus : c'est ce qu'un test doit simuler). */
export interface GroupWorld {
  who(q?: string): void;
  ping(clientMs: number): void;
  createGroup(workout: Workout, courseId: string, startInS: number, ref: GroupRef): void;
  joinGroup(id: string): void;
  leaveGroup(): void;
  routeGroup(leg: number, index: number): void;
}

/** Ce qu'il faut pour rouler la séance de groupe. */
export interface GroupPlan {
  id: string;
  name: string;
  workout: Workout;
  courseId: string;
  /** Le coureur dont le groupe prend l'allure : le créateur. */
  ref: GroupRef;
}

/** Qui est en ligne et quels groupes existent, d'après la dernière réponse de la salle. */
export interface OnlineDirectory {
  riders: readonly OnlineRider[];
  groups: readonly GroupSummary[];
  /** Coureurs trouvés, y compris ceux que la liste ne montre pas faute de place. */
  total: number;
}

/** Sans pédaler pendant ce temps, on sort du groupe, en s (docs/design/groupe.md, « Qui décroche »). */
export const GROUP_IDLE_LEAVE_S = 60;
/** Mesures de l'horloge commune, à la file au début, puis à cette cadence, en ms. */
const SYNC_BURST = 4;
const SYNC_BURST_GAP_MS = 250;
const SYNC_EVERY_MS = 30_000;
/** Sans réponse de l'horloge après ce temps, on part avec l'heure de l'appareil, en ms. */
const SYNC_GIVE_UP_MS = 2000;

/** Pourquoi on n'est plus dans le groupe. `missed` et `busy` : le départ est venu sans que le trainer soit prêt, ou en pleine sortie. */
export type GroupLeaveReason = 'manual' | 'self-stopped' | 'missed' | 'busy' | 'offline' | GroupClosedReason;
/** Quitter pour ces raisons-là vient de nous : la salle doit le savoir. Les autres, c'est elle qui l'a dit (ou la connexion est perdue). */
const OURS: readonly GroupLeaveReason[] = ['manual', 'self-stopped', 'missed', 'busy'];

export interface GroupSessionDeps {
  world: GroupWorld;
  /** Mon numéro dans la salle : c'est lui qui dit si je suis le créateur du groupe (`undefined` hors connexion). */
  selfSlot?: () => number | undefined;
  /** Heure de l'appareil, en ms (`Date.now`). */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/**
 * Le groupe dans lequel on est : séance, parcours, départ commun et membres, plus la liste de ceux qui sont en ligne.
 *
 * Une seule responsabilité : savoir **quel groupe, et quand c'est l'heure**. L'horloge commune est le temps du serveur,
 * estimé avec la mesure d'aller-retour la plus courte. Elle ne lance ni la sortie ni la séance : elle dit `go` au départ
 * (ou tout de suite si l'on arrive en retard) et la composition fait le reste.
 *
 * Événements : `changed` (le groupe, ses membres), `go` (c'est l'heure de rouler), `left` (on n'est plus dans le groupe,
 * et pourquoi), `online` (la liste des coureurs en ligne a changé).
 */
export class GroupSession extends TypedEmitter<{
  changed: [group: GroupState | undefined];
  go: [plan: GroupPlan];
  left: [reason: GroupLeaveReason, name: string];
  /** Le créateur a fait un choix de route : le trajet doit le relire. */
  routes: [];
  /** La salle a renvoyé l'état du groupe pour un recalage (`resync`) : rejouer la sortie avec tous les choix de route. */
  resync: [plan: GroupPlan];
  online: [directory: OnlineDirectory];
}> {
  private current?: GroupState;
  /** Un recalage est demandé : le prochain état du groupe lance le rejeu. */
  private resyncing = false;
  /** Les choix du créateur aux carrefours : rang de la route → option. */
  private routeChoices = new Map<number, number>();
  private offsetMs = 0;
  private bestRttMs = Infinity;
  private synced = false;
  private started = false;
  private idleS = 0;
  private goTimer: unknown;
  private syncTimer: unknown;
  private fallbackTimer: unknown;
  private directory: OnlineDirectory = { riders: [], groups: [], total: 0 };
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;

  constructor(private readonly deps: GroupSessionDeps) {
    super();
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as number));
  }

  /** Le groupe rejoint ; `undefined` hors groupe. */
  get group(): GroupState | undefined {
    return this.current;
  }

  /** La séance de groupe a démarré chez nous : on roule avec elle. */
  get running(): boolean {
    return this.current !== undefined && this.started;
  }

  get online(): OnlineDirectory {
    return this.directory;
  }

  /** L'heure du serveur, en ms. */
  serverNow(): number {
    return this.now() + this.offsetMs;
  }

  /** Temps écoulé depuis le départ du groupe, en ms (négatif avant). 0 hors groupe. */
  elapsedMs(): number {
    return this.current ? this.serverNow() - this.current.t0 : 0;
  }

  /** Temps écoulé depuis le départ du groupe, en s : l'horloge de la séance. */
  elapsedS(): number {
    return this.elapsedMs() / 1000;
  }

  /** Demande à la salle qui est en ligne (`q` : filtre sur le nom) et quels groupes existent. */
  refreshOnline(q = ''): void {
    this.deps.world.who(q);
  }

  /** Crée un groupe : `ref`, la FTP et la masse du créateur, fixe l'allure de tous. */
  create(workout: Workout, courseId: string, startInS: number, ref: GroupRef): void {
    this.deps.world.createGroup(workout, courseId, startInS, ref);
  }

  join(id: string): void {
    this.deps.world.joinGroup(id);
  }

  /** Quitte le groupe (à la main, ou parce qu'on ne pédale plus). */
  leave(reason: GroupLeaveReason = 'manual'): void {
    const g = this.current;
    if (!g) return;
    if (OURS.includes(reason)) this.deps.world.leaveGroup();
    this.reset();
    this.emit('changed', undefined);
    this.emit('left', reason, g.name);
  }

  /** La connexion à la salle est perdue : le serveur a oublié le groupe, on le quitte (la sortie reste la nôtre). */
  worldLost(): void {
    this.leave('offline');
  }

  /** Ce que la salle dit des groupes. */
  handle(msg: ServerGroupMessage): void {
    switch (msg.type) {
      case 'who':
        this.directory = { riders: msg.riders, groups: msg.groups, total: msg.total };
        this.emit('online', this.directory);
        return;
      case 'time':
        return this.onTime(msg.c, msg.s);
      case 'groupState':
        return this.enter(msg.group);
      case 'groupMembers':
        if (this.current?.id !== msg.id) return;
        this.current = { ...this.current, members: msg.members, leader: msg.leader };
        this.emit('changed', this.current);
        return;
      case 'groupRoute':
        if (!this.current) return;
        this.routeChoices.set(msg.leg, msg.index);
        this.emit('routes');
        return;
      case 'groupClosed':
        if (this.current?.id === msg.id) this.leave(msg.reason);
        else if (!this.current) this.emit('left', msg.reason, '');
        return;
    }
  }

  /** À chaque pas de la sortie en groupe : sans pédaler pendant `GROUP_IDLE_LEAVE_S`, on sort du groupe. */
  update(dtS: number, powerW: number): void {
    if (!this.running) return;
    this.idleS = powerW <= IDLE_POWER_W ? this.idleS + dtS : 0;
    if (this.idleS >= GROUP_IDLE_LEAVE_S) this.leave('self-stopped');
  }

  /**
   * Se recaler sur le groupe : on redemande son état à la salle, avec tous les choix de route faits (un message raté, un
   * onglet endormi). À son arrivée, `resync` dit de rejouer la sortie. Sans effet hors séance de groupe en cours.
   */
  resync(): void {
    if (!this.running || !this.current) return;
    this.resyncing = true;
    this.deps.world.joinGroup(this.current.id);
  }

  /** Les membres, soi compris. */
  members(): readonly GroupMember[] {
    return this.current?.members ?? [];
  }

  /** Je suis le créateur du groupe (ou le plus ancien membre s'il est parti) : je choisis la route aux carrefours. */
  get isLeader(): boolean {
    const me = this.deps.selfSlot?.();
    return this.current !== undefined && me !== undefined && this.current.leader === me;
  }

  /** Le nom du créateur du groupe. */
  get leaderName(): string | undefined {
    return this.current?.members.find((m) => m.slot === this.current?.leader)?.name;
  }

  /** Le choix du créateur pour la route numéro `leg` ; `undefined` : pas encore décidé. */
  routeFor(leg: number): number | undefined {
    return this.routeChoices.get(leg);
  }

  /** Le créateur choisit l'option `index` au carrefour qui précède la route `leg` (ignoré de tout autre). */
  decide(leg: number, index: number): void {
    if (this.isLeader) this.deps.world.routeGroup(leg, index);
  }

  private enter(group: GroupState): void {
    const changedGroup = this.current?.id !== group.id;
    if (changedGroup) {
      this.reset();
      this.current = group;
      this.routeChoices = new Map(group.routes);
      this.startSync();
    } else {
      // Le même groupe qui revient (recalage) : tous les choix de route sont à relire.
      this.current = group;
      for (const [leg, index] of group.routes) this.routeChoices.set(leg, index);
      if (this.resyncing) {
        this.resyncing = false;
        this.emit('routes');
        this.emit('resync', this.plan(group));
      }
    }
    this.emit('changed', this.current);
  }

  private reset(): void {
    this.clearTimer(this.goTimer);
    this.clearTimer(this.syncTimer);
    this.clearTimer(this.fallbackTimer);
    this.goTimer = this.syncTimer = this.fallbackTimer = undefined;
    this.current = undefined;
    this.resyncing = false;
    this.routeChoices = new Map();
    this.started = false;
    this.idleS = 0;
    this.synced = false;
    this.bestRttMs = Infinity;
  }

  /** Quelques mesures d'horloge à la file, puis régulièrement ; le départ attend la première (ou abandonne au bout de `SYNC_GIVE_UP_MS`). */
  private startSync(): void {
    const id = this.current?.id;
    for (let i = 0; i < SYNC_BURST; i++) {
      if (i === 0) this.deps.world.ping(this.now());
      else this.setTimer(() => this.current?.id === id && this.deps.world.ping(this.now()), i * SYNC_BURST_GAP_MS);
    }
    this.fallbackTimer = this.setTimer(() => {
      if (this.current?.id === id && !this.synced) this.schedule();
    }, SYNC_GIVE_UP_MS);
    this.syncTimer = this.setTimer(() => this.resyncClock(id), SYNC_EVERY_MS);
  }

  private resyncClock(id: string | undefined): void {
    if (!this.current || this.current.id !== id) return;
    this.deps.world.ping(this.now());
    this.syncTimer = this.setTimer(() => this.resyncClock(id), SYNC_EVERY_MS);
  }

  /** Une mesure : l'écart est celui de la meilleure (la plus courte) ; la première lance le décompte. */
  private onTime(clientMs: number, serverMs: number): void {
    if (!this.current) return;
    const rtt = this.now() - clientMs;
    if (rtt < 0 || rtt >= this.bestRttMs) return;
    this.bestRttMs = rtt;
    this.offsetMs = serverMs + rtt / 2 - this.now();
    this.synced = true;
    this.schedule();
  }

  /** (Re)programme le départ d'après l'horloge actuelle. En retard, ou à l'heure : `go` tout de suite, une seule fois. */
  private schedule(): void {
    const g = this.current;
    if (!g || this.started) return;
    this.clearTimer(this.goTimer);
    const wait = g.t0 - this.serverNow();
    if (wait <= 0) return this.go();
    this.goTimer = this.setTimer(() => this.schedule(), Math.min(wait, 1000));
  }

  private go(): void {
    const g = this.current;
    if (!g || this.started) return;
    this.started = true;
    this.emit('go', this.plan(g));
  }

  private plan(g: GroupState): GroupPlan {
    return { id: g.id, name: g.name, workout: g.workout, courseId: g.courseId, ref: { ftpW: g.ftpW, massKg: g.massKg } };
  }
}
