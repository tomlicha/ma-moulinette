/**
 * Messages JSON de « rouler avec d'autres » (docs/design/groupe.md, section 5), en plus de `welcome`, `join` et `leave` de
 * la salle. Rares, donc en texte ; les positions restent en binaire (`protocol.ts`).
 *
 * Client → serveur :
 *   { type: 'joinable', who }       qui peut me rejoindre : 'none' | 'friends' | 'all' (envoyé à la connexion et à chaque changement)
 *   { type: 'follow', slot }        rejoindre et suivre le coureur `slot`
 *   { type: 'unfollow' }            arrêter de suivre
 *   { type: 'refuse', slot }        le coureur suivi ne veut plus de ce suiveur
 *   { type: 'who', q? }             qui est en ligne (filtré par nom) et quels groupes existent
 *   { type: 'time', c }             heure du client, pour régler l'horloge commune
 *   { type: 'groupCreate', workout, courseId, startInS, ftpW, massKg }   crée une séance de groupe qui démarre dans `startInS`
 *                                       secondes ; sa FTP et sa masse fixent l'allure du groupe (voir `domain/group/group-pace.ts`)
 *   { type: 'groupJoin', id } · { type: 'groupLeave' }
 *   { type: 'groupRoute', leg, index }   le créateur du groupe choisit la route `index` au carrefour qui précède la route `leg` du trajet
 *
 * Serveur → client :
 *   { type: 'followStart', slot, name, pos }   accepté : où se trouve le coureur suivi, pour se placer derrière lui
 *   { type: 'followEnd', reason }              le suivi est fini (refusé, impossible, ou le coureur est parti)
 *   { type: 'followedBy', slot, name }         quelqu'un me suit
 *   { type: 'unfollowedBy', slot }             il ne me suit plus
 *   { type: 'who', riders, groups, total }     réponse à `who`
 *   { type: 'time', c, s }                     l'heure du client renvoyée, et celle du serveur (horloge commune)
 *   { type: 'groupState', group }              on est dans ce groupe : séance, parcours, départ, membres
 *   { type: 'groupMembers', id, leader, members }   les membres ont changé (et peut-être le créateur : le plus ancien qui reste)
 *   { type: 'groupRoute', leg, index }          le choix du créateur, à appliquer par tous quand leur trajet valide cette route
 *   { type: 'groupClosed', id, reason }        le groupe n'existe plus pour nous (refusé, plein, fini, vide)
 */
import type { NetPosition } from '../../domain/course/track';
import type { Workout } from '../../domain/workout/model';
import { readWireWorkout } from '../../domain/workout/wire';

export type JoinableBy = 'none' | 'friends' | 'all';
export const JOINABLE_VALUES: readonly JoinableBy[] = ['none', 'friends', 'all'];

export type FollowEndReason =
  | 'unavailable' // le coureur n'existe pas, ne roule pas, ou c'est soi-même
  | 'denied' // son réglage « Qui peut me rejoindre » refuse
  | 'refused' // il a retiré son accord
  | 'left'; // il est parti

/** Un coureur en ligne, tel que la liste « En ligne » le montre. */
export interface OnlineRider {
  slot: number;
  name: string;
  /** Il est en sortie en ce moment : on peut le rejoindre. */
  riding: boolean;
}

export interface GroupMember {
  slot: number;
  name: string;
}

/** Ce qu'on sait d'un groupe sans le rejoindre. */
export interface GroupSummary {
  id: string;
  name: string;
  workoutName: string;
  courseId: string;
  /** Départ, en ms sur l'horloge du serveur. */
  t0: number;
  durationS: number;
  count: number;
}

/** Un groupe qu'on a rejoint : tout ce qu'il faut pour rouler la même séance au même endroit au même instant. */
export interface GroupState {
  id: string;
  name: string;
  workout: Workout;
  courseId: string;
  t0: number;
  members: GroupMember[];
  /** FTP et masse du créateur à la création : le coureur de référence dont le groupe prend l'allure (fixe, même s'il part). */
  ftpW: number;
  massKg: number;
  /** Numéro du créateur du groupe (le plus ancien membre s'il est parti) : c'est lui qui choisit la route aux carrefours. */
  leader: number;
  /** Les choix déjà faits, `[route, option]` : de quoi rejouer le trajet quand on arrive en retard. */
  routes: [number, number][];
}

export type GroupClosedReason = 'unknown' | 'full' | 'invalid' | 'over' | 'empty';

export type ClientGroupMessage =
  | { type: 'joinable'; who: JoinableBy }
  | { type: 'follow'; slot: number }
  | { type: 'unfollow' }
  | { type: 'refuse'; slot: number }
  | { type: 'who'; q: string }
  | { type: 'time'; c: number }
  | { type: 'groupCreate'; workout: Workout; courseId: string; startInS: number; ftpW: number; massKg: number }
  | { type: 'groupJoin'; id: string }
  | { type: 'groupLeave' }
  | { type: 'groupRoute'; leg: number; index: number };

