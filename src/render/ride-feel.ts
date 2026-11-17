import { smoothstep } from './noise';

/**
 * Ce qui fait sentir la pente et l'effort dans la vue de poursuite. Tout est calculé ici, sans GPU : la vue ne fait
 * qu'appliquer ces valeurs (champ de vision, point visé, balancement).
 */

/** Champ de vision de base de la caméra de poursuite, en degrés. */
export const FOV_BASE = 58;
/** Pente à laquelle les effets atteignent leur maximum, en %. */
export const FEEL_GRADE_PCT = 10;
/** Distance du point visé devant le cycliste, en m. */
export const LOOK_AHEAD_M = 14;
/** Part de la montée du point visé que la caméra suit : 0 = regard horizontal, 1 = regard le long de la route. */
export const LOOK_FOLLOW = 0.7;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Champ de vision selon la pente et la vitesse, en degrés : il se resserre en montée (l'effort, la route qui se dresse),
 * s'élargit en descente et à grande vitesse (le décor défile).
 */
export function fovFor(gradePct: number, speedKmh: number): number {
  const g = clamp(gradePct, -FEEL_GRADE_PCT, FEEL_GRADE_PCT) / FEEL_GRADE_PCT;
  const rush = smoothstep(25, 60, speedKmh);
  return FOV_BASE - 5 * Math.max(0, g) + 5 * Math.max(0, -g) + 3 * rush;
}

/**
 * Hauteur du point visé, à l'image. La caméra regarde `LOOK_AHEAD_M` devant, à la hauteur du coureur plus une part
 * (`LOOK_FOLLOW`) de la montée de la route sur cette distance : en côte, la vue se redresse et l'horizon descend à
 * l'écran ; en descente, elle plonge.
 */
export function lookHeight(riderY: number, aheadRoadY: number, eyeAbove = 1.05): number {
  return riderY + eyeAbove + LOOK_FOLLOW * (aheadRoadY - riderY);
}

/**
 * Roulis du cycliste en radians au plus fort du balancement. Il grandit avec l'effort : une côte raide, et une
 * cadence basse pour la puissance (on tire sur le guidon). Nul à l'arrêt.
 */
export function swayRoll(gradePct: number, cadenceRpm: number): number {
  const climb = clamp(gradePct, 0, FEEL_GRADE_PCT) / FEEL_GRADE_PCT;
  const lowCadence = 1 - clamp(cadenceRpm / 100, 0, 1) * 0.5; // 1 à bas régime, 0,5 à 100 tr/min
  const load = climb * lowCadence;
  const moving = smoothstep(5, 40, cadenceRpm);
  return (0.004 + 0.018 * load) * moving;
}

/** Phase du balancement : une oscillation par deux tours de pédalier, une bascule par coup de pédale. */
export function swayPhaseStep(cadenceRpm: number, dtS: number): number {
  return Math.PI * (cadenceRpm / 60) * dtS;
}
