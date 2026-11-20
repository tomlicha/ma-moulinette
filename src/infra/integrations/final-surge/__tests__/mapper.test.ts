import { describe, expect, it } from 'vitest';
import { isCyclingIntervalWorkout, mapFinalSurgeWorkout } from '../mapper.ts';

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


  it('maps a 95–105% FTP range to exactly 100% FTP ERG', () => {
    const result = mapFinalSurgeWorkout({ Title: 'Threshold' }, { target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', durationType: 'TIME', duration: '6:00', target: [{ targetType: 'power', targetOption: 'percentFTP', targetLow: 95, targetHigh: 105 }] },
    ] }] });
    expect(result.workout.steps[0]).toMatchObject({ durationS: 360, target: { kind: 'ftp', from: 1, to: 1 } });
  });

  it('maps cadence ranges to their midpoint while preserving the duration', () => {
    const result = mapFinalSurgeWorkout({ Title: 'Cadence' }, { target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', durationType: 'TIME', duration: '3:30', target: [
        { targetType: 'power', targetOption: 'percentFTP', targetLow: 80, targetHigh: 80 },
        { targetType: 'cadence', targetLow: 85, targetHigh: 95 },
      ] },
    ] }] });
    expect(result.workout.steps[0]).toMatchObject({ durationS: 210, cadenceRpm: 90, target: { kind: 'ftp', from: 0.8, to: 0.8 } });
  });

  it('skips malformed duration steps and reports a warning', () => {
    const result = mapFinalSurgeWorkout({ Title: 'Malformed duration' }, { target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', durationType: 'TIME', duration: 'not-a-time', target: power(80) },
    ] }] });
    expect(result.workout.steps).toHaveLength(0);
    expect(result.workout.warnings.join(' ')).toContain('durée absente ou invalide');
  });

  it('does not expand a repetition group beyond the configured safety limit', () => {
    const result = mapFinalSurgeWorkout({ Title: 'Repeat limit' }, { target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'repeat', repeats: 51, data: [
        { type: 'step', durationType: 'TIME', duration: '1:00', target: power(80) },
      ] },
    ] }] });
    expect(result.workout.steps).toHaveLength(0);
    expect(result.workout.warnings.join(' ')).toContain('dépasse la limite de 50');
  });

  it('does not invent a target for malformed repetition groups', () => {
    const result = mapFinalSurgeWorkout({ Title: 'Bad repeat' }, { target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'repeat', repeats: 0, data: [
        { type: 'step', durationType: 'TIME', duration: '1:00', target: power(80) },
      ] },
    ] }] });
    expect(result.workout.steps).toHaveLength(0);
    expect(result.workout.warnings.join(' ')).toContain('groupe de répétitions invalide');
  });
});

describe('isCyclingIntervalWorkout', () => {
  it('accepts a cycling workout with repeated intervals', () => {
    expect(isCyclingIntervalWorkout({ target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', durationType: 'TIME', duration: '10:00', target: power(60) },
      { type: 'repeat', repeats: 4, data: [
        { type: 'step', durationType: 'TIME', duration: '4:00', target: power(105) },
        { type: 'step', intensity: 'REST', durationType: 'TIME', duration: '2:00', target: power(50) },
      ] },
    ] }] })).toBe(true);
  });

  it('accepts a continuous Z2 cycling workout when its block has a defined power target', () => {
    expect(isCyclingIntervalWorkout({ target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', intensity: 'ACTIVE', durationType: 'TIME', duration: '90:00', target: power(65) },
    ] }] })).toBe(true);
  });

  it('accepts watt targets in W without filtering their numeric values', () => {
    expect(isCyclingIntervalWorkout({ target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', durationType: 'TIME', duration: '10:00', target: [{ targetType: 'power', targetOption: 'absolute', unit: 'W', targetLow: 12, targetHigh: 34 }] },
      { type: 'step', durationType: 'TIME', duration: '20:00', target: [{ targetType: 'power', targetOption: 'absolute', unit: 'W', targetLow: 0, targetHigh: 0 }] },
    ] }] })).toBe(true);
  });

  it('rejects a cycling workout if any step, including one inside a repeat, has no power or FTP target', () => {
    expect(isCyclingIntervalWorkout({ target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', durationType: 'TIME', duration: '10:00', target: power(60) },
      { type: 'repeat', repeats: 2, data: [
        { type: 'step', durationType: 'TIME', duration: '5:00', target: power(90) },
        { type: 'step', durationType: 'TIME', duration: '2:00', target: [] },
      ] },
    ] }] })).toBe(false);
  });

  it('accepts a repeated workout when every step has a power target', () => {
    expect(isCyclingIntervalWorkout({ target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'repeat', repeats: 2, data: [
        { type: 'step', durationType: 'TIME', duration: '10:00', target: [{ targetType: 'power', unit: 'W', targetLow: 12, targetHigh: 34 }] },
        { type: 'step', durationType: 'TIME', duration: '20:00', target: [{ targetType: 'power', unit: 'W', targetLow: 12, targetHigh: 243 }] },
      ] },
    ] }] })).toBe(true);
  });

  it('rejects a free cycling workout without a power target', () => {
    expect(isCyclingIntervalWorkout({ target_options: [{ sport: 'cycling', target: 'power', steps: [
      { type: 'step', durationType: 'TIME', duration: '90:00', target: [{ targetType: 'heartRate', targetLow: 120, targetHigh: 130 }] },
    ] }] })).toBe(false);
  });

  it('rejects running and swimming interval workouts', () => {
    for (const sport of ['running', 'swimming']) {
      expect(isCyclingIntervalWorkout({ target_options: [{ sport, target: 'power', steps: [
        { type: 'repeat', repeats: 5, data: [
          { type: 'step', durationType: 'TIME', duration: '4:00', target: power(105) },
          { type: 'step', intensity: 'REST', durationType: 'TIME', duration: '2:00', target: power(50) },
        ] },
      ] }] })).toBe(false);
    }
  });

  it('accepts consecutive cycling work steps with distinct targets', () => {
    expect(isCyclingIntervalWorkout({ target_options: [{ sport: 'bike', target: 'power', steps: [
      { type: 'step', durationType: 'TIME', duration: '5:00', target: power(90) },
      { type: 'step', durationType: 'TIME', duration: '5:00', target: power(105) },
    ] }] })).toBe(true);
  });

  it('rejects an unknown sport rather than guessing', () => {
    expect(isCyclingIntervalWorkout({ target_options: [{ sport: 'running', target: 'pace', steps: [
      { type: 'step', durationType: 'TIME', duration: '5:00', target: power(90) },
      { type: 'step', durationType: 'TIME', duration: '5:00', target: power(105) },
    ] }] })).toBe(false);
  });
});