export type ServerGroupMessage =
  | { type: 'followStart'; slot: number; name: string; pos: NetPosition }
  | { type: 'followEnd'; reason: FollowEndReason }
  | { type: 'followedBy'; slot: number; name: string }
  | { type: 'unfollowedBy'; slot: number }
  | { type: 'who'; riders: OnlineRider[]; groups: GroupSummary[]; total: number }
  | { type: 'time'; c: number; s: number }
  | { type: 'groupState'; group: GroupState }
  | { type: 'groupMembers'; id: string; leader: number; members: GroupMember[] }
  | { type: 'groupRoute'; leg: number; index: number }
  | { type: 'groupClosed'; id: string; reason: GroupClosedReason };

/** Taille maximale d'un petit ordre du client : tout le reste est rejeté. */
const MAX_TEXT_CHARS = 256;
/** Taille maximale de la création d'un groupe, qui porte une séance entière. */
export const MAX_CREATE_CHARS = 40_000;
export const MAX_QUERY_CHARS = 40;
export const MAX_ID_CHARS = 24;
export const MAX_COURSE_ID_CHARS = 40;
/** Rang de route et numéro d'option acceptés : un trajet de séance ne dépasse pas quelques centaines de routes, un carrefour a moins de dix options. */
export const MAX_ROUTE_LEG = 10_000;
export const MAX_ROUTE_INDEX = 9;
/** Bornes de la FTP et de la masse (coureur et vélo) d'un créateur de groupe, en W et en kg : au-delà, c'est une erreur ou une triche. */
export const GROUP_FTP_RANGE_W = [50, 700] as const;
export const GROUP_MASS_RANGE_KG = [30, 250] as const;
const inRange = (v: unknown, [min, max]: readonly [number, number]): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const isSlot = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffff;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && /^[\w-]+$/.test(v);

/** Lit un message du client ; `undefined` s'il est mal formé, trop long ou inconnu. */
export function parseClientMessage(text: string): ClientGroupMessage | undefined {
  if (text.length > MAX_CREATE_CHARS) return undefined;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined;
  if (m.type !== 'groupCreate' && text.length > MAX_TEXT_CHARS) return undefined;
  switch (m.type) {
    case 'joinable':
      return JOINABLE_VALUES.includes(m.who as JoinableBy) ? { type: 'joinable', who: m.who as JoinableBy } : undefined;
    case 'follow':
      return isSlot(m.slot) ? { type: 'follow', slot: m.slot } : undefined;
    case 'refuse':
      return isSlot(m.slot) ? { type: 'refuse', slot: m.slot } : undefined;
    case 'unfollow':
      return { type: 'unfollow' };
    case 'who': {
      const q = m.q === undefined ? '' : m.q;
      return typeof q === 'string' && q.length <= MAX_QUERY_CHARS ? { type: 'who', q } : undefined;
    }
    case 'time':
      return isFiniteNumber(m.c) ? { type: 'time', c: m.c } : undefined;
    case 'groupCreate': {
      const workout = readWireWorkout(m.workout);
      if (!workout || !isId(m.courseId, MAX_COURSE_ID_CHARS) || !isFiniteNumber(m.startInS)) return undefined;
      if (!inRange(m.ftpW, GROUP_FTP_RANGE_W) || !inRange(m.massKg, GROUP_MASS_RANGE_KG)) return undefined;
      return { type: 'groupCreate', workout, courseId: m.courseId, startInS: m.startInS, ftpW: m.ftpW, massKg: m.massKg };
    }
    case 'groupJoin':
      return isId(m.id, MAX_ID_CHARS) ? { type: 'groupJoin', id: m.id } : undefined;
    case 'groupLeave':
      return { type: 'groupLeave' };
    case 'groupRoute':
      return isRoute(m.leg, m.index) ? { type: 'groupRoute', leg: m.leg as number, index: m.index as number } : undefined;
    default:
      return undefined;
  }
}

const isRoute = (leg: unknown, index: unknown): boolean =>
  typeof leg === 'number' && Number.isInteger(leg) && leg >= 0 && leg <= MAX_ROUTE_LEG && typeof index === 'number' && Number.isInteger(index) && index >= 0 && index <= MAX_ROUTE_INDEX;

const readRoutes = (v: unknown): [number, number][] | undefined => {
  if (!Array.isArray(v) || v.length > MAX_ROUTE_LEG) return undefined;
  const out: [number, number][] = [];
  for (const r of v as unknown[]) {
    if (!Array.isArray(r) || r.length !== 2 || !isRoute(r[0], r[1])) return undefined;
    out.push([r[0] as number, r[1] as number]);
  }
  return out;
};

