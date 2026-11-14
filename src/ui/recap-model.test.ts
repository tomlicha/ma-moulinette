import { describe, expect, it } from 'vitest';
import type { Recording, Sample } from '../export/recorder';
import type { StepKind, Workout, WorkoutStep } from '../workout/model';
import { chartBuckets, effortsOf, isEffort, normalizedPower, summarize } from './recap-model';

const T0 = Date.UTC(2026, 10, 14, 17, 42, 0);
const FTP = 250;

const step = (kind: StepKind, durationS: number, from: number, to = from): WorkoutStep => ({
  kind,
  durationS,
  target: kind === 'free' ? { kind: 'free' } : { kind: 'ftp', from, to },
});
const wo = (steps: WorkoutStep[]): Workout => ({ name: 'Essai', steps, messages: [], warnings: [] });

/** Déroule la séance seconde par seconde ; `power(i, target)` donne la puissance roulée. */
function ride(w: Workout, power: (i: number, targetW: number | undefined) => number): Sample[] {
  const out: Sample[] = [];
  let i = 0;
  w.steps.forEach((s, stepIndex) => {
    for (let t = 0; t < s.durationS; t++, i++) {
      const tg = s.target.kind === 'ftp' ? Math.round((s.target.from + ((s.target.to - s.target.from) * t) / s.durationS) * FTP) : undefined;
      out.push({ t: T0 + i * 1000, powerW: power(i, tg), ...(tg !== undefined ? { targetW: tg } : {}), stepIndex, distanceM: i * 8, altitudeM: 100 });
    }
  });
  return out;
}

const recording = (samples: Sample[]): Recording => ({
  startMs: samples[0]!.t,
  endMs: samples.at(-1)!.t + 1000,
  elapsedS: samples.length,
  timerS: samples.length,
  samples,
  pauses: [],
});

describe('normalizedPower', () => {
  it('vaut la puissance elle-même quand elle est constante', () => {
    expect(normalizedPower(Array(120).fill(200))).toBeCloseTo(200, 6);
  });

  it('pèse plus lourd que la moyenne quand la puissance varie', () => {
    const p = Array.from({ length: 600 }, (_, i) => (Math.floor(i / 60) % 2 ? 300 : 100));
    expect(normalizedPower(p)!).toBeGreaterThan(200);
  });

  it('reste indéfinie sous 30 s', () => {
    expect(normalizedPower(Array(29).fill(200))).toBeUndefined();
  });
});

describe('isEffort', () => {
  it('écarte échauffement, récupération, retour au calme, libre et ce qui est sous le tempo', () => {
    expect(isEffort(step('on', 60, 1.1), FTP)).toBe(true);
    expect(isEffort(step('steady', 600, 0.9), FTP)).toBe(true);
    expect(isEffort(step('steady', 600, 0.7), FTP)).toBe(false);
    expect(isEffort(step('warmup', 600, 0.5, 1), FTP)).toBe(false);
    expect(isEffort(step('off', 60, 1.0), FTP)).toBe(false);
    expect(isEffort(step('free', 60, 0), FTP)).toBe(false);
  });
});

describe('effortsOf', () => {
  const w = wo([step('warmup', 120, 0.5, 0.7), step('on', 60, 1.0), step('off', 60, 0.5), step('on', 60, 1.0), step('cooldown', 60, 0.5)]);

  it('compte les blocs tenus, en laissant au trainer le temps de monter en début de palier', () => {
    // Montée lente sur les 4 premières secondes de chaque palier, puis la consigne.
    const samples = ride(w, (i, tg) => (tg === undefined ? 0 : tg - (i % 60 < 4 ? 100 : 0)));
    expect(effortsOf(w, FTP, samples)).toEqual({ held: 2, total: 2 });
  });

  it("ne compte pas un bloc roulé trop bas ou passé avant la fin", () => {
    const samples = ride(w, (_, tg) => tg ?? 0)
      .map((s) => (s.stepIndex === 1 ? { ...s, powerW: 200 } : s)) // 80 % de la consigne
      .filter((s, i) => !(s.stepIndex === 3 && i % 60 > 30)); // second bloc passé à mi-chemin
    expect(effortsOf(w, FTP, samples)).toEqual({ held: 0, total: 2 });
  });

  it('ne dit rien d’une séance sans bloc d’effort', () => {
    expect(effortsOf(wo([step('steady', 600, 0.6)]), FTP, [])).toBeUndefined();
  });
});

describe('chartBuckets', () => {
  it('ramène la courbe au nombre de points voulu', () => {
    const samples = Array.from({ length: 1000 }, (_, i): Sample => ({ t: T0 + i * 1000, powerW: 200, targetW: 210 }));
    const b = chartBuckets(samples, 100);
    expect(b).toHaveLength(100);
    expect(b[0]).toEqual({ powerW: 200, targetW: 210 });
  });

  it('ne dessine pas une consigne présente sur moins de la moitié du paquet', () => {
    const samples = Array.from({ length: 10 }, (_, i): Sample => ({ t: T0 + i * 1000, powerW: 100, ...(i < 3 ? { targetW: 200 } : {}) }));
    expect(chartBuckets(samples, 1)).toEqual([{ powerW: 100 }]);
  });
});

describe('summarize', () => {
  it('tire les mesures de l’enregistrement', () => {
    const w = wo([step('steady', 3600, 0.8)]);
    const samples = ride(w, () => 200).map((s, i) => ({ ...s, heartRateBpm: 140 + (i % 2) * 10, cadenceRpm: i % 10 ? 90 : 0, altitudeM: 100 + (i % 600 < 300 ? (i % 600) / 10 : 0) }));
    const s = summarize(recording(samples), { ftpW: FTP, workout: w });
    expect(s.durationS).toBe(3600);
    expect(s.avgPowerW).toBe(200);
    expect(s.normalizedW).toBe(200);
    expect(s.intensityFactor).toBeCloseTo(0.8, 6);
    expect(s.tss).toBe(64); // 1 h à IF 0,8
    expect(s.workKj).toBe(720);
    expect(s.avgHeartRate).toBe(145);
    expect(s.maxHeartRate).toBe(150);
    expect(s.avgCadence).toBe(90); // les roues libres ne comptent pas
    expect(s.distanceKm).toBeCloseTo(28.792, 3);
    expect(s.climbM).toBe(179); // 6 montées de 29,9 m
    expect(s.zones.z3).toBe(3600);
    expect(s.efforts).toEqual({ held: 1, total: 1 });
    expect(s.chart.length).toBeLessThanOrEqual(240);
    expect(s.chartPeakW).toBe(1.3 * FTP);
  });

  it('laisse vides les mesures sans capteur', () => {
    const samples: Sample[] = Array.from({ length: 120 }, (_, i) => ({ t: T0 + i * 1000, powerW: 150 }));
    const s = summarize(recording(samples), { ftpW: FTP });
    expect(s.avgHeartRate).toBeUndefined();
    expect(s.avgCadence).toBeUndefined();
    expect(s.distanceKm).toBeUndefined();
    expect(s.efforts).toBeUndefined();
    expect(s.zones.z2).toBe(120);
  });
});
