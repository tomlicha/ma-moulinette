import type { Edge } from './network';

/**
 * Ce qu'on lit dans le tracé d'une route pour l'habiller : ses rampes (où planter un panneau de pente) et ses virages
 * serrés (où poser un parapet). Rien ici ne dépend du rendu.
 */

/** Une rampe : un tronçon qui monte ou descend franchement d'un bout à l'autre. */
export interface Ramp {
  from: number;
  to: number;
  /** Pente moyenne dans le sens de la route, en % : négative si la route descend. */
  gradePct: number;
}

/** Un virage serré. */
export interface Bend {
  from: number;
  to: number;
  /** +1 si la route tourne à droite dans son sens, −1 si elle tourne à gauche. */
  turn: 1 | -1;
  /** Plus petit rayon du virage, en m. */
  radiusM: number;
}

/** Pente lissée sur 100 m à partir de laquelle on est dans une rampe, en %. */
const RAMP_MIN_PCT = 4;
/** Deux rampes de même sens séparées par un replat plus court n'en font qu'une, en m. */
const RAMP_GAP_M = 300;
/** Longueur en dessous de laquelle une rampe ne mérite pas de panneau, en m. */
const RAMP_MIN_M = 250;

/** Rayon en dessous duquel un virage est serré, et longueur minimale d'un tel virage, en m. */
const BEND_RADIUS_M = 60;
const BEND_MIN_M = 20;

export function ramps(e: Edge): Ramp[] {
  const runs: { from: number; to: number; sign: number }[] = [];
  let from = 0;
  let sign = 0;
  for (let s = 0; ; s += 10) {
    const inside = s <= e.lengthM;
    const a = Math.max(0, s - 50);
    const b = Math.min(e.lengthM, s + 50);
    const grade = inside && b > a ? ((e.altitudeAt(b) - e.altitudeAt(a)) / (b - a)) * 100 : 0;
    const now = Math.abs(grade) >= RAMP_MIN_PCT ? Math.sign(grade) : 0;
    if (now !== sign) {
      if (sign !== 0) {
        const to = Math.min(s, e.lengthM);
        const last = runs[runs.length - 1];
        if (last && last.sign === sign && from - last.to <= RAMP_GAP_M) last.to = to;
        else runs.push({ from, to, sign });
      }
      sign = now;
      from = s;
    }
    if (!inside) break;
  }
  return runs
    .filter((r) => r.to - r.from >= RAMP_MIN_M)
    .map((r) => ({ from: r.from, to: r.to, gradePct: ((e.altitudeAt(r.to) - e.altitudeAt(r.from)) / (r.to - r.from)) * 100 }));
}

export function bends(e: Edge): Bend[] {
  const out: Bend[] = [];
  let from = -1;
  let sign = 0;
  let tightest = Infinity;
  const close = (to: number) => {
    if (from >= 0 && to - from >= BEND_MIN_M) out.push({ from, to, turn: sign > 0 ? 1 : -1, radiusM: tightest });
    from = -1;
    sign = 0;
    tightest = Infinity;
  };
  for (let s = 10; s <= e.lengthM - 10; s += 5) {
    const dh = e.headingAt(s + 10) - e.headingAt(s - 10);
    const k = Math.atan2(Math.sin(dh), Math.cos(dh)) / 20; // courbure, positive en tournant à droite
    const now = Math.abs(k) > 1 / BEND_RADIUS_M ? Math.sign(k) : 0;
    if (now !== sign) {
      close(s);
      if (now !== 0) {
        from = s;
        sign = now;
      }
    }
    if (now !== 0) tightest = Math.min(tightest, 1 / Math.abs(k));
  }
  close(e.lengthM - 10);
  return out;
}
