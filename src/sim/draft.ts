/**
 * Aspiration : derrière un autre coureur, on économise une part de la traînée de l'air. Calcul pur, du côté de chaque
 * client (le serveur ne simule rien) : le coureur local regarde les autres qu'il reçoit et en déduit son abri.
 *
 * Modèle simple, tiré des ordres de grandeur de la littérature (souffleries et simulations de peloton : environ 30 à
 * 40 % de traînée en moins pour le deuxième coureur à une roue d'écart, de l'ordre de 10 % vers 10 m, négligeable
 * au-delà de 20 m) :
 *
 *   économie = DRAFT_MAX · exp(−écart / DRAFT_DECAY_M)
 *
 * où l'écart est celui entre la roue avant du suiveur et la roue arrière du meneur. Seul le coureur juste devant compte
 * (pas de bonus de file, pas de prise en compte du vent) : c'est volontairement prudent, à régler à l'usage.
 */

/** Économie maximale de traînée, roue contre roue. */
export const DRAFT_MAX = 0.35;
/** Décroissance avec l'écart, en m. */
export const DRAFT_DECAY_M = 6;
/** Au-delà, pas d'abri, en m (de centre à centre). */
export const DRAFT_RANGE_M = 25;
/** Écart latéral toléré avec la trajectoire du meneur, en m : même file sur la même route. */
export const DRAFT_LATERAL_M = 2.5;
/** Écart de cap toléré, en rad : le meneur va dans le même sens (carrefour et virages compris). */
export const DRAFT_ANGLE_RAD = (30 * Math.PI) / 180;
/** Longueur d'un vélo, en m : la distance de centre à centre moins ceci donne l'écart de roues. */
export const BIKE_LENGTH_M = 1.8;
/** Un meneur plus lent que cela ne coupe pas le vent, en m/s. */
export const DRAFT_MIN_SPEED_MS = 2;

export interface DraftSelf {
  x: number;
  z: number;
  /** Cap en rad, `atan2(dz, dx)`. */
  heading: number;
}

export interface DraftLeader extends DraftSelf {
  speedMs: number;
  riding: boolean;
}

export interface Draft {
  /** Part de la traînée épargnée, 0 à `DRAFT_MAX`. */
  reduction: number;
  /** Écart de roues avec le meneur, en m ; `undefined` sans abri. */
  gapM?: number;
}

const wrapPi = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

/** Abri d'un coureur placé en `self`, vis-à-vis des autres : le meilleur parmi ceux qui roulent juste devant lui. */
export function draftFrom(self: DraftSelf, others: readonly DraftLeader[]): Draft {
  const fx = Math.cos(self.heading);
  const fz = Math.sin(self.heading);
  let best = 0;
  let bestGap: number | undefined;
  for (const o of others) {
    if (!o.riding || o.speedMs < DRAFT_MIN_SPEED_MS) continue;
    const dx = o.x - self.x;
    const dz = o.z - self.z;
    const along = dx * fx + dz * fz;
    if (along <= 0 || along > DRAFT_RANGE_M) continue;
    if (Math.abs(dx * fz - dz * fx) > DRAFT_LATERAL_M) continue;
    if (Math.abs(wrapPi(o.heading - self.heading)) > DRAFT_ANGLE_RAD) continue;
    const gap = Math.max(0.2, along - BIKE_LENGTH_M);
    const reduction = DRAFT_MAX * Math.exp(-gap / DRAFT_DECAY_M);
    if (reduction > best) {
      best = reduction;
      bestGap = gap;
    }
  }
  return bestGap === undefined ? { reduction: 0 } : { reduction: best, gapM: bestGap };
}
