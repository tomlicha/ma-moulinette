import type { GroupClosedReason, GroupMember, GroupState, GroupSummary } from '../infra/net/group-protocol';
import { totalDurationS, type Workout } from '../domain/workout/model';
import { readWireWorkout } from '../domain/workout/wire';

/** Un groupe ne peut pas démarrer plus tôt que cela, ni plus tard : de quoi se réunir, sans réserver la salle pour la journée. */
export const MIN_START_IN_S = 30;
export const MAX_START_IN_S = 30 * 60;
/** Coureurs dans un même groupe. */
export const MAX_MEMBERS = 30;
/** Groupes ouverts en même temps dans la salle. */
export const MAX_GROUPS = 50;
/** Un groupe reste ouvert ce temps après la fin de sa séance (les derniers arrivés finissent), en ms. */
const GRACE_MS = 10 * 60_000;

interface Group {
  id: string;
  name: string;
  workout: Workout;
  courseId: string;
  t0: number;
  durationS: number;
  /** L'allure du groupe : la FTP et la masse du créateur à la création. */
  ftpW: number;
  massKg: number;
  /** Coureurs du groupe, dans l'ordre d'arrivée : le premier est le créateur, ou le plus ancien s'il est parti. */
  members: Map<number, string>;
  /** Les choix du créateur aux carrefours : rang de la route → numéro de l'option. */
  routes: Map<number, number>;
}

/** Choix mémorisés au plus par groupe : un trajet de séance ne compte pas autant de carrefours. */
const MAX_ROUTES = 2000;

/** Un groupe tel qu'on le range pour survivre à un redémarrage du Durable Object : de simples données JSON. */
export interface GroupSnapshot {
  id: string;
  name: string;
  workout: Workout;
  courseId: string;
  t0: number;
  durationS: number;
  ftpW: number;
  massKg: number;
  /** `[numéro, nom]` dans l'ordre d'arrivée. */
  members: [number, string][];
  /** `[rang de la route, option]`. */
  routes: [number, number][];
}

/**
 * Où les groupes sont rangés à chaque changement (le stockage du Durable Object). Sans lui, un redémarrage de l'objet les
 * oublierait alors que les coureurs, eux, restent connectés. `next` : le prochain numéro de groupe, rangé aussi pour qu'un
 * numéro ne serve pas deux fois.
 */
export interface GroupStore {
  save(group: GroupSnapshot, next: number): void;
  remove(id: string, next: number): void;
}

export type Joined = { ok: true; group: GroupState; left?: string } | { ok: false; reason: GroupClosedReason };

/**
 * Les séances de groupe ouvertes dans la salle : qui y est, quand elles démarrent. Pure donnée, sans réseau ni horloge propre :
 * `Room` donne l'heure et envoie les messages. Un coureur est dans un seul groupe à la fois.
 */
export class Groups {
  private readonly groups = new Map<string, Group>();
  private readonly of = new Map<number, string>();
  private next = 1;

  constructor(private readonly store?: GroupStore) {}

  /** Crée un groupe dont `leader` est le premier membre, et le lui fait rejoindre. */
  create(leader: GroupMember, workout: Workout, courseId: string, startInS: number, nowMs: number, ref: { ftpW: number; massKg: number }): Joined {
    if (this.groups.size >= MAX_GROUPS) return { ok: false, reason: 'full' };
    const clamped = Math.min(MAX_START_IN_S, Math.max(MIN_START_IN_S, Math.round(startInS)));
    const id = `g${this.next++}`;
    const group: Group = {
      id,
      name: `Séance de ${leader.name}`,
      workout,
      courseId,
      t0: nowMs + clamped * 1000,
      durationS: totalDurationS(workout),
      ftpW: ref.ftpW,
      massKg: ref.massKg,
      members: new Map(),
      routes: new Map(),
    };
    this.groups.set(id, group);
    return this.join(leader, id, nowMs);
  }

  /** `who` rejoint le groupe `id` ; il quitte celui où il était. */
  join(who: GroupMember, id: string, _nowMs?: number): Joined {
    const group = this.groups.get(id);
    if (!group) return { ok: false, reason: 'unknown' };
    if (group.members.size >= MAX_MEMBERS && !group.members.has(who.slot)) return { ok: false, reason: 'full' };
    const before = this.of.get(who.slot);
    if (before !== undefined && before !== id) this.leave(who.slot);
    group.members.set(who.slot, who.name);
    this.of.set(who.slot, id);
    this.saved(group);
    return { ok: true, group: this.state(group), ...(before !== undefined && before !== id ? { left: before } : {}) };
  }

