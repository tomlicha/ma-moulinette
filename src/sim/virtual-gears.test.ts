import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER, G, resistanceForce } from './physics';
import {
  VIRTUAL_GEARS,
  WHEEL_CIRC_M,
  cadenceAt,
  clampGear,
  gearedGradePct,
  nearestGear,
  realRatio,
  trainerModelFor,
  type GearedGradeInput,
} from './virtual-gears';

const trainer = trainerModelFor(DEFAULT_RIDER);
const base = (o: Partial<GearedGradeInput>): GearedGradeInput => ({
  gradePct: 0,
  speedMs: 8,
  virtualRatio: 34 / 14,
  realRatio: 34 / 14,
  rider: DEFAULT_RIDER,
  trainer,
  ...o,
});

/** Force que le trainer oppose pour la pente reçue, à la vitesse de son volant : son calcul, pas le nôtre. */
function trainerForce(gradePct: number, flywheelMs: number) {
  const theta = Math.atan(gradePct / 100);
  return DEFAULT_RIDER.massKg * G * (trainer.crr + Math.sin(theta)) + 0.5 * trainer.cw * flywheelMs * flywheelMs;
}

describe('vitesses virtuelles', () => {
  it('24 braquets croissants, de 0,75 à 5,49', () => {
    expect(VIRTUAL_GEARS).toHaveLength(24);
    expect(VIRTUAL_GEARS[0]).toBe(0.75);
    expect(VIRTUAL_GEARS.at(-1)).toBe(5.49);
    for (let i = 1; i < VIRTUAL_GEARS.length; i++) expect(VIRTUAL_GEARS[i]!).toBeGreaterThan(VIRTUAL_GEARS[i - 1]!);
  });

  it('braquet réel et vitesse de départ', () => {
    expect(realRatio(34)).toBeCloseTo(2.4286, 4);
    expect(VIRTUAL_GEARS[nearestGear(realRatio(34))]).toBe(2.4);
    expect(VIRTUAL_GEARS[nearestGear(realRatio(50))]).toBe(3.49);
    expect(clampGear(-3)).toBe(0);
    expect(clampGear(99)).toBe(23);
  });

  it('braquet virtuel égal au réel : la pente du parcours est rendue telle quelle', () => {
    for (const gradePct of [-4, 0, 3, 8]) {
      expect(gearedGradePct(base({ gradePct }))).toBeCloseTo(gradePct, 1);
    }
  });

  it('à cadence égale, la puissance au pédalier est celle du vélo virtuel', () => {
    for (const [gradePct, speedMs, gear] of [[0, 11, 20], [6, 4, 3], [2, 8, 12], [10, 3, 0]] as const) {
      const virtualRatio = VIRTUAL_GEARS[gear]!;
      const real = realRatio(34);
      const cadenceRpm = cadenceAt(speedMs, virtualRatio);
      const flywheelMs = (cadenceRpm / 60) * real * WHEEL_CIRC_M;
      const sent = gearedGradePct(base({ gradePct, speedMs, virtualRatio, realRatio: real, cadenceRpm }));
      const wanted = resistanceForce(speedMs, gradePct, DEFAULT_RIDER) * speedMs;
      expect(trainerForce(sent, flywheelMs) * flywheelMs).toBeCloseTo(wanted, 0);
    }
  });

  it('monter une vitesse durcit, en descendre une adoucit', () => {
    const at = (gear: number) => gearedGradePct(base({ gradePct: 4, speedMs: 6, virtualRatio: VIRTUAL_GEARS[gear]!, cadenceRpm: 85 }));
    expect(at(13)).toBeGreaterThan(at(12));
    expect(at(11)).toBeLessThan(at(12));
  });

  it('sans cadence exploitable, la vitesse du volant vient de la vitesse virtuelle', () => {
    const o = base({ gradePct: 3, speedMs: 7, virtualRatio: 3.03 });
    const derived = cadenceAt(7, 3.03);
    expect(gearedGradePct({ ...o, cadenceRpm: 0 })).toBeCloseTo(gearedGradePct({ ...o, cadenceRpm: derived }), 6);
    expect(gearedGradePct(o)).toBeCloseTo(gearedGradePct({ ...o, cadenceRpm: derived }), 6);
  });

  it('reste borné dans les cas extrêmes', () => {
    const g = gearedGradePct(base({ gradePct: 25, speedMs: 20, virtualRatio: 5.49, realRatio: realRatio(22), cadenceRpm: 30 }));
    expect(Number.isFinite(g)).toBe(true);
    expect(Math.abs(g)).toBeLessThanOrEqual(100);
  });
});
