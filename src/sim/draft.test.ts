import { describe, expect, it } from 'vitest';
import { DRAFT_MAX, DRAFT_RANGE_M, draftFrom, type DraftLeader } from './draft';
import { DEFAULT_RIDER, resistanceForce, step, steadySpeed } from './physics';
import { Ride } from './ride';
import type { Course } from './course';

// Le coureur local est en (0, 0), cap 0 : l'avant est vers +x.
const self = { x: 0, z: 0, heading: 0 };
const leader = (over: Partial<DraftLeader> = {}): DraftLeader => ({ x: 4, z: 0, heading: 0, speedMs: 9, riding: true, ...over });

describe('draftFrom', () => {
  it('abrite un coureur placé juste devant, d’autant plus qu’il est proche', () => {
    const near = draftFrom(self, [leader({ x: 3 })]);
    const far = draftFrom(self, [leader({ x: 12 })]);
    expect(near.reduction).toBeGreaterThan(0.25);
    expect(near.reduction).toBeLessThanOrEqual(DRAFT_MAX);
    expect(far.reduction).toBeLessThan(near.reduction);
    expect(far.reduction).toBeGreaterThan(0);
    expect(near.gapM).toBeCloseTo(3 - 1.8, 5);
  });

  it('ne protège pas : derrière, à côté, trop loin, à contresens, à l’arrêt ou immobile', () => {
    expect(draftFrom(self, [leader({ x: -4 })]).reduction).toBe(0); // derrière
    expect(draftFrom(self, [leader({ x: 6, z: 4 })]).reduction).toBe(0); // dans une autre file
    expect(draftFrom(self, [leader({ x: DRAFT_RANGE_M + 1 })]).reduction).toBe(0); // trop loin
    expect(draftFrom(self, [leader({ heading: Math.PI })]).reduction).toBe(0); // à contresens
    expect(draftFrom(self, [leader({ riding: false })]).reduction).toBe(0); // sortie arrêtée
    expect(draftFrom(self, [leader({ speedMs: 0.5 })]).reduction).toBe(0); // plus lent qu'un piéton
    expect(draftFrom(self, [])).toEqual({ reduction: 0 });
  });

  it('prend le meilleur abri parmi plusieurs coureurs, sans les additionner', () => {
    const one = draftFrom(self, [leader({ x: 4 })]).reduction;
    const two = draftFrom(self, [leader({ x: 4 }), leader({ x: 7 })]).reduction;
    expect(two).toBe(one);
  });

  it('suit le cap du coureur local', () => {
    const turned = { x: 0, z: 0, heading: Math.PI / 2 }; // l'avant est vers +z
    expect(draftFrom(turned, [leader({ x: 0, z: 5, heading: Math.PI / 2 })]).reduction).toBeGreaterThan(0.2);
    expect(draftFrom(turned, [leader({ x: 5, z: 0, heading: 0 })]).reduction).toBe(0);
  });
});

describe('physique avec abri', () => {
  const p = DEFAULT_RIDER;

  it('ne change que la part de l’air', () => {
    const flat = resistanceForce(10, 0, p);
    const drafted = resistanceForce(10, 0, p, 0, 0.3);
    const air = 0.5 * p.airDensity * p.cdA * 100;
    expect(flat - drafted).toBeCloseTo(0.3 * air, 6);
    // En forte côte, à faible vitesse, l'air pèse peu : l'abri aide peu (c'est le comportement attendu).
    const climb = resistanceForce(2, 10, p);
    expect((climb - resistanceForce(2, 10, p, 0, 0.3)) / climb).toBeLessThan(0.02);
  });

  it('fait rouler plus vite à puissance égale, sur le plat surtout', () => {
    const solo = steadySpeed(250, 0, p);
    const abri = steadySpeed(250, 0, p, 0.3);
    expect(abri).toBeGreaterThan(solo * 1.1);
    let v = solo;
    for (let i = 0; i < 2000; i++) v = step(v, 250, 0, 0.05, p, 0, 0, 0.3).v;
    expect(v).toBeCloseTo(abri, 1);
  });

  it('borne la réduction entre 0 et 1', () => {
    expect(resistanceForce(10, 0, p, 0, -1)).toBe(resistanceForce(10, 0, p));
    expect(resistanceForce(10, 0, p, 0, 5)).toBeCloseTo(p.massKg * 9.80665 * p.crr, 6);
  });
});

describe('Ride avec abri', () => {
  const flat: Course = { gradeAt: () => 0, altitudeAt: () => 0 } as unknown as Course;

  it('avance plus loin avec abri ; une réduction négative est sans effet', () => {
    const run = (draft: number) => {
      const r = new Ride(flat);
      r.setDraft(draft);
      let s = r.snapshot();
      for (let i = 0; i < 600; i++) s = r.advance(0.1, 250); // 60 s à 250 W
      return s.distanceM;
    };
    expect(run(0.3)).toBeGreaterThan(run(0) * 1.05); // 60 s depuis l'arrêt : l'accélération amortit l'écart d'équilibre
    expect(run(0)).toBe(run(-1)); // valeur négative : sans effet
  });
});
