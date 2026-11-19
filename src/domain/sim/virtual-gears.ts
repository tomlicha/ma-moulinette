import { G, resistanceForce, type RiderParams } from './physics';

/**
 * Vitesses virtuelles pour un vélo monté avec un Zwift Cog : un seul pignon réel, donc un braquet réel fixe, et le
 * changement de vitesse est simulé en modulant la pente envoyée au trainer.
 *
 * Deux façons de faire. Avec le protocole Zwift (infra/sensors/protocols/zwift.ts), choisi comme prioritaire sur l'écran Appareils, le
 * trainer reçoit le braquet et fait le calcul lui-même. Sinon, ce module : le trainer reste en mode SIM, piloté par
 * FTMS, Wahoo ou FE-C, et la méthode vaut pour tout trainer pilotable, pas seulement ceux que Zwift déclare
 * compatibles. Principe repris de SHIFTR (JuergenLeber/SHIFTR, VirtualShifting.md) : à cadence égale la
 * puissance au pédalier doit être celle du vélo virtuel, donc la force demandée au trainer est celle du vélo virtuel
 * multipliée par le rapport braquet virtuel / braquet réel.
 *
 * Non essayé sur matériel au 14 novembre 2026 : seuls les calculs sont couverts par les tests.
 */

/** Le Zwift Cog a 14 dents (versions 1 et 2). */
export const ZWIFT_COG_TEETH = 14;

/** Les 24 braquets virtuels de Zwift (plateau / pignon), du plus petit au plus grand. */
export const VIRTUAL_GEARS: readonly number[] = [
  0.75, 0.87, 0.99, 1.11, 1.23, 1.38, 1.53, 1.68, 1.86, 2.04, 2.22, 2.4, 2.61, 2.82, 3.03, 3.24, 3.49, 3.74, 3.99, 4.24,
  4.54, 4.84, 5.14, 5.49,
];

/** Développement d'une roue de route 700×25, en mètres : sert à déduire la vitesse du volant depuis la cadence. */
export const WHEEL_CIRC_M = 2.105;

export const CHAINRING_LIMITS = { min: 22, max: 60, default: 34 } as const;

/** Sous cette cadence la mesure est trop bruitée (ou le cycliste est en roue libre) pour en déduire une vitesse. */
const MIN_CADENCE_RPM = 20;

/** Braquet réel avec le Cog : dents du plateau / 14. */
export const realRatio = (chainringTeeth: number) => chainringTeeth / ZWIFT_COG_TEETH;

/** Vitesse virtuelle la plus proche du braquet réel : le point de départ, où le trainer se comporte comme sans Cog. */
export function nearestGear(ratio: number): number {
  let best = 0;
  VIRTUAL_GEARS.forEach((r, i) => {
    if (Math.abs(r - ratio) < Math.abs(VIRTUAL_GEARS[best]! - ratio)) best = i;
  });
  return best;
}

export const clampGear = (index: number) => Math.min(VIRTUAL_GEARS.length - 1, Math.max(0, Math.round(index)));

/** Paramètres que le trainer applique dans son propre calcul de résistance, à lui envoyer avec la pente. */
export interface TrainerSimModel {
  crr: number;
  /** Coefficient de traînée en kg/m (surface × Cx × densité de l'air) : le trainer applique ½ · cw · v². */
  cw: number;
}

/** Modèle à envoyer au trainer pour que son calcul et celui de l'application partent des mêmes coefficients. */
export const trainerModelFor = (rider: RiderParams): TrainerSimModel => ({
  crr: rider.crr,
  cw: Math.round(rider.airDensity * rider.cdA * 100) / 100, // les trois protocoles le portent au centième
});

export interface GearedGradeInput {
  /** Pente du parcours, en %. */
  gradePct: number;
  /** Vitesse du vélo virtuel, en m/s. */
  speedMs: number;
  /** Braquet virtuel choisi. */
  virtualRatio: number;
  /** Braquet réel (plateau / Cog). */
  realRatio: number;
  /** Cadence mesurée ; absente ou trop basse, la vitesse du volant est déduite de la vitesse virtuelle. */
  cadenceRpm?: number;
  rider: RiderParams;
  trainer: TrainerSimModel;
}

/**
 * Pente à envoyer au trainer pour qu'il oppose, avec son braquet réel, l'effort du vélo virtuel dans le braquet choisi.
 *
 * Le trainer calcule F = m·g·(crr + sin θ') + ½·cw·v_volant² ; on cherche θ' tel que F = F_virtuelle · k, avec
 * k = braquet virtuel / braquet réel. À k = 1 et vitesses égales, la pente rendue est celle du parcours.
 */
export function gearedGradePct(i: GearedGradeInput): number {
  const k = i.virtualRatio / i.realRatio;
  const target = resistanceForce(i.speedMs, i.gradePct, i.rider) * k;
  const flywheelMs =
    i.cadenceRpm !== undefined && i.cadenceRpm >= MIN_CADENCE_RPM ? (i.cadenceRpm / 60) * i.realRatio * WHEEL_CIRC_M : i.speedMs / k;
  const sin = (target - 0.5 * i.trainer.cw * flywheelMs * flywheelMs) / (i.rider.massKg * G) - i.trainer.crr;
  const bounded = Math.min(0.7, Math.max(-0.7, sin)); // ±100 % : au-delà aucun protocole ne porte la valeur
  return Math.tan(Math.asin(bounded)) * 100;
}

/** Cadence qu'aurait le cycliste à cette vitesse dans ce braquet : affichée comme repère, jamais envoyée au trainer. */
export const cadenceAt = (speedMs: number, ratio: number) => (speedMs / (ratio * WHEEL_CIRC_M)) * 60;