  /** `slot` quitte son groupe. Renvoie le groupe quitté et ce qu'il en reste (`undefined` : plus personne, le groupe est fermé). */
  leave(slot: number): { id: string; members?: GroupMember[]; leader?: number } | undefined {
    const id = this.of.get(slot);
    if (id === undefined) return undefined;
    this.of.delete(slot);
    const group = this.groups.get(id);
    if (!group) return undefined;
    group.members.delete(slot);
    if (group.members.size === 0) {
      this.groups.delete(id);
      this.store?.remove(id, this.next);
      return { id };
    }
    this.saved(group);
    return { id, members: this.members(group), leader: this.leader(group)! };
  }

  /** Le numéro du créateur du groupe : le plus ancien membre encore là. */
  leader(group: string | Group): number | undefined {
    const g = typeof group === 'string' ? this.groups.get(group) : group;
    return g?.members.keys().next().value;
  }

  /**
   * Le créateur choisit l'option `index` à la route `leg`. Refusé de tout autre coureur. Renvoie le groupe où le choix compte
   * (pour le diffuser), `undefined` s'il est refusé. Un nouveau choix pour la même route remplace l'ancien : le créateur peut
   * changer d'avis tant que son propre écran le laisse faire.
   */
  route(slot: number, leg: number, index: number): string | undefined {
    const id = this.of.get(slot);
    const g = id ? this.groups.get(id) : undefined;
    if (!g || this.leader(g) !== slot) return undefined;
    if (!g.routes.has(leg) && g.routes.size >= MAX_ROUTES) return undefined;
    g.routes.set(leg, index);
    this.saved(g);
    return g.id;
  }

  groupOf(slot: number): string | undefined {
    return this.of.get(slot);
  }

  members(group: string | Group): GroupMember[] {
    const g = typeof group === 'string' ? this.groups.get(group) : group;
    return g ? [...g.members].map(([slot, name]) => ({ slot, name })) : [];
  }

  /** Les groupes ouverts, les plus proches du départ d'abord. */
  summaries(): GroupSummary[] {
    return [...this.groups.values()]
      .sort((a, b) => a.t0 - b.t0)
      .map((g) => ({ id: g.id, name: g.name, workoutName: g.workout.name, courseId: g.courseId, t0: g.t0, durationS: g.durationS, count: g.members.size }));
  }

  /** Les groupes dont la séance est finie depuis assez longtemps disparaissent ; leurs membres en sont avertis par l'appelant. */
  expire(nowMs: number): { id: string; members: number[] }[] {
    const closed: { id: string; members: number[] }[] = [];
    for (const g of [...this.groups.values()]) {
      if (nowMs <= g.t0 + g.durationS * 1000 + GRACE_MS) continue;
      const members = [...g.members.keys()];
      for (const slot of members) this.of.delete(slot);
      this.groups.delete(g.id);
      this.store?.remove(g.id, this.next);
      closed.push({ id: g.id, members });
    }
    return closed;
  }

  /**
   * Reprend les groupes rangés avant un redémarrage. `alive` dit si un coureur est toujours connecté (ses connexions ont
   * survécu, pas forcément tous) : les autres sont retirés des groupes, et un groupe vide disparaît. Une donnée illisible est
   * ignorée plutôt que de faire échouer le réveil.
   */
  restore(snapshots: readonly GroupSnapshot[], next: number, alive: (slot: number) => boolean): void {
    this.next = Math.max(this.next, next);
    for (const s of snapshots) {
      const workout = readWireWorkout(s.workout);
      const members = (Array.isArray(s.members) ? s.members : []).filter(([slot]) => alive(slot));
      if (!workout || typeof s.id !== 'string' || members.length === 0) {
        if (typeof s.id === 'string') this.store?.remove(s.id, this.next);
        continue;
      }
      const group: Group = {
        id: s.id,
        name: s.name,
        workout,
        courseId: s.courseId,
        t0: s.t0,
        durationS: s.durationS,
        ftpW: s.ftpW,
        massKg: s.massKg,
        members: new Map(members),
        routes: new Map(Array.isArray(s.routes) ? s.routes : []),
      };
      this.groups.set(group.id, group);
      for (const [slot] of members) this.of.set(slot, group.id);
      const n = Number(/^g(\d+)$/.exec(group.id)?.[1]);
      if (Number.isFinite(n)) this.next = Math.max(this.next, n + 1);
      if (members.length !== s.members.length) this.saved(group); // des coureurs sont partis pendant l'arrêt
    }
  }

  private saved(g: Group): void {
    this.store?.save(
      { id: g.id, name: g.name, workout: g.workout, courseId: g.courseId, t0: g.t0, durationS: g.durationS, ftpW: g.ftpW, massKg: g.massKg, members: [...g.members], routes: [...g.routes] },
      this.next,
    );
  }

  private state(g: Group): GroupState {
    return { id: g.id, name: g.name, workout: g.workout, courseId: g.courseId, t0: g.t0, members: this.members(g), ftpW: g.ftpW, massKg: g.massKg, leader: this.leader(g)!, routes: [...g.routes] };
  }
}
