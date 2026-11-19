import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../../domain/course/courses/col-des-erables';
import { CourseSelection, courseSummary } from './course-selection';

const memory = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('courseSummary', () => {
  it('donne la longueur et la montée arrondie à 10 m', () => {
    expect(courseSummary({ lengthM: 16_020, climbM: 372.4 })).toBe('16,0 km · +370 m');
  });

  it('dit « plat » quand la montée est négligeable', () => {
    expect(courseSummary({ lengthM: 9_620, climbM: 18 })).toBe('9,6 km · plat');
  });

  it('décrit bien les deux parcours du monde des Érables', () => {
    const [col, rive] = COL_DES_ERABLES.courses.map((c) => courseSummary(COL_DES_ERABLES.courseStats(c)));
    expect(col).toMatch(/^1[5-7],\d km · \+3[6-9]0 m$/);
    expect(rive).toMatch(/^9,\d km · plat$/);
  });
});

describe('CourseSelection', () => {
  it('prend le premier parcours au départ', () => {
    expect(new CourseSelection(COL_DES_ERABLES, memory(), 'c').selected.id).toBe('col');
  });

  it('reprend le parcours gardé, et ignore un identifiant disparu', () => {
    expect(new CourseSelection(COL_DES_ERABLES, memory({ c: 'rive' }), 'c').selected.id).toBe('rive');
    expect(new CourseSelection(COL_DES_ERABLES, memory({ c: 'disparu' }), 'c').selected.id).toBe('col');
  });

  it('change de parcours, le garde, et dit si quelque chose a changé', () => {
    const store = memory();
    const s = new CourseSelection(COL_DES_ERABLES, store, 'c');
    expect(s.select('rive')).toBe(true);
    expect(s.selected.id).toBe('rive');
    expect(store.getItem('c')).toBe('rive');
    expect(s.select('rive')).toBe(false); // déjà retenu
    expect(s.select('inconnu')).toBe(false);
  });

  it('survit à un stockage qui refuse d\u2019écrire', () => {
    const broken = { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('plein'); } };
    const s = new CourseSelection(COL_DES_ERABLES, broken, 'c');
    expect(s.selected.id).toBe('col');
    expect(s.select('rive')).toBe(true);
    expect(s.selected.id).toBe('rive');
  });
});
