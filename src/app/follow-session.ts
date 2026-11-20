import { FollowTracker, type FollowEnd, type FollowPhase, type FollowSelf } from '../domain/group/follow';
import type { NetPosition } from '../domain/course/track';
import type { FollowEndReason, ServerGroupMessage } from '../infra/net/group-protocol';
import { TypedEmitter } from '../shared/util/typed-emitter';

/** Un coureur de la salle tel que le suivi le lit. */
export interface FollowedRider {
  slot: number;
  name: string;
  point: { x: number; z: number };
  speedMs: number;
  riding: boolean;
}

/** La part de la salle dont le suivi a besoin (et rien de plus : c'est ce qu'un test doit simuler). */
export interface FollowWorld {
  follow(slot: number): void;
  unfollow(): void;
  refuseFollower(slot: number): void;
  riders(): readonly FollowedRider[];
}

/**
 * Comment on a demandé à suivre. `place` : on rejoint depuis l'accueil, la sortie repart derrière le coureur.
 * `chase` : on roule déjà, on le rattrape sans changer de place (la distance du fichier FIT reste continue).
 */
export type FollowMode = 'place' | 'chase';

/** Ce que le suivi affiche : qui, où on en est, de combien. */
export interface FollowState {
  slot: number;
  name: string;
  /** `requesting` : en attente de la réponse de la salle. */
  phase: 'requesting' | FollowPhase;
  /** Écart signé en m (positif : il est devant) ; 0 tant qu'on ne le mesure pas. */
  gapM: number;
  gapS?: number;
  assist: number;
}

export type FollowStopReason = FollowEnd | FollowEndReason | 'manual' | 'offline';

export interface Follower {
  slot: number;
  name: string;
}

/**
 * Le suivi en cours : on a rejoint un coureur et on reste collé à lui (docs/design/groupe.md, section 3). Il tient le
 * registre de ceux qui nous suivent, parle à la salle, et applique les règles du domaine (`FollowTracker`) à chaque pas
 * de la sortie.
 *
 * Il ne fait avancer personne : il publie l'aide (`assist`, une part de traînée épargnée) que la sortie ajoute à
 * l'aspiration. Il ne touche ni à l'écran ni à la sortie elle-même : `started` dit quand et où la sortie doit repartir.
 *
 * Événements : `started` (accepté, avec la position du coureur suivi et le mode demandé), `changed` (l'état affiché),
 * `ended` (pourquoi), `followers` (la liste de ceux qui nous suivent).
 */
export class FollowSession extends TypedEmitter<{
  started: [info: { slot: number; name: string; pos: NetPosition; mode: FollowMode }];
  changed: [state: FollowState | undefined];
  ended: [reason: FollowStopReason, name: string];
  followers: [followers: readonly Follower[], change: { joined?: Follower; left?: Follower }];
}> {
  private current?: FollowState;
  private mode: FollowMode = 'chase';
  private tracker = new FollowTracker();
  private readonly followerList: Follower[] = [];
  private shownKey = '';

  constructor(private readonly deps: { world: FollowWorld }) {
    super();
  }

  get state(): FollowState | undefined {
    return this.current;
  }

  /** Part de la traînée de l'air épargnée par l'aide en ce moment (0 : pas d'aide). */
  get assist(): number {
    return this.current?.phase === 'requesting' ? 0 : (this.current?.assist ?? 0);
  }

  get followers(): readonly Follower[] {
    return this.followerList;
  }

  /** Demande à suivre le coureur `slot` ; la salle répond par `onGroup` (voir `handle`). */
  request(slot: number, name: string, mode: FollowMode): void {
    if (this.current && this.current.slot !== slot) this.stop('manual');
    this.mode = mode;
    this.current = { slot, name, phase: 'requesting', gapM: 0, assist: 0 };
    this.publish(true);
    this.deps.world.follow(slot);
  }

  /** Arrête de suivre, à la demande du coureur. */
  stop(reason: FollowStopReason = 'manual'): void {
    const cur = this.current;
    if (!cur) return;
    this.current = undefined;
    if (reason !== 'offline' && reason !== 'left' && reason !== 'refused' && reason !== 'denied' && reason !== 'unavailable') this.deps.world.unfollow();
    this.publish(true);
    this.emit('ended', reason, cur.name);
  }

  /** La connexion à la salle est perdue : le serveur a oublié qui suit qui. */
  worldLost(): void {
    this.stop('offline');
    if (this.followerList.length) {
      this.followerList.length = 0;
      this.emit('followers', this.followerList, {});
    }
  }

  /** Le coureur suivi renvoie un de ses suiveurs. */
  refuse(slot: number): void {
    this.deps.world.refuseFollower(slot);
    this.removeFollower(slot);
  }

  /** Ce que la salle dit du suivi. */
  handle(msg: ServerGroupMessage): void {
    switch (msg.type) {
      case 'followStart':
        if (this.current?.slot !== msg.slot) return; // réponse d'une demande déjà abandonnée
        this.tracker = new FollowTracker();
        this.current = { ...this.current, name: msg.name, phase: 'following' };
        this.publish(true);
        this.emit('started', { slot: msg.slot, name: msg.name, pos: msg.pos, mode: this.mode });
        return;
      case 'followEnd':
        return this.stop(msg.reason);
      case 'followedBy': {
        if (this.followerList.some((f) => f.slot === msg.slot)) return;
        const joined = { slot: msg.slot, name: msg.name };
        this.followerList.push(joined);
        this.emit('followers', this.followerList, { joined });
        return;
      }
      case 'unfollowedBy':
        return this.removeFollower(msg.slot);
    }
  }

  /** À chaque pas de la sortie : applique les règles et publie l'écart et l'aide. */
  update(dtS: number, self: FollowSelf): void {
    const cur = this.current;
    if (!cur || cur.phase === 'requesting') return;
    const r = this.deps.world.riders().find((x) => x.slot === cur.slot);
    const status = this.tracker.update(dtS, self, r && { x: r.point.x, z: r.point.z, speedMs: r.speedMs, riding: r.riding });
    if (status.ended) return this.stop(status.ended);
    this.current = { ...cur, phase: status.phase, gapM: status.gapM, assist: status.assist, ...(status.gapS !== undefined ? { gapS: status.gapS } : {}) };
    if (status.gapS === undefined) delete this.current.gapS;
    this.publish(false);
  }

  private removeFollower(slot: number): void {
    const i = this.followerList.findIndex((f) => f.slot === slot);
    if (i < 0) return;
    const [left] = this.followerList.splice(i, 1);
    this.emit('followers', this.followerList, { left: left! });
  }

  /** Publie l'état s'il a changé à l'œil : l'écart se lit par 5 m et le temps à la seconde, pas à chaque pas. */
  private publish(force: boolean): void {
    const c = this.current;
    const key = c ? `${c.slot}|${c.phase}|${Math.round(c.gapM / 5)}|${c.gapS === undefined ? '' : Math.round(c.gapS)}` : '';
    if (!force && key === this.shownKey) return;
    this.shownKey = key;
    this.emit('changed', c);
  }
}
