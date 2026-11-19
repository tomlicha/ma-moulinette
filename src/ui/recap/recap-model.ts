import type { Recording, Sample } from '../../infra/export/recorder';
import { targetWatts, type Workout, type WorkoutStep } from '../../domain/workout/model';
import { zoneOf } from '../../domain/workout/profile';

export type PowerZone = ReturnType<typeof zoneOf>;
export const POWER_ZONES: PowerZone[] = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'];

/** Un point de la courbe du récapitulatif : moyennes sur quelques secondes. */
export interface ChartBucket {
  powerW?: number;
  /** Consigne de la séance ; absente hors séance ou sur un palier libre. */
  targetW?: number;
}

/** Ce que l'écran récapitulatif affiche ; une mesure absente (pas de capteur cardiaque…) reste `undefined`. */
export interface RecapSummary {
  /** Temps de sortie hors pauses, en s. */
  durationS: number;
  distanceKm?: number;
  climbM?: number;
  avgSpeedKmh?: number;
  avgPowerW?: number;
  /** Puissance normalisée : moyenne glissante sur 30 s, élevée à la puissance 4. */
  normalizedW?: number;
  intensityFactor?: number;
  tss?: number;
  workKj?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  /** Cadence moyenne en pédalant (les roues libres ne comptent pas). */
  avgCadence?: number;
  ftpW: number;
  /** Secondes passées dans chaque zone, d'après la puissance mesurée. */
  zones: Record<PowerZone, number>;
  /** Séance : blocs d'effort tenus (puissance moyenne d'au moins 95 % de la consigne, palier mené au bout). */
  efforts?: { held: number; total: number };
  chart: ChartBucket[];
  /** Haut de l'échelle verticale de la courbe, en W. */
  chartPeakW: number;
}

/** Nombre de points de la courbe au plus : assez pour la largeur d'un écran, sans alourdir le SVG. */
const MAX_BUCKETS = 240;
/** Seuil de « bloc tenu » : puissance moyenne / consigne moyenne. */
const HELD_RATIO = 0.95;
/** Un palier est mené au bout s'il a été roulé au moins sur cette part de sa durée (un palier passé ne compte pas). */
const DONE_RATIO = 0.9;
/** Secondes de début de palier écartées du calcul : le temps que le trainer atteigne la consigne. */
const RAMP_IN_S = 5;
/** En dessous de cette part de la FTP, un palier n'est pas un effort (tempo et au-dessus, comme `effortSeconds`). */
const EFFORT_FRACTION = 0.76;
const NOT_EFFORTS: WorkoutStep['kind'][] = ['warmup', 'cooldown', 'off', 'free'];

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const defined = <K extends keyof Sample>(samples: Sample[], k: K) =>
  samples.map((s) => s[k]).filter((v): v is NonNullable<Sample[K]> => v !== undefined) as number[];

/** Puissance normalisée (moyenne glissante sur 30 s) ; `undefined` sous 30 s de données. Une seconde sans mesure compte pour 0 W. */
export function normalizedPower(power: number[]): number | undefined {
  if (power.length < 30) return undefined;
  let sum = 0;
  let acc = 0;
  let n = 0;
  for (let i = 0; i < power.length; i++) {
    sum += power[i]!;
    if (i >= 30) sum -= power[i - 30]!;
    if (i >= 29) {
      acc += (sum / 30) ** 4;
      n++;
    }
  }
  return (acc / n) ** 0.25;
}

/** Un palier est un effort s'il a une consigne d'au moins le tempo et n'est ni échauffement, ni récupération, ni retour au calme. */
export function isEffort(step: WorkoutStep, ftpW: number): boolean {
  if (NOT_EFFORTS.includes(step.kind)) return false;
  const a = targetWatts(step, 0, ftpW);
  const b = targetWatts(step, step.durationS, ftpW);
  return a !== undefined && b !== undefined && (a + b) / 2 / ftpW >= EFFORT_FRACTION;
}

