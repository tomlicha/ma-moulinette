import type { RoadNetwork } from './network';
import {
  endNodeId,
  findLeg,
  legDistance,
  startsAt,
  trackPoint,
  type JourneyPoint,
  type Leg,
  type NetPosition,
} from './track';

/** Recul toléré sur une même route, en m : au-delà, le coureur a été replacé (nouvelle sortie). */
const BACKTRACK_M = 5;
/** Les routes finies depuis plus longtemps sont oubliées, en m. */
const KEEP_BEHIND_M = 200;

export interface Observation {
  /** Distance sur la piste, en m : croissante tant que le coureur roule, à interpoler entre deux messages. */
  d: number;
  /** Vrai si la piste vient d'être recommencée : ne pas interpoler depuis les distances d'avant. */
  reset: boolean;
}

/**
 * Piste d'un autre coureur, reconstruite à partir des positions réseau qu'il annonce : ses routes sont recollées bout à
 * bout, si bien que sa position devient une distance monotone, interpolable comme celle du joueur local, avec les mêmes
 * coins de carrefour arrondis. Une position qui ne prolonge pas la piste (téléportation, nouvelle sortie, messages
 * perdus sur plusieurs routes) la recommence.
 */
export class RemoteTrack {
  private legs: Leg[] = [];
  private lastD = 0;

  constructor(readonly network: RoadNetwork) {}

  /** Intègre une position reçue. Renvoie `undefined` si elle désigne une route inconnue. */
  observe(pos: NetPosition): Observation | undefined {
    const edge = this.network.edges.get(pos.edgeId);
    if (!edge) return undefined;
    const s = Math.min(Math.max(pos.s, 0), edge.lengthM);
    let reset = false;
    let leg = this.findKnown(pos.edgeId, pos.forward);
    if (!leg) {
      const last = this.legs[this.legs.length - 1];
      if (last && startsAt(edge, pos.forward, endNodeId(last))) leg = this.append(pos.edgeId, pos.forward);
      else {
        this.legs = [{ edge, forward: pos.forward, startM: 0, lengthM: edge.lengthM }];
        leg = this.legs[0]!;
        reset = true;
      }
    }
    let d = legDistance(leg!, s);
    if (!reset && d < this.lastD - BACKTRACK_M) {
      this.legs = [{ edge, forward: pos.forward, startM: 0, lengthM: edge.lengthM }];
      d = legDistance(this.legs[0]!, s);
      reset = true;
    }
    this.lastD = d;

    // Route suivante annoncée : on la colle tout de suite, le virage s'arrondit avant que le coureur y soit.
    const last = this.legs[this.legs.length - 1]!;
    if (pos.next && last.edge.id === pos.edgeId && last.forward === pos.forward) {
      const nextEdge = this.network.edges.get(pos.next.edgeId);
      if (nextEdge && startsAt(nextEdge, pos.next.forward, endNodeId(last))) this.append(pos.next.edgeId, pos.next.forward);
    }
    this.trim(d);
    return { d, reset };
  }

  /** Position, altitude et cap à la distance `d` de la piste. */
  pointAt(d: number): JourneyPoint {
    const first = this.legs[0];
    if (!first) throw new Error('piste vide : aucune position reçue');
    const last = this.legs[this.legs.length - 1]!;
    const end = last.startM + last.lengthM;
    // Au-delà de la piste connue, le coureur reste au bout de sa dernière route plutôt que de quitter la chaussée.
    const x = Math.min(Math.max(d, first.startM), end);
    return trackPoint((v) => findLeg(this.legs, v), x, first.startM, end);
  }

  /** Altitude à la distance `d`, bornée à la piste connue. */
  altitudeAt(d: number): number {
    return this.pointAt(d).y;
  }

  /** Pente moyenne entre `d - halfWindowM` et `d + halfWindowM`, bornée à la piste connue, en %. */
  gradeAt(d: number, halfWindowM = 10): number {
    return ((this.altitudeAt(d + halfWindowM) - this.altitudeAt(d - halfWindowM)) / (2 * halfWindowM)) * 100;
  }

  /** Vrai tant qu'aucune position n'a été reçue. */
  get empty(): boolean {
    return this.legs.length === 0;
  }

  /** Les deux dernières routes suffisent : le coureur est sur l'une, l'autre peut être la suivante déjà annoncée. */
  private findKnown(edgeId: string, forward: boolean): Leg | undefined {
    for (let i = this.legs.length - 1; i >= Math.max(0, this.legs.length - 3); i--) {
      const l = this.legs[i]!;
      if (l.edge.id === edgeId && l.forward === forward) return l;
    }
    return undefined;
  }

  private append(edgeId: string, forward: boolean): Leg {
    const edge = this.network.edges.get(edgeId)!;
    const last = this.legs[this.legs.length - 1]!;
    const leg = { edge, forward, startM: last.startM + last.lengthM, lengthM: edge.lengthM };
    this.legs.push(leg);
    return leg;
  }

  private trim(d: number) {
    while (this.legs.length > 1 && this.legs[0]!.startM + this.legs[0]!.lengthM < d - KEEP_BEHIND_M) this.legs.shift();
  }
}
