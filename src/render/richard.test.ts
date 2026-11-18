import { describe, expect, it } from 'vitest';
import { cycleAt, hubHeight, stairHeight, wheelHeight } from './richard';

describe('Richard sur sa roue arrière', () => {
  it('monte puis redescend l’escalier, symétriquement', () => {
    expect(wheelHeight(-4).h).toBeCloseTo(0);
    expect(wheelHeight(0).h).toBeCloseTo(4 * 0.17);
    expect(wheelHeight(4).h).toBeCloseTo(0);
    expect(wheelHeight(-1.2).h).toBeCloseTo(wheelHeight(1.2).h, 1);
  });

  it('garde la roue hors des marches : elle les gravit par l’arête, sans y entrer', () => {
    for (let z = -4; z <= 4; z += 0.01) {
      const hub = hubHeight(z);
      for (let x = z - 0.34; x <= z + 0.34; x += 0.01) {
        const rim = hub - Math.sqrt(Math.max(0, 0.34 ** 2 - (x - z) ** 2));
        expect(rim).toBeGreaterThanOrEqual(stairHeight(x) - 1e-3);
      }
    }
  });

  it('fait des allers-retours en boucle, à l’arrêt aux deux bouts', () => {
    const a = cycleAt(0);
    const b = cycleAt(6);
    expect(a.z).toBeLessThan(-2);
    expect(b.z).toBeGreaterThan(2);
    expect(a.speed).toBeCloseTo(0);
    expect(cycleAt(3).speed).toBeGreaterThan(0);
    expect(cycleAt(9).speed).toBeLessThan(0);
    expect(cycleAt(12).z).toBeCloseTo(a.z);
  });
});
