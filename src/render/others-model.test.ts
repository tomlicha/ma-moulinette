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

import { AHEAD_SHOWN, BEHIND_SHOWN, formatGap, hueOf, nearby } from './others-model';

describe('hueOf', () => {
  it('donne des teintes différentes aux places voisines', () => {
    const hues = Array.from({ length: 12 }, (_, i) => hueOf(i));
    for (let i = 1; i < hues.length; i++) expect(Math.abs(hues[i]! - hues[i - 1]!)).toBeGreaterThan(0.1);
    for (const h of hues) expect(h).toBeGreaterThanOrEqual(0);
    for (const h of hues) expect(h).toBeLessThan(1);
  });
});

describe('nearby', () => {
  // Joueur en (0, 0), cap 0 : l'avant est vers +x.
  const self = { x: 0, z: 0, heading: 0 };
  const at = (slot: number, x: number, z = 0) => ({ slot, name: `C${slot}`, x, z });

  it('sépare devant et derrière selon le cap', () => {
    const n = nearby(self, [at(1, 50), at(2, -30), at(3, 10)]);
    expect(n.ahead.map((r) => r.slot)).toEqual([1, 3]); // du plus éloigné au plus proche
    expect(n.behind.map((r) => r.slot)).toEqual([2]);
    expect(n.ahead[0]!.gapM).toBe(50);
    expect(n.behind[0]!.gapM).toBe(-30);
  });

  it(`garde les ${AHEAD_SHOWN} plus proches devant et les ${BEHIND_SHOWN} plus proches derrière`, () => {
    const riders = [
      ...Array.from({ length: 12 }, (_, i) => at(i, 10 * (i + 1))),
      ...Array.from({ length: 6 }, (_, i) => at(100 + i, -10 * (i + 1))),
    ];
    const n = nearby(self, riders);
    expect(n.ahead).toHaveLength(AHEAD_SHOWN);
    expect(n.behind).toHaveLength(BEHIND_SHOWN);
    expect(n.ahead.map((r) => r.gapM)).toEqual([70, 60, 50, 40, 30, 20, 10]);
    expect(n.behind.map((r) => r.gapM)).toEqual([-10, -20, -30]);
  });

  it('suit le cap : cap vers −x, un coureur en +x est derrière', () => {
    const n = nearby({ x: 0, z: 0, heading: Math.PI }, [at(1, 40)]);
    expect(n.ahead).toHaveLength(0);
    expect(n.behind[0]!.gapM).toBe(-40);
  });

  it('ignore les coureurs hors de portée', () => {
    expect(nearby(self, [at(1, 5000), at(2, -5000)])).toEqual({ ahead: [], behind: [] });
  });

  it('renvoie des listes vides sans personne', () => {
    expect(nearby(self, [])).toEqual({ ahead: [], behind: [] });
  });
});

describe('formatGap', () => {
  it('signe, arrondit par 5 m et passe en km', () => {
    expect(formatGap(42)).toBe('+40 m');
    expect(formatGap(-13)).toBe('−15 m');
    expect(formatGap(998)).toBe('+1000 m');
    expect(formatGap(1234)).toBe('+1,2 km');
    expect(formatGap(-2500)).toBe('−2,5 km');
    expect(formatGap(-1)).toBe('0 m');
    expect(formatGap(2)).toBe('0 m');
  });
});
