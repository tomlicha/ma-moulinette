import { describe, expect, it } from 'vitest';
import type { Workout, WorkoutStep } from './model';
import { digestWorkout } from './summary';

const step = (kind: WorkoutStep['kind'], durationS: number, ftp: number): WorkoutStep => ({ kind, durationS, target: { kind: 'ftp', from: ftp, to: ftp } });
const workout = (...steps: WorkoutStep[]): Workout => ({ name: 't', steps, messages: [], warnings: [] });
const FTP = 200;

describe('digestWorkout', () => {
  it('lit des intervalles réguliers : 2 × 20′ avec 5′ de récupération', () => {
    const d = digestWorkout(workout(step('warmup', 600, 0.5), step('on', 1200, 0.9), step('off', 300, 0.5), step('on', 1200, 0.9), step('cooldown', 300, 0.5)), FTP);
    expect(d.intervals).toEqual({ count: 2, durationS: 1200, recoveryS: 300, recoveryW: 100 });
    expect(d.effortW).toBe(180);
    expect(d.effortPct).toBe(90);
    expect(d.category).toBe('seuil');
    expect(d.dominant.zone).toBe('z3');
  });

  it('classe une séance sans effort en endurance, sans intervalles', () => {
    const d = digestWorkout(workout(step('steady', 2700, 0.65)), FTP);
    expect(d.category).toBe('endurance');
    expect(d.intervals).toBeUndefined();
    expect(d.effortW).toBe(130);
  });

  it('classe les efforts au-dessus du seuil en VO2', () => {
    const d = digestWorkout(workout(step('on', 240, 1.15), step('off', 240, 0.5), step('on', 240, 1.15)), FTP);
    expect(d.category).toBe('vo2');
    expect(d.intervals?.count).toBe(2);
  });

  it('ne parle pas d’intervalles quand les efforts diffèrent', () => {
    const d = digestWorkout(workout(step('on', 600, 0.95), step('off', 300, 0.5), step('on', 900, 0.95)), FTP);
    expect(d.intervals).toBeUndefined();
  });
});
