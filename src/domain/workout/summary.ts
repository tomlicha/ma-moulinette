import { targetWatts, totalDurationS, type Workout } from './model';
import { zoneOf, type Zone } from './profile';
import { timeInZones, type ZoneTimes } from './zones';

/** Famille d'une séance, déduite de la zone où se passe l'effort (filtres de l'accueil). */
export type WorkoutCategory = 'endurance' | 'seuil' | 'vo2';

export interface WorkoutDigest {
  totalS: number;
  category: WorkoutCategory;
  /** Puissance moyenne du temps d'effort (tempo et au-dessus), en W ; la moyenne de la séance s'il n'y a pas d'effort. */
  effortW: number;
  /** `effortW` en pourcentage de la FTP. */
  effortPct: number;
  /** Intervalles réguliers (« 2 × 20′ ») ; absent pour un effort continu ou irrégulier. */
  intervals?: { count: number; durationS: number; recoveryS?: number; recoveryW?: number };
  /** Zone où l'on passe le plus de temps, et sa part du temps total (0 à 1). */
  dominant: { zone: Exclude<Zone, 'free'>; share: number };
  zones: ZoneTimes;
}

const EFFORT_ZONES: Zone[] = ['z3', 'z4', 'z5', 'z6'];

/** Ce qu'il faut savoir d'une séance pour la présenter : durée, famille, puissance d'effort, structure, zone dominante. */
export function digestWorkout(w: Workout, ftpW: number): WorkoutDigest {
  const totalS = totalDurationS(w);
  const zones = timeInZones(w, ftpW);
  const mid = (i: number) => {
    const s = w.steps[i]!;
    return targetWatts(s, s.durationS / 2, ftpW);
  };
  const isEffort = (i: number) => {
    const p = mid(i);
    return p !== undefined && EFFORT_ZONES.includes(zoneOf(p / ftpW));
  };

  let sumW = 0;
  let effortS = 0;
  let allW = 0;
  let allS = 0;
  for (const s of w.steps) {
    for (let t = 0; t < s.durationS; t++) {
      const p = targetWatts(s, t + 0.5, ftpW);
      if (p === undefined) continue;
      allW += p;
      allS++;
      if (EFFORT_ZONES.includes(zoneOf(p / ftpW))) {
        sumW += p;
        effortS++;
      }
    }
  }
  const effortW = Math.round(effortS ? sumW / effortS : allS ? allW / allS : 0);

  const effortTop = EFFORT_ZONES.reduce((a, b) => (zones[b] > zones[a] ? b : a));
  const category: WorkoutCategory =
    effortS < 0.1 * (totalS || 1) ? 'endurance' : effortTop === 'z3' || effortTop === 'z4' ? 'seuil' : 'vo2';

  // Intervalles : au moins deux paliers d'effort de même durée, séparés par des paliers qui n'en sont pas.
  const runs: { i: number; durationS: number }[] = [];
  w.steps.forEach((s, i) => {
    if (isEffort(i)) runs.push({ i, durationS: s.durationS });
  });
  let intervals: WorkoutDigest['intervals'];
  const first = runs[0];
  if (first && runs.length >= 2 && runs.every((r) => r.durationS === first.durationS)) {
    const gap = runs[1]!.i - first.i === 2 ? w.steps[first.i + 1] : undefined;
    intervals = { count: runs.length, durationS: first.durationS };
    if (gap) {
      intervals.recoveryS = gap.durationS;
      const p = mid(first.i + 1);
      if (p !== undefined) intervals.recoveryW = p;
    }
  }

  const zoneIds = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'] as const;
  const top = zoneIds.reduce((a, b) => (zones[b] > zones[a] ? b : a));
  return {
    totalS,
    category,
    effortW,
    effortPct: ftpW ? Math.round((effortW / ftpW) * 100) : 0,
    intervals,
    dominant: { zone: top, share: totalS ? zones[top] / totalS : 0 },
    zones,
  };
}
