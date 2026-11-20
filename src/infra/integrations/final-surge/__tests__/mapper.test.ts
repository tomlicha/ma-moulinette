import { describe, expect, it } from 'vitest';
import { mapFinalSurgeWorkout } from '../mapper.ts';

const power = (value: number) => [{ targetType: 'power', targetOption: 'percentFTP', targetLow: value, targetHigh: value }];

describe('mapFinalSurgeWorkout', () => {
  it('uses the midpoint of %FTP ranges as a fixed ERG target', () => {
    const result = mapFinalSurgeWorkout({ Title: 'ERG range' }, { target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', intensity: 'ACTIVE', durationType: 'TIME', duration: '8:00', target: [{ targetType: 'power', targetOption: 'percentFTP', targetLow: 80, targetHigh: 90 }] },
    ] }] });
    expect(result.workout.steps[0]).toMatchObject({ kind: 'steady', durationS: 480, target: { kind: 'ftp', from: 0.85, to: 0.85 } });
    expect(result.workout.warnings.join(' ')).toContain('85 % FTP');
  });

  it('converts fractional warmup ranges to a fixed midpoint', () => {
    const result = mapFinalSurgeWorkout({ Title: 'Warmup' }, { target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', intensity: 'WARMUP', durationType: 'TIME', duration: '15:00', target: [{ targetType: 'power', targetOption: 'percentFTP', targetLow: 0.55, targetHigh: 0.70 }] },
    ] }] });
    expect(result.workout.steps[0]).toMatchObject({ kind: 'warmup', durationS: 900, target: { kind: 'ftp', from: 0.625, to: 0.625 } });
  });

  it('uses midpoint of absolute watt ranges', () => {
    const result = mapFinalSurgeWorkout({ Title: 'Watts' }, { target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', durationType: 'TIME', duration: '4:00', target: [{ targetType: 'power', targetOption: 'watts', targetLow: 180, targetHigh: 220 }] },
    ] }] });
    expect(result.workout.steps[0]?.target).toEqual({ kind: 'watts', from: 200, to: 200 });
  });

  it('expands repetitions and maps warmup, rest and cooldown', () => {
    const result = mapFinalSurgeWorkout({ WorkoutKey: 'k1', Title: 'Intervals', WorkoutDay: '2026-11-21' }, { target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', intensity: 'WARMUP', durationType: 'TIME', duration: '10:00', target: power(60) },
      { type: 'repeat', repeats: 3, data: [
        { type: 'step', intensity: 'ACTIVE', durationType: 'TIME', duration: '05:00', target: power(90) },
        { type: 'step', intensity: 'REST', durationType: 'TIME', duration: '03:00', target: power(50) },
      ] },
      { type: 'step', intensity: 'COOLDOWN', durationType: 'TIME', duration: '5:00', target: power(45) },
    ] }] });
    expect(result.workout.steps).toHaveLength(8);
    expect(result.workout.steps[0]).toMatchObject({ kind: 'warmup', durationS: 600 });
    expect(result.workout.steps[1]).toMatchObject({ kind: 'steady', durationS: 300 });
    expect(result.workout.steps[2]).toMatchObject({ kind: 'off', durationS: 180 });
    expect(result.workout.steps[7]).toMatchObject({ kind: 'cooldown', durationS: 300 });
    expect(result.source).toEqual({ provider: 'final-surge', workoutKey: 'k1', scheduledAt: '2026-11-21' });
  });

  it('skips distance steps and warns rather than inventing a duration', () => {
    const result = mapFinalSurgeWorkout({ Title: 'Distance' }, { target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', intensity: 'ACTIVE', durationType: 'DISTANCE', durationDist: 3, distUnit: 'km', target: power(60) },
    ] }] });
    expect(result.workout.steps).toHaveLength(0);
    expect(result.workout.warnings.join(' ')).toContain('DISTANCE non convertible');
  });

  it('does not guess when the power unit is unknown', () => {
    const result = mapFinalSurgeWorkout({ Title: 'Unknown' }, { target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', durationType: 'TIME', duration: '4:00', target: [{ targetType: 'power', targetOption: 'unknown-unit', targetLow: 200, targetHigh: 200 }] },
    ] }] });
    expect(result.workout.steps[0]?.target).toEqual({ kind: 'free' });
    expect(result.workout.warnings.join(' ')).toContain('unité de cible de puissance inconnue');
  });
});
