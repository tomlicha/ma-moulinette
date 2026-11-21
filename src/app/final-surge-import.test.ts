import { describe, expect, it, vi } from 'vitest';
import type { Workout } from '../domain/workout/model';
import { importFinalSurgeWorkouts } from './final-surge-import';

const workout = (name = 'Tempo'): Workout => ({
  name, description: 'Description', warnings: [], messages: [],
  steps: [{ kind: 'steady', durationS: 300, target: { kind: 'ftp', from: 0.9, to: 0.9 } }],
} as Workout);
const item = (name = 'Tempo', key = 'fs-1') => ({
  workout: workout(name), source: { provider: 'final-surge' as const, workoutKey: key, scheduledAt: '2026-11-20' },
});
function setup(initial: any[] = []) {
  const records = [...initial];
  const save = vi.fn((w: any) => {
    const saved = { ...w, id: w.id ?? `id-${records.length + 1}`, updatedAt: Date.now() };
    const i = records.findIndex((x) => x.id === saved.id);
    if (i >= 0) records[i] = saved; else records.unshift(saved);
    return saved;
  });
  const remove = vi.fn((id: string) => {
    const i = records.findIndex((x) => x.id === id);
    if (i >= 0) records.splice(i, 1);
  });
  return { records, library: { list: () => [...records], save, remove } };
}

