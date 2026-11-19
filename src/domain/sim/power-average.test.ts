import { describe, expect, it } from 'vitest';
import { PowerAverage } from './power-average';

describe('PowerAverage', () => {
  it('moyenne les mesures des 3 dernières secondes', () => {
    const p = new PowerAverage();
    p.push(100, 0);
    p.push(200, 1000);
    p.push(300, 2000);
    expect(p.value(2000)).toBe(200);
    p.push(400, 3500); // la mesure à 0 s sort de la fenêtre
    expect(p.value(3500)).toBe(300);
  });

  it('se tait quand le capteur se tait', () => {
    const p = new PowerAverage();
    p.push(250, 0);
    expect(p.value(3001)).toBeUndefined();
  });
});
