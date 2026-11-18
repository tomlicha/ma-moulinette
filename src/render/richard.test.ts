import { describe, expect, it } from 'vitest';
import { cycleAt, wheelHeight } from './richard';

describe('Richard sur sa roue arrière', () => {
  it('monte puis redescend l’escalier, symétriquement', () => {
    expect(wheelHeight(-4).h).toBeCloseTo(0);
    expect(wheelHeight(0).h).toBeCloseTo(4 * 0.17);
    expect(wheelHeight(4).h).toBeCloseTo(0);
    expect(wheelHeight(-1.2).h).toBeCloseTo(wheelHeight(1.2).h, 1);
  });

  it('refait le chemin en sens inverse après un demi-tour sur place', () => {
    const start = cycleAt(0);
    expect(start).toMatchObject({ yaw: 0, dir: 1, moving: true });
    const turning = cycleAt(7); // fin de la première traversée
    expect(turning.moving).toBe(false);
    expect(wheelHeight(turning.z).h).toBeCloseTo(0);
    const back = cycleAt(9.5);
    expect(back).toMatchObject({ yaw: Math.PI, dir: -1, moving: true });
    expect(cycleAt(1e3 + 0.3).z).toBeGreaterThanOrEqual(-3.5);
  });
});
