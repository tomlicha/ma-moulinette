import type { Edge } from './network';

/** Rayon de l'arc qui arrondit le coin d'un carrefour, en m : de part et d'autre du nœud. */
export const CORNER_M = 12;

export interface JourneyPoint {
  x: number;
  y: number;
  z: number;
  /** Cap en rad (`atan2(dz, dx)`), positif vers la droite. */
  heading: number;
  edgeId: string;
}

/** Une route d'un trajet, parcourue dans un sens, placée à la distance `startM` du trajet. */
export interface Leg {
  edge: Edge;
  /** Vrai si la route se parcourt dans son sens de définition (départ → arrivée). */
  forward: boolean;
  startM: number;
  lengthM: number;
}

/**
 * Position d'un coureur sur le réseau, la même pour tous les joueurs : la distance d'un trajet, elle, dépend du point de
 * départ et des choix de chacun.
 */
export interface NetPosition {
  edgeId: string;
  forward: boolean;
  /** Abscisse depuis le nœud de départ de la route (dans son sens de définition), en m. */
  s: number;
  /** La route suivante, quand elle est déjà décidée : un autre joueur peut alors arrondir le virage à temps. */
  next?: { edgeId: string; forward: boolean };
}

const wrapPi = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

/** Abscisse sur la route, dans son sens de définition, de la distance `d` du trajet. */
export function edgeS(leg: Leg, d: number): number {
  const local = d - leg.startM;
  return leg.forward ? local : leg.lengthM - local;
}

/** Distance du trajet qui correspond à l'abscisse `s` de la route de `leg`. */
export function legDistance(leg: Leg, s: number): number {
  return leg.startM + (leg.forward ? s : leg.lengthM - s);
}

/** Nœud où finit `leg`. */
export function endNodeId(leg: Leg): string {
  return leg.forward ? leg.edge.to.id : leg.edge.from.id;
}

/** Vrai si `edge`, parcourue dans le sens `forward`, part du nœud `nodeId`. */
export function startsAt(edge: Edge, forward: boolean, nodeId: string): boolean {
  return (forward ? edge.from.id : edge.to.id) === nodeId;
}

/** La route d'une liste triée par `startM` qui couvre la distance `d` (la première si `d` tombe avant). */
export function findLeg(legs: readonly Leg[], d: number): Leg {
  let lo = 0;
  let hi = legs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (legs[mid]!.startM <= d) lo = mid;
    else hi = mid - 1;
  }
  return legs[lo]!;
}

/** Point sur la route elle-même, sans arrondir les coins. */
function rawPoint(legAt: (d: number) => Leg, d: number): JourneyPoint {
  const leg = legAt(d);
  const s = edgeS(leg, d);
  const p = leg.edge.pointAt(s);
  const heading = leg.edge.headingAt(s) + (leg.forward ? 0 : Math.PI);
  return { x: p.x, y: leg.edge.altitudeAt(s), z: p.z, heading: wrapPi(heading), edgeId: leg.edge.id };
}

/**
 * Position, altitude et cap à la distance `d` d'un trajet décrit par `legAt`. À moins de `CORNER_M` d'un carrefour, la
 * trajectoire est un arc (courbe de Bézier) qui coupe le coin entre les deux routes : le cycliste tourne, il ne pivote
 * pas sur un angle. L'altitude et la distance n'en sont pas touchées (les bouts de route sont plats).
 *
 * `firstM` : début de la première route connue ; aucun coin n'est arrondi avant. `lastM` : fin de la dernière route
 * connue ; aucun coin n'est arrondi après (la suite n'est pas encore décidée).
 */
export function trackPoint(legAt: (d: number) => Leg, d: number, firstM = 0, lastM = Infinity): JourneyPoint {
  const leg = legAt(d);
  const toStart = d - leg.startM;
  const toEnd = leg.startM + leg.lengthM - d;
  // Le nœud qu'on vient de passer, ou celui qu'on approche : `boundary` est sa distance sur le trajet.
  let boundary: number | undefined;
  if (leg.startM > firstM && toStart < CORNER_M) boundary = leg.startM;
  else if (toEnd < CORNER_M && leg.startM + leg.lengthM < lastM) boundary = leg.startM + leg.lengthM;
  if (boundary === undefined) return rawPoint(legAt, d);

  const a = rawPoint(legAt, boundary - CORNER_M);
  const c = rawPoint(legAt, boundary);
  const b = rawPoint(legAt, boundary + CORNER_M);
  const t = (d - (boundary - CORNER_M)) / (2 * CORNER_M);
  const u = 1 - t;
  const x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
  const z = u * u * a.z + 2 * u * t * c.z + t * t * b.z;
  const dx = 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x);
  const dz = 2 * u * (c.z - a.z) + 2 * t * (b.z - c.z);
  return { x, z, y: leg.edge.altitudeAt(edgeS(leg, d)), heading: Math.atan2(dz, dx), edgeId: leg.edge.id };
}