const readMembers = (v: unknown): GroupMember[] | undefined => {
  if (!Array.isArray(v) || v.length > 255) return undefined;
  const out: GroupMember[] = [];
  for (const x of v as Record<string, unknown>[]) {
    if (!x || !isSlot(x.slot) || typeof x.name !== 'string') return undefined;
    out.push({ slot: x.slot, name: x.name });
  }
  return out;
};

const readSummary = (x: Record<string, unknown>): GroupSummary | undefined =>
  isId(x.id, MAX_ID_CHARS) &&
  typeof x.name === 'string' &&
  typeof x.workoutName === 'string' &&
  typeof x.courseId === 'string' &&
  isFiniteNumber(x.t0) &&
  isFiniteNumber(x.durationS) &&
  isFiniteNumber(x.count)
    ? { id: x.id, name: x.name, workoutName: x.workoutName, courseId: x.courseId, t0: x.t0, durationS: x.durationS, count: x.count }
    : undefined;

/** Lit un message du serveur sur le suivi ou les groupes ; `undefined` pour tout autre message. */
export function parseServerMessage(m: Record<string, unknown>): ServerGroupMessage | undefined {
  switch (m.type) {
    case 'followStart': {
      const pos = m.pos as Partial<NetPosition> | undefined;
      if (!isSlot(m.slot) || typeof m.name !== 'string' || !pos || typeof pos.edgeId !== 'string') return undefined;
      if (typeof pos.forward !== 'boolean' || typeof pos.s !== 'number' || !Number.isFinite(pos.s)) return undefined;
      return { type: 'followStart', slot: m.slot, name: m.name, pos: { edgeId: pos.edgeId, forward: pos.forward, s: pos.s } };
    }
    case 'followEnd':
      return m.reason === 'unavailable' || m.reason === 'denied' || m.reason === 'refused' || m.reason === 'left'
        ? { type: 'followEnd', reason: m.reason }
        : undefined;
    case 'followedBy':
      return isSlot(m.slot) && typeof m.name === 'string' ? { type: 'followedBy', slot: m.slot, name: m.name } : undefined;
    case 'unfollowedBy':
      return isSlot(m.slot) ? { type: 'unfollowedBy', slot: m.slot } : undefined;
    case 'who': {
      if (!Array.isArray(m.riders) || !Array.isArray(m.groups) || !isFiniteNumber(m.total)) return undefined;
      const riders: OnlineRider[] = [];
      for (const r of m.riders as Record<string, unknown>[]) {
        if (!r || !isSlot(r.slot) || typeof r.name !== 'string' || typeof r.riding !== 'boolean') return undefined;
        riders.push({ slot: r.slot, name: r.name, riding: r.riding });
      }
      const groups: GroupSummary[] = [];
      for (const g of m.groups as Record<string, unknown>[]) {
        const s = g && readSummary(g);
        if (!s) return undefined;
        groups.push(s);
      }
      return { type: 'who', riders, groups, total: m.total };
    }
    case 'time':
      return isFiniteNumber(m.c) && isFiniteNumber(m.s) ? { type: 'time', c: m.c, s: m.s } : undefined;
    case 'groupState': {
      const g = m.group as Record<string, unknown> | undefined;
      if (!g || !isId(g.id, MAX_ID_CHARS) || typeof g.name !== 'string' || !isId(g.courseId, MAX_COURSE_ID_CHARS) || !isFiniteNumber(g.t0)) return undefined;
      const workout = readWireWorkout(g.workout);
      const members = readMembers(g.members);
      const routes = readRoutes(g.routes);
      if (!workout || !members || !routes || !isSlot(g.leader)) return undefined;
      if (!inRange(g.ftpW, GROUP_FTP_RANGE_W) || !inRange(g.massKg, GROUP_MASS_RANGE_KG)) return undefined;
      return { type: 'groupState', group: { id: g.id, name: g.name, workout, courseId: g.courseId, t0: g.t0, members, ftpW: g.ftpW, massKg: g.massKg, leader: g.leader, routes } };
    }
    case 'groupMembers': {
      const members = readMembers(m.members);
      return isId(m.id, MAX_ID_CHARS) && members && isSlot(m.leader) ? { type: 'groupMembers', id: m.id, leader: m.leader, members } : undefined;
    }
    case 'groupRoute':
      return isRoute(m.leg, m.index) ? { type: 'groupRoute', leg: m.leg as number, index: m.index as number } : undefined;
    case 'groupClosed':
      return isId(m.id, MAX_ID_CHARS) && (m.reason === 'unknown' || m.reason === 'full' || m.reason === 'invalid' || m.reason === 'over' || m.reason === 'empty')
        ? { type: 'groupClosed', id: m.id, reason: m.reason }
        : undefined;
    default:
      return undefined;
  }
}
