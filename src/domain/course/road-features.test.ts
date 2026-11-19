import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from './courses/col-des-erables';
import { bends, ramps } from './road-features';

const edge = (id: string) => COL_DES_ERABLES.edges.get(id)!;

describe('rampes et virages', () => {
  it('voit le Col comme une seule grande rampe', () => {
    const found = ramps(edge('col'));
    expect(found.length).toBe(1);
    const [ramp] = found;
    expect(ramp!.to - ramp!.from).toBeGreaterThan(4000);
    expect(ramp!.gradePct).toBeGreaterThan(5.5);
    expect(ramp!.gradePct).toBeLessThan(8);
  });

  it('donne une pente négative à une route qui descend', () => {
    const found = ramps(edge('descente'));
    expect(found.length).toBe(1);
    expect(found[0]!.gradePct).toBeLessThan(-6);
  });

  it('ne trouve ni rampe ni virage serré sur le plat', () => {
    for (const id of ['canal', 'pres', 'vallee']) {
      expect(ramps(edge(id)), id).toEqual([]);
      expect(bends(edge(id)), id).toEqual([]);
    }
  });

  it('trouve les virages serrés du Col, alternés droite et gauche', () => {
    const found = bends(edge('col'));
    expect(found.length).toBe(6);
    found.forEach((b, i) => {
      expect(b.radiusM).toBeLessThan(60);
      expect(b.to - b.from).toBeGreaterThanOrEqual(20);
      if (i > 0) expect(b.turn).toBe(-found[i - 1]!.turn);
    });
  });
});
