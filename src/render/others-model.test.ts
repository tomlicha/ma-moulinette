import { describe, expect, it } from 'vitest';
import { declutter, laneOf, MAX_TAGS } from './others-model';

describe('laneOf', () => {
  it('reste près de la voie du joueur, sans la recouvrir exactement pour tous', () => {
    const lanes = new Set<number>();
    for (let slot = 0; slot < 40; slot++) {
      const l = laneOf(slot, -1.6);
      expect(Math.abs(l + 1.6)).toBeLessThanOrEqual(0.65);
      lanes.add(Math.round(l * 100));
    }
    expect(lanes.size).toBe(5);
  });
});

describe('declutter', () => {
  it('garde le plus proche quand deux étiquettes se recouvrent', () => {
    const out = declutter([
      { name: 'Robot 4', x: 500, y: 200 },
      { name: 'Marie B.', x: 495, y: 205 },
    ]);
    expect(out.map((t) => t.name)).toEqual(['Robot 4']);
  });

  it('garde deux étiquettes assez éloignées', () => {
    const out = declutter([
      { name: 'Julien', x: 200, y: 200 },
      { name: 'Amélie', x: 600, y: 200 },
      { name: 'Léa', x: 200, y: 260 },
    ]);
    expect(out).toHaveLength(3);
  });

  it(`n'en garde pas plus de ${MAX_TAGS}`, () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `C${i}`, x: i * 300, y: 100 }));
    expect(declutter(many)).toHaveLength(MAX_TAGS);
  });
});
