import { describe, expect, it, vi } from 'vitest';
import { defaultBlock } from '../domain/workout/blocks';
import { WorkoutLibrary } from '../domain/workout/library';
import { SAMPLE_WORKOUTS } from '../domain/workout/samples';
import type { KeyValueStore } from '../shared/util/key-value-store';
import { WorkoutCatalog } from './workout-catalog';

function setup() {
  const data = new Map<string, string>();
  const store: KeyValueStore = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  let n = 0;
  const library = new WorkoutLibrary(store, () => `w${++n}`);
  const log = vi.fn();
  return { catalog: new WorkoutCatalog({ library, log }), library, log };
}

describe('WorkoutCatalog', () => {
  it('propose les modèles livrés, et pas de séance à soi tant qu\'il n\'y en a pas', () => {
    const { catalog } = setup();
    const { mine, samples } = catalog.choices();
    expect(mine).toEqual([]);
    expect(samples.map((s) => s.value)).toEqual(SAMPLE_WORKOUTS.map((s) => `sample:${s.id}`));
    expect(samples.every((s) => s.label.length > 0)).toBe(true);
  });

  it('propose les séances du coureur, par leur nom', () => {
    const { catalog, library } = setup();
    const a = library.save({ name: 'Ma séance', blocks: [defaultBlock('steady')] });
    expect(catalog.choices().mine).toEqual([{ value: `lib:${a.id}`, label: 'Ma séance' }]);
  });

  it('retrouve une séance du coureur', () => {
    const { catalog, library } = setup();
    const a = library.save({ name: 'Ma séance', description: 'Une description', blocks: [defaultBlock('steady')] });
    const w = catalog.resolve(`lib:${a.id}`);
    expect(w?.name).toBe('Ma séance');
    expect(w?.description).toBe('Une description');
    expect(w?.steps.length).toBeGreaterThan(0);
  });

  it('retrouve un modèle livré', () => {
    const { catalog } = setup();
    const sample = SAMPLE_WORKOUTS[0]!;
    const w = catalog.resolve(`sample:${sample.id}`);
    expect(w).toBeDefined();
    expect(w!.steps.length).toBeGreaterThan(0);
  });

  it('une séance supprimée ou un choix inconnu ne donne rien', () => {
    const { catalog, log } = setup();
    expect(catalog.resolve('lib:disparue')).toBeUndefined();
    expect(catalog.resolve('sample:inconnu')).toBeUndefined();
    expect(catalog.resolve('')).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });
});
