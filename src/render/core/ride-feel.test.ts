import { describe, expect, it } from 'vitest';
import { FOV_BASE, fovFor, LOOK_FOLLOW, lookHeight, SEATED_STATE, standingStep, swayPhaseStep, swayRoll, type StandingInput, type StandingState } from './ride-feel';

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

describe('standingStep', () => {
  const FTP = 250;
  const run = (from: StandingState, m: Partial<StandingInput>, seconds: number) => {
    let s = from;
    for (let t = 0; t < seconds; t += 0.1) s = standingStep(s, { gradePct: 0, cadenceRpm: 90, powerW: 200, ftpW: FTP, ...m }, 0.1);
    return s;
  };

  it('reste assis à plat à puissance normale', () => {
    expect(run(SEATED_STATE, {}, 30).on).toBe(false);
  });

  it('se lève dans une côte raide à cadence basse, après un délai', () => {
    expect(run(SEATED_STATE, { gradePct: 9, cadenceRpm: 55 }, 1).on).toBe(false);
    expect(run(SEATED_STATE, { gradePct: 9, cadenceRpm: 55 }, 3).on).toBe(true);
  });

  it("ne se lève pas quand on moulines en côte ou à l'arrêt", () => {
    expect(run(SEATED_STATE, { gradePct: 9, cadenceRpm: 95 }, 30).on).toBe(false);
    expect(run(SEATED_STATE, { gradePct: 9, cadenceRpm: 0 }, 30).on).toBe(false);
  });

  it('se lève sur un pic de puissance, sur le plat comme en descente', () => {
    expect(run(SEATED_STATE, { gradePct: 0, powerW: 700, cadenceRpm: 105 }, 3).on).toBe(true);
    expect(run(SEATED_STATE, { gradePct: -6, powerW: 700, cadenceRpm: 105 }, 3).on).toBe(true);
  });

  it('ne se lève pas pour un pic trop bref ou trop faible', () => {
    expect(run(SEATED_STATE, { powerW: 700, cadenceRpm: 105 }, 0.3).on).toBe(false);
    expect(run(SEATED_STATE, { powerW: 300, cadenceRpm: 105 }, 30).on).toBe(false);
  });

  it('sans FTP connu, seule la côte compte', () => {
    expect(run(SEATED_STATE, { powerW: 900, ftpW: 0 }, 10).on).toBe(false);
  });

  it("se rassoit quand la pente s'adoucit, sans hésiter entre les deux seuils", () => {
    const up = run(SEATED_STATE, { gradePct: 9, cadenceRpm: 55 }, 3);
    expect(run(up, { gradePct: 6, cadenceRpm: 55 }, 30).on).toBe(true);
    expect(run(up, { gradePct: 2, cadenceRpm: 55 }, 4).on).toBe(false);
  });

  it('se rassoit quand le sprint retombe', () => {
    const up = run(SEATED_STATE, { powerW: 700, cadenceRpm: 105 }, 3);
    expect(run(up, { powerW: 200, cadenceRpm: 95 }, 5).on).toBe(false);
  });

  it('se rassoit dès que la puissance passe sous 140 % de la FTP', () => {
    const up = run(SEATED_STATE, { powerW: 700, cadenceRpm: 105 }, 3);
    expect(run(up, { powerW: 1.2 * FTP, cadenceRpm: 95 }, 8).on).toBe(false);
  });

  it('un bref écart ne change rien', () => {
    const up = run(SEATED_STATE, { gradePct: 9, cadenceRpm: 55 }, 3);
    expect(run(run(up, { gradePct: 2, cadenceRpm: 55 }, 1), { gradePct: 9, cadenceRpm: 55 }, 5).on).toBe(true);
  });
});
