import { describe, expect, it } from 'vitest';
import type { Workout, WorkoutStep } from '../../domain/workout/model';
import { filterCards, workoutCard } from './home-workouts-model';

const step = (kind: WorkoutStep['kind'], durationS: number, ftp: number): WorkoutStep => ({ kind, durationS, target: { kind: 'ftp', from: ftp, to: ftp } });
const sweet: Workout = {
  name: 'Sweet spot 2×20',
  steps: [step('warmup', 600, 0.5), step('on', 1200, 0.9), step('off', 300, 0.5), step('on', 1200, 0.9), step('cooldown', 300, 0.5)],
  messages: [],
  warnings: [],
};
const easy: Workout = { name: 'Endurance', steps: [step('steady', 2700, 0.65)], messages: [], warnings: [] };

describe('workoutCard', () => {
  it('résume une séance à intervalles', () => {
    const c = workoutCard('lib:a', sweet, 230);
    expect(c.duration).toBe('60 min');
    expect(c.stats.map((s) => s.value)).toEqual(['207 W', '2 × 20′', 'Z3']);
    expect(c.stats[1]!.label).toBe('récup 5′ à 115 W');
    expect(c.phoneLine).toBe('60 min · 2 × 20′ à 207 W · ERG');
    expect(c.ftpY).toBeGreaterThan(0);
  });

  it('nomme un effort continu', () => {
    const c = workoutCard('lib:b', easy, 230);
    expect(c.stats[1]).toEqual({ value: '45′ continu', label: 'sans pause' });
    expect(c.line).toBe('45 min · 150 W');
  });

  it('filtre par famille', () => {
    const cards = [workoutCard('a', sweet, 230), workoutCard('b', easy, 230)];
    expect(filterCards(cards, 'all')).toHaveLength(2);
    expect(filterCards(cards, 'endurance').map((c) => c.value)).toEqual(['b']);
    expect(filterCards(cards, 'vo2')).toEqual([]);
  });
});
