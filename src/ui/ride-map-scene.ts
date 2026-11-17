/**
 * Ce que la carte de l'encart dessine, déduit du trajet du coureur, des autres coureurs proches et du carrefour annoncé.
 * Sans DOM : testé avec le vrai réseau. Le rendu SVG est dans `ride-map.ts`.
 */
import type { NearbyRiders } from '../render/others-model';
import type { Journey, PendingJunction } from '../sim/journey';
import { climbText, type Pt, type SelfPose } from './ride-map-model';

/** Route montrée derrière et devant le coureur, en m (plus que le cadre : la carte rogne), et pas d'échantillonnage. */
export const BEHIND_M = 220;
export const AHEAD_M = 700;
const STEP_M = 20;
/** Longueur des routes proposées au carrefour, en m. */
export const BRANCH_M = 300;

export interface MapRider extends Pt {
  slot: number;
}

export interface MapOption {
  pts: Pt[];
  label: string;
  /** Deuxième ligne : la montée. */
  sub: string;
  selected: boolean;
}

export interface MapJunction {
  nodeId: string;
  /** Nom du carrefour. */
  name: string;
  node: Pt;
  /** Distance du trajet où se trouve le nœud, en m. */
  atM: number;
  options: MapOption[];
}

export interface MapScene {
  self: SelfPose;
  behind: Pt[];
  ahead: Pt[];
  riders: MapRider[];
  junction?: MapJunction;
}

function along(journey: Journey, from: number, to: number): Pt[] {
  const out: Pt[] = [];
  for (let d = from; d < to; d += STEP_M) {
    const p = journey.pointAt(Math.max(0, d));
    out.push({ x: p.x, z: p.z });
  }
  const last = journey.pointAt(Math.max(0, to));
  out.push({ x: last.x, z: last.z });
  return out;
}

/** Le carrefour à dessiner : ses routes depuis le nœud, la retenue en tête de ses rivales. */
export function junctionScene(journey: Journey, p: PendingJunction): MapJunction | undefined {
  const net = journey.network;
  const node = net.nodes.get(p.nodeId);
  if (!node) return undefined;
  const options: MapOption[] = [];
  p.options.forEach((o, i) => {
    const edge = net.edges.get(o.edgeId);
    if (!edge) return;
    const pts: Pt[] = [];
    const len = Math.min(BRANCH_M, edge.lengthM);
    for (let t = 0; t <= len; t += STEP_M) pts.push(edge.pointAt(o.forward ? t : edge.lengthM - t));
    options.push({ pts, label: o.name, sub: climbText(o.climbM), selected: i === p.selected });
  });
  return { nodeId: p.nodeId, name: node.name, node: { x: node.x, z: node.z }, atM: p.atM, options };
}

/**
 * Scène de la carte à la distance `distanceM` du trajet. `junction` : le carrefour à montrer (annoncé, ou verrouillé mais
 * pas encore passé). La route devant soi suit le choix en cours, sinon le tout droit : c'est celle du trajet.
 */
export function buildScene(journey: Journey, distanceM: number, nearby: NearbyRiders | undefined, junction?: MapJunction): MapScene {
  const here = journey.pointAt(distanceM);
  const riders = nearby ? [...nearby.ahead, ...nearby.behind].map((r) => ({ x: r.x, z: r.z, slot: r.slot })) : [];
  return {
    self: { x: here.x, z: here.z, heading: here.heading },
    behind: along(journey, distanceM - BEHIND_M, distanceM),
    ahead: along(journey, distanceM, distanceM + AHEAD_M),
    riders,
    ...(junction ? { junction } : {}),
  };
}
