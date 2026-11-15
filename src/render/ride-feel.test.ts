import { describe, expect, it } from 'vitest';
import { FOV_BASE, fovFor, LOOK_FOLLOW, lookHeight, swayPhaseStep, swayRoll } from './ride-feel';

describe('fovFor', () => {
  it('vaut le champ de base à plat et à vitesse tranquille', () => {
    expect(fovFor(0, 20)).toBeCloseTo(FOV_BASE, 9);
  });

  it('se resserre en montée, de plus en plus, puis plafonne à 10 %', () => {
    expect(fovFor(5, 20)).toBeLessThan(fovFor(0, 20));
    expect(fovFor(10, 20)).toBeLessThan(fovFor(5, 20));
    expect(fovFor(14, 20)).toBeCloseTo(fovFor(10, 20), 9);
  });

  it("s'élargit en descente et à grande vitesse", () => {
    expect(fovFor(-8, 20)).toBeGreaterThan(fovFor(0, 20));
    expect(fovFor(0, 60)).toBeGreaterThan(fovFor(0, 20));
  });

  it('reste dans une plage où le décor ne se déforme pas', () => {
    for (const g of [-20, -10, 0, 10, 20]) for (const v of [0, 30, 80]) {
      const f = fovFor(g, v);
      expect(f).toBeGreaterThan(45);
      expect(f).toBeLessThan(72);
    }
  });
});

describe('lookHeight', () => {
  it('à plat, regarde à la hauteur des yeux', () => {
    expect(lookHeight(100, 100)).toBeCloseTo(101.05, 9);
  });

  it('en côte, vise plus haut ; en descente, plus bas ; d\'une part seulement de la pente', () => {
    expect(lookHeight(100, 102)).toBeGreaterThan(lookHeight(100, 100));
    expect(lookHeight(100, 98)).toBeLessThan(lookHeight(100, 100));
    expect(lookHeight(100, 102) - lookHeight(100, 100)).toBeCloseTo(2 * LOOK_FOLLOW, 9);
  });
});

describe('swayRoll', () => {
  it("est nul à l'arrêt", () => {
    expect(swayRoll(8, 0)).toBe(0);
  });

  it('grandit avec la pente et avec une cadence basse', () => {
    expect(swayRoll(8, 80)).toBeGreaterThan(swayRoll(0, 80));
    expect(swayRoll(8, 60)).toBeGreaterThan(swayRoll(8, 100));
  });

  it('reste petit : moins de 4°', () => {
    expect(swayRoll(30, 30)).toBeLessThan((4 * Math.PI) / 180);
  });
});

describe('swayPhaseStep', () => {
  it('fait un tour de balancement en deux tours de pédalier', () => {
    // 60 tr/min pendant 2 s = 2 tours de pédalier = 2π de phase.
    expect(swayPhaseStep(60, 2)).toBeCloseTo(2 * Math.PI, 9);
  });
});
