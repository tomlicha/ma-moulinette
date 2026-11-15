import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../sim/courses/col-des-erables';
import { DEFAULT_RELIEF, forwardOf, ROAD_HALF, ROAD_TRENCH_M, sideOf, WorldLayout } from './world-layout';

const layout = new WorldLayout(COL_DES_ERABLES);

describe('WorldLayout', () => {
  it('le sol sous la chaussée est à l\'altitude de la route, creusé de quelques centimètres', () => {
    for (const e of layout.edges) {
      for (const p of e.sample(25)) {
        const h = e.headingAt(p.s);
        const side = sideOf(h);
        for (const lat of [0, -ROAD_HALF, ROAD_HALF]) {
          const x = p.x + side.x * lat;
          const z = p.z + side.z * lat;
          const ground = layout.groundY(x, z);
          const road = layout.y(p.altitude);
          // Le sol reste sous la route (on la pose 4 cm au-dessus), jamais de plus que le creux.
          expect(ground).toBeLessThanOrEqual(road + 0.02);
          expect(ground).toBeGreaterThanOrEqual(road - ROAD_TRENCH_M - 0.3);
        }
      }
    }
  });

  it('ne fait pas de falaise près des routes, ni de paroi verticale ailleurs', () => {
    const b = layout.bounds;
    const worst = { near: 0, far: 0 };
    const at = { near: '', far: '' };
    const STEP = 20;
    for (let x = b.minX - 200; x <= b.maxX + 200; x += STEP) {
      let prev = layout.groundAlt(x, b.minZ - 200);
      for (let z = b.minZ - 200 + STEP; z <= b.maxZ + 200; z += STEP) {
        const h = layout.groundAlt(x, z);
        const slope = Math.abs(h - prev) / STEP;
        const zone = layout.roadDistanceAt(x, z) < 250 ? 'near' : 'far';
        if (slope > worst[zone]) {
          worst[zone] = slope;
          at[zone] = `${x.toFixed(0)}, ${z.toFixed(0)}`;
        }
        prev = h;
      }
    }
    // Pentes en altitude réelle, avant exagération. À moins de 250 m d'une route, 50 % au plus : au-delà ce serait un mur
    // au bord de la chaussée. Plus loin, le relief propre peut dresser des sommets, sans jamais approcher la verticale.
    expect(worst.near, `pente maximale près des routes ${(worst.near * 100).toFixed(0)} % en ${at.near}`).toBeLessThan(0.5);
    expect(worst.far, `pente maximale au loin ${(worst.far * 100).toFixed(0)} % en ${at.far}`).toBeLessThan(1);
  }, 30_000);

  it('retombe à plat au loin du réseau', () => {
    const b = layout.bounds;
    expect(Math.abs(layout.groundAlt(b.maxX + 3000, b.maxZ + 3000))).toBeLessThan(0.5);
  });

  it('les collines montent avec les routes : le sommet est plus haut que la vallée', () => {
    const summit = COL_DES_ERABLES.nodes.get('sommet')!;
    const village = COL_DES_ERABLES.nodes.get('village')!;
    const up = layout.farAlt(summit.x + 200, summit.z);
    const down = layout.farAlt(village.x - 200, village.z);
    expect(up).toBeGreaterThan(down + 100);
  });

  it('creuse les lacs sous leur surface et tient la berge au-dessus', () => {
    for (const lake of COL_DES_ERABLES.water.filter((w) => w.kind !== 'canal')) {
      const cx = lake.shore.reduce((s, p) => s + p[0], 0) / lake.shore.length;
      const cz = lake.shore.reduce((s, p) => s + p[1], 0) / lake.shore.length;
      expect(layout.waterAt(cx, cz).sd, lake.id).toBeLessThan(-40);
      expect(layout.groundAlt(cx, cz), lake.id).toBeLessThan(lake.level - 1);
      // Tout autour, à 30 m de la rive côté terre, le sol domine l'eau : le lac ne déborde nulle part.
      for (let a = 0; a < 2 * Math.PI; a += 0.05) {
        for (let r = 20; r < 1500; r += 5) {
          const x = cx + r * Math.cos(a);
          const z = cz + r * Math.sin(a);
          const sd = layout.waterAt(x, z).sd;
          if (sd < 30) continue;
          expect(layout.groundAlt(x, z), `${lake.id} en ${x.toFixed(0)}, ${z.toFixed(0)}`).toBeGreaterThan(lake.level + 0.5);
          break;
        }
      }
    }
  });

  it('creuse les biefs du canal, plus bas d\u2019un bief au suivant', () => {
    const reaches = COL_DES_ERABLES.water.filter((w) => w.kind === 'canal');
    expect(reaches.length).toBe(3);
    reaches.forEach((reach, i) => {
      // Au milieu de la largeur : entre un point du bord intérieur et son vis-à-vis du bord extérieur.
      const mid = reach.shore[3]!;
      const far = reach.shore[reach.shore.length - 4]!;
      const mx = (mid[0] + far[0]) / 2;
      const mz = (mid[1] + far[1]) / 2;
      expect(layout.waterAt(mx, mz).sd, reach.id).toBeLessThan(-3);
      expect(layout.groundAlt(mx, mz), reach.id).toBeLessThan(reach.level);
      if (i > 0) expect(reach.level).toBeLessThan(reaches[i - 1]!.level);
    });
  });

  it("nearestRoad rend la route et l'abscisse du point le plus proche", () => {
    const rank = layout.edges.findIndex((e) => e.id === 'col');
    const p = layout.edges[rank]!.pointAt(1000);
    const hit = layout.nearestRoad(p.x + 3, p.z);
    expect(hit.edge).toBe(rank);
    expect(hit.s).toBeGreaterThan(990);
    expect(hit.s).toBeLessThan(1010);
    expect(layout.autumnAt(hit)).toBeGreaterThan(0.9); // au cœur du bosquet d'érables
    const q = layout.edges.find((e) => e.id === 'canal')!.pointAt(1000);
    expect(layout.autumnAt(layout.nearestRoad(q.x, q.z))).toBe(0);
  });

  it('nearestRoad rend la distance et un Infinity hors de portée', () => {
    const e = layout.edges[0]!;
    const p = e.pointAt(500);
    expect(layout.nearestRoad(p.x, p.z).dist).toBeLessThan(2.5);
    expect(layout.nearestRoad(p.x + 5000, p.z + 5000).dist).toBe(Infinity);
  });

  it('exagère le relief du facteur annoncé', () => {
    expect(layout.y(100)).toBeCloseTo(100 * DEFAULT_RELIEF, 9);
    expect(new WorldLayout(COL_DES_ERABLES, 1).y(100)).toBe(100);
  });

  it('forwardOf et sideOf sont orthogonaux ; le côté positif est la gauche', () => {
    const f = forwardOf(0); // cap vers +x
    const s = sideOf(0);
    expect(f.x * s.x + f.z * s.z).toBeCloseTo(0, 9);
    expect(s.z).toBeLessThan(0); // la gauche de qui va vers +x (z vers le sud) est le nord, donc z négatif
  });
});