/** Blocs d'effort de la séance et combien ont été tenus, d'après le palier noté dans chaque échantillon. */
export function effortsOf(w: Workout, ftpW: number, samples: Sample[]): { held: number; total: number } | undefined {
  let total = 0;
  let held = 0;
  w.steps.forEach((step, i) => {
    if (!isEffort(step, ftpW)) return;
    total++;
    const mine = samples.filter((s) => s.stepIndex === i);
    if (mine.length < DONE_RATIO * step.durationS) return;
    const skip = Math.min(RAMP_IN_S, Math.floor(mine.length * 0.15));
    const kept = mine.slice(skip);
    const p = avg(kept.map((s) => s.powerW ?? 0));
    const t = avg(defined(kept, 'targetW'));
    if (p !== undefined && t !== undefined && t > 0 && p >= HELD_RATIO * t) held++;
  });
  return total ? { held, total } : undefined;
}

/** Courbe ramenée à `max` points au plus : moyennes de puissance et de consigne par paquet de secondes consécutives. */
export function chartBuckets(samples: Sample[], max = MAX_BUCKETS): ChartBucket[] {
  if (!samples.length) return [];
  const k = Math.ceil(samples.length / max);
  const out: ChartBucket[] = [];
  for (let i = 0; i < samples.length; i += k) {
    const chunk = samples.slice(i, i + k);
    const p = avg(defined(chunk, 'powerW'));
    const targets = defined(chunk, 'targetW');
    // Une consigne présente sur moins de la moitié du paquet (fin de séance, palier libre) n'est pas dessinée.
    const t = targets.length * 2 >= chunk.length ? avg(targets) : undefined;
    out.push({
      ...(p !== undefined ? { powerW: Math.round(p) } : {}),
      ...(t !== undefined ? { targetW: Math.round(t) } : {}),
    });
  }
  return out;
}

export function summarize(rec: Recording, opts: { ftpW: number; workout?: Workout }): RecapSummary {
  const { ftpW } = opts;
  const samples = rec.samples;
  const power = samples.map((s) => s.powerW ?? 0);
  const measured = defined(samples, 'powerW');
  const hr = defined(samples, 'heartRateBpm').filter((x) => x > 0);
  const cadence = defined(samples, 'cadenceRpm').filter((x) => x > 0);
  const dist = defined(samples, 'distanceM');
  const alts = defined(samples, 'altitudeM');

  let climb = 0;
  for (let i = 1; i < alts.length; i++) climb += Math.max(0, alts[i]! - alts[i - 1]!);

  const zones = Object.fromEntries(POWER_ZONES.map((z) => [z, 0])) as Record<PowerZone, number>;
  for (const p of measured) zones[zoneOf(p / ftpW)]++;

  const np = normalizedPower(power);
  const intensity = np !== undefined ? np / ftpW : undefined;
  const distanceM = dist.length ? Math.max(...dist) - Math.min(...dist) : undefined;
  const chart = chartBuckets(samples);
  const chartPeakW = Math.max(
    1.3 * ftpW,
    ...chart.map((b) => (b.powerW ?? 0) * 1.05),
    ...chart.map((b) => (b.targetW ?? 0) * 1.08),
  );

  return {
    durationS: Math.round(rec.timerS),
    ...(distanceM !== undefined ? { distanceKm: distanceM / 1000 } : {}),
    ...(alts.length ? { climbM: Math.round(climb) } : {}),
    ...(distanceM !== undefined && rec.timerS > 0 ? { avgSpeedKmh: (distanceM / rec.timerS) * 3.6 } : {}),
    ...(measured.length ? { avgPowerW: Math.round(avg(power)!), workKj: Math.round(power.reduce((a, b) => a + b, 0) / 1000) } : {}),
    ...(np !== undefined && intensity !== undefined
      ? { normalizedW: Math.round(np), intensityFactor: intensity, tss: Math.round(((samples.length * np * intensity) / (ftpW * 3600)) * 100) }
      : {}),
    ...(hr.length ? { avgHeartRate: Math.round(avg(hr)!), maxHeartRate: Math.max(...hr) } : {}),
    ...(cadence.length ? { avgCadence: Math.round(avg(cadence)!) } : {}),
    ftpW,
    zones,
    ...(opts.workout ? { efforts: effortsOf(opts.workout, ftpW, samples) } : {}),
    chart,
    chartPeakW,
  };
}
