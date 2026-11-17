import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../sim/courses/col-des-erables';
import { ANNOUNCE_M, Journey } from '../sim/journey';
import { AHEAD_M, BEHIND_M, buildScene, junctionScene } from './ride-map-scene';

const MOULIN_M = COL_DES_ERABLES.edges.get('vallee')!.lengthM;

describe('buildScene', () => {
  it('place le coureur sur le trajet, avec son cap', () => {
    const j = new Journey(COL_DES_ERABLES);
    const s = buildScene(j, 100, undefined);
    const p = j.pointAt(100);
    expect(s.self).toEqual({ x: p.x, z: p.z, heading: p.heading });
    expect(s.riders).toEqual([]);
    expect(s.junction).toBeUndefined();
  });
  it('trace la route derrière et devant, la dernière à l’extrémité demandée', () => {
    const j = new Journey(COL_DES_ERABLES);
    const s = buildScene(j, 500, undefined);
    const behind = j.pointAt(500 - BEHIND_M);
    const ahead = j.pointAt(500 + AHEAD_M);
    expect(s.behind[0]).toEqual({ x: behind.x, z: behind.z });
    expect(s.ahead[s.ahead.length - 1]).toEqual({ x: ahead.x, z: ahead.z });
    expect(s.behind.length).toBeGreaterThan(5);
  });
  it('ne recule pas avant le départ', () => {
    const j = new Journey(COL_DES_ERABLES);
    const s = buildScene(j, 30, undefined);
    const start = j.pointAt(0);
    expect(s.behind[0]).toEqual({ x: start.x, z: start.z });
  });
  it('reprend les coureurs proches, avec leur place', () => {
    const j = new Journey(COL_DES_ERABLES);
    const s = buildScene(j, 30, { ahead: [{ slot: 4, name: 'A', gapM: 50, x: 5, z: 6 }], behind: [{ slot: 9, name: 'B', gapM: -20, x: 7, z: 8 }] });
    expect(s.riders).toEqual([{ x: 5, z: 6, slot: 4 }, { x: 7, z: 8, slot: 9 }]);
  });
  it('la route devant suit le choix fait au carrefour', () => {
    const j = new Journey(COL_DES_ERABLES);
    const d = MOULIN_M - 200;
    const before = buildScene(j, d, undefined).ahead.at(-1)!;
    const p = j.pendingJunction(d)!;
    const other = p.options.findIndex((o) => o.edgeId === 'pres');
    expect(other).toBeGreaterThanOrEqual(0);
    j.choose(other);
    const after = buildScene(j, d, undefined).ahead.at(-1)!;
    expect(after).not.toEqual(before);
  });
});

describe('junctionScene', () => {
  const j = new Journey(COL_DES_ERABLES);
  const d = MOULIN_M - 210;
  const p = j.pendingJunction(d)!;
  const js = junctionScene(j, p)!;

  it('annonce le Moulin à 210 m avec ses trois routes, nommées', () => {
    expect(p.distanceM).toBeLessThanOrEqual(ANNOUNCE_M);
    expect(js.name).toBe('Le Moulin');
    expect(js.options.map((o) => o.label).sort()).toEqual(['Le Col', 'Les Collines', 'Les Prés']);
  });
  it('la route retenue par défaut est celle du parcours, une seule est marquée', () => {
    const sel = js.options.filter((o) => o.selected);
    expect(sel).toHaveLength(1);
    expect(sel[0]!.label).toBe('Le Col');
  });
  it('chaque route part du nœud et s’en éloigne', () => {
    for (const o of js.options) {
      const first = o.pts[0]!;
      expect(Math.hypot(first.x - js.node.x, first.z - js.node.z)).toBeLessThan(2);
      const last = o.pts.at(-1)!;
      expect(Math.hypot(last.x - js.node.x, last.z - js.node.z)).toBeGreaterThan(100);
    }
  });
  it('donne la montée sous le nom : « plat » pour les Prés, mètres pour le Col', () => {
    const by = Object.fromEntries(js.options.map((o) => [o.label, o.sub]));
    expect(by['Les Prés']).toBe('plat');
    expect(by['Le Col']).toMatch(/^\+\d{3} m$/);
  });
  it('un nœud inconnu ne donne rien', () => {
    expect(junctionScene(j, { ...p, nodeId: 'nulle-part' })).toBeUndefined();
  });
});
