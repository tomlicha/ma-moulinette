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
  return (0.0015 + 0.006 * load) * moving;
}

/** Phase du balancement : une oscillation par deux tours de pédalier, une bascule par coup de pédale. */
export function swayPhaseStep(cadenceRpm: number, dtS: number): number {
  return Math.PI * (cadenceRpm / 60) * dtS;
}

/** Pente à partir de laquelle on se met en danseuse, en %, et pente en dessous de laquelle on se rassoit. */
export const STAND_GRADE_ON = 7;
export const STAND_GRADE_OFF = 5;
/** Plage de cadence de la danseuse, en tr/min : on se lève en tirant sur un gros braquet, pas en moulinant. */
export const STAND_CADENCE_MIN = 25;
export const STAND_CADENCE_MAX = 75;
export const STAND_CADENCE_OFF = 85;
/** Durée pendant laquelle les conditions doivent tenir avant de changer de position, en s. */
export const STAND_HOLD_S = 2;

/** Puissance lissée à partir de laquelle on se lève pour sprinter, et en dessous de laquelle on se rassoit, en part du FTP. */
export const STAND_SPRINT_ON = 1.4;
export const STAND_SPRINT_OFF = 1.1;
/** Délai pour se lever sur un pic de puissance : un sprint est bref, il ne faut pas le manquer. */
export const STAND_SPRINT_HOLD_S = 0.5;
/** Lissage de la puissance, en s : un pic de quelques coups de pédale compte, le bruit de mesure non. */
export const STAND_POWER_SMOOTH_S = 1.5;

export interface StandingState {
  on: boolean;
  /** Temps cumulé où les conditions demandent de changer de position, en s. */
  held: number;
  /** Puissance lissée, en W. */
  powerW: number;
}

export const SEATED_STATE: StandingState = { on: false, held: 0, powerW: 0 };

/** Mesures dont on déduit la position. */
export interface StandingInput {
  gradePct: number;
  cadenceRpm: number;
  powerW: number;
  /** FTP du coureur, en W ; 0 si inconnu (alors seule la côte compte). */
  ftpW: number;
}

/**
 * Danseuse déduite des mesures, sur deux motifs, quelle que soit la pente pour le second :
 *  - la côte raide à cadence basse (gros braquet, on pousse de tout son poids) ;
 *  - le pic de puissance (sprint, relance), même sur le plat ou en descente.
 * Il se rassoit quand aucun des deux ne tient plus. Des délais évitent de se lever et de se rasseoir à chaque variation.
 */
export function standingStep(s: StandingState, m: StandingInput, dtS: number): StandingState {
  const powerW = s.powerW + (m.powerW - s.powerW) * (1 - Math.exp(-dtS / STAND_POWER_SMOOTH_S));
  const sprintOn = m.ftpW > 0 && powerW >= STAND_SPRINT_ON * m.ftpW && m.cadenceRpm >= STAND_CADENCE_MIN;
  const sprintStay = m.ftpW > 0 && powerW >= STAND_SPRINT_OFF * m.ftpW && m.cadenceRpm >= STAND_CADENCE_MIN * 0.4;
  const climbOn = m.gradePct >= STAND_GRADE_ON && m.cadenceRpm >= STAND_CADENCE_MIN && m.cadenceRpm <= STAND_CADENCE_MAX;
  const climbStay = m.gradePct >= STAND_GRADE_OFF && m.cadenceRpm <= STAND_CADENCE_OFF && m.cadenceRpm >= STAND_CADENCE_MIN * 0.4;
  const wantChange = s.on ? !(climbStay || sprintStay) : climbOn || sprintOn;
  const need = s.on || !sprintOn ? STAND_HOLD_S : STAND_SPRINT_HOLD_S;
  const held = wantChange ? s.held + dtS : 0;
  return held >= need ? { on: !s.on, held: 0, powerW } : { on: s.on, held, powerW };
}