describe('importFinalSurgeWorkouts', () => {
  it('crée une séance avec un identifiant stable et sa provenance', () => {
    const s = setup();
    expect(importFinalSurgeWorkouts({ library: s.library, workouts: [item()], ftpW: 250 })).toMatchObject({ created: 1, updated: 0 });
    expect(s.records[0].id).toMatch(/^fs-[a-f0-9]{32}$/);
    expect(s.records[0].source).toEqual({ provider: 'final-surge', externalId: 'fs-1', scheduledAt: '2026-11-20' });
  });

  it('produit le même identifiant dans deux bibliothèques indépendantes', () => {
    const first = setup();
    const second = setup();
    importFinalSurgeWorkouts({ library: first.library, workouts: [item()], ftpW: 250 });
    importFinalSurgeWorkouts({ library: second.library, workouts: [item()], ftpW: 250 });
    expect(first.records[0].id).toBe(second.records[0].id);
  });

  it('migre un ancien identifiant aléatoire vers l’identifiant stable', () => {
    const s = setup([{ id: 'local-1', name: 'Tempo', description: 'old', blocks: [], source: { provider: 'final-surge', externalId: 'fs-1' }, updatedAt: 1 }]);
    expect(importFinalSurgeWorkouts({ library: s.library, workouts: [item('Tempo updated')], ftpW: 250 })).toMatchObject({ created: 0, updated: 1 });
    expect(s.records).toHaveLength(1);
    expect(s.records[0].id).toMatch(/^fs-[a-f0-9]{32}$/);
    expect(s.records[0].name).toBe('Tempo updated');
    expect(s.library.remove).toHaveBeenCalledWith('local-1');
  });

  it('consolide les anciennes copies ayant la même provenance', () => {
    const s = setup([
      { id: 'local-1', name: 'Tempo', description: '', blocks: [], source: { provider: 'final-surge', externalId: 'fs-1' }, updatedAt: 1 },
      { id: 'local-2', name: 'Tempo', description: '', blocks: [], source: { provider: 'final-surge', externalId: 'fs-1' }, updatedAt: 2 },
    ]);
    importFinalSurgeWorkouts({ library: s.library, workouts: [item()], ftpW: 250 });
    expect(s.records).toHaveLength(1);
    expect(s.records[0].id).toMatch(/^fs-[a-f0-9]{32}$/);
    expect(s.library.remove).toHaveBeenCalledTimes(2);
    expect(s.library.remove).toHaveBeenCalledWith('local-1');
    expect(s.library.remove).toHaveBeenCalledWith('local-2');
  });

  it('met à jour la séance source existante vers son identifiant stable', () => {
    const s = setup([{ id: 'local-1', name: 'Tempo', description: 'old', blocks: [], source: { provider: 'final-surge', externalId: 'fs-1' }, updatedAt: 1 }]);
    expect(importFinalSurgeWorkouts({ library: s.library, workouts: [item('Tempo updated')], ftpW: 250 })).toMatchObject({ created: 0, updated: 1 });
    expect(s.records).toHaveLength(1);
    expect(s.records[0].id).not.toBe('local-1');
    expect(s.records[0].id).toMatch(/^fs-[a-f0-9]{32}$/);
    expect(s.records[0].name).toBe('Tempo updated');
    expect(s.library.remove).toHaveBeenCalledWith('local-1');
  });

  it('ne réécrit pas une séance inchangée', () => {
    const s = setup();
    importFinalSurgeWorkouts({ library: s.library, workouts: [item()], ftpW: 250 });
    s.library.save.mockClear();
    expect(importFinalSurgeWorkouts({ library: s.library, workouts: [item()], ftpW: 250 })).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(s.library.save).not.toHaveBeenCalled();
  });

  it('ignore les séances sans identifiant externe ou sans étapes', () => {
    const s = setup();
    const noKey = { workout: workout(), source: { provider: 'final-surge' as const } };
    const noSteps = { workout: { ...workout(), steps: [] }, source: { provider: 'final-surge' as const, workoutKey: 'fs-2' } };
    expect(importFinalSurgeWorkouts({ library: s.library, workouts: [noKey, noSteps], ftpW: 250 }).skipped).toBe(2);
  });

  it('convertit une zone en puissance ERG au milieu de la plage du cycliste', () => {
    const s = setup();
    const zoned = { ...item(), workout: { ...workout(), steps: [{ kind: 'steady' as const, durationS: 900, target: { kind: 'free' as const }, zoneIndex: 2 }] } };
    importFinalSurgeWorkouts({ library: s.library, workouts: [zoned], ftpW: 200, ergMode: true });
    expect(s.records[0].blocks[0]).toMatchObject({ type: 'steady', power: 0.6575 });
  });

  it('conserve les deux bornes de zone sans ERG et les adapte à la FTP', () => {
    const s = setup();
    const zoned = { ...item(), workout: { ...workout(), steps: [{ kind: 'steady' as const, durationS: 900, target: { kind: 'free' as const }, zoneIndex: 2 }] } };
    importFinalSurgeWorkouts({ library: s.library, workouts: [zoned], ftpW: 200, ergMode: false });
    expect(s.records[0].blocks[0]).toMatchObject({ type: 'steady', power: 0.56, powerTo: 0.755 });
    const other = setup();
    importFinalSurgeWorkouts({ library: other.library, workouts: [zoned], ftpW: 300, ergMode: false });
    expect(other.records[0].blocks[0]).toMatchObject({ type: 'steady', power: 0.56, powerTo: 0.7566666666666667 });
  });

  it('applique le plafond conventionnel de 150 % FTP à la Z6 ouverte', () => {
    const s = setup();
    const zoned = { ...item(), workout: { ...workout(), steps: [{ kind: 'steady' as const, durationS: 30, target: { kind: 'free' as const }, zoneIndex: 6 }] } };
    importFinalSurgeWorkouts({ library: s.library, workouts: [zoned], ftpW: 200, ergMode: true });
    expect(s.records[0].blocks[0]).toMatchObject({ type: 'steady', power: 1.355 });
    expect(s.records[0].description).toContain('plafond conventionnel de 150 % FTP');
  });

  it('ne touche pas aux séances locales sans provenance Final Surge', () => {
    const local = { id: 'mine', name: 'My workout', description: '', blocks: [], updatedAt: 1 };
    const s = setup([local]);
    importFinalSurgeWorkouts({ library: s.library, workouts: [item()], ftpW: 250 });
    expect(s.records.some((x) => x.id === 'mine')).toBe(true);
  });
});
