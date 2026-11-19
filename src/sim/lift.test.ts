import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from './courses/col-des-erables';
import { Journey } from './journey';
import { RoadNetwork, validateNetwork, type EdgeDef } from './network';
import { Ride } from './ride';

/** Une route au sol, un ascenseur de 300 m de haut (20 m de trajet en 40 s), puis une route du ciel. */
const LIFTED = new RoadNetwork({
  name: 'test',
  nodes: [
    { id: 'a', name: 'A', x: 0, z: 0, altitude: 0 },
    { id: 'b', name: 'Pied', x: 1000, z: 0, altitude: 0 },
    { id: 'c', name: 'Gare', x: 1000, z: 0, altitude: 300 },
    { id: 'd', name: 'D', x: 1000, z: -1000, altitude: 300 },
  ],
  edges: [
    { id: 'ab', name: 'AB', from: 'a', to: 'b', plan: [], profile: [] },
    { id: 'lift', name: 'Ascenseur', from: 'b', to: 'c', plan: [], profile: [], surface: 'lift', lift: { lengthM: 20, durationS: 40 } },
    { id: 'cd', name: 'CD', from: 'c', to: 'd', plan: [], profile: [], surface: 'sky' },
  ],
  start: { edge: 'ab', forward: true },
});

/** Secondes passées dans l'ascenseur à puissance constante. */
function secondsInLift(powerW: number): number {
  const ride = new Ride(new Journey(LIFTED));
  let inLift = 0;
  for (let t = 0; t < 600; t++) {
    const s = ride.advance(1, powerW);
    if (s.liftProgress !== undefined) inLift++;
    if (s.distanceM > 1100) break;
  }
  return inLift;
}

describe('ascenseur', () => {
  it('monte le cycliste dans le monde, mais pas son altitude pédalée', () => {
    const j = new Journey(LIFTED);
    j.update(1200);
    expect(j.pointAt(1500).y).toBeCloseTo(300, 0); // l'image : la route du ciel, 300 m plus haut
    expect(j.altitudeAt(1500)).toBeCloseTo(0, 6); // la simulation : rien de gagné à la force des jambes
    for (let d = 900; d <= 1100; d += 2) {
      expect(Math.abs(j.altitudeAt(d))).toBeLessThan(1e-6);
      expect(Math.abs(j.gradeAt(d))).toBeLessThan(1e-6); // le trainer reste à plat dans la cabine
    }
  });

  it('dit où l’on en est de la montée', () => {
    const j = new Journey(LIFTED);
    j.update(1000);
    expect(j.liftAt(990)).toBeUndefined();
    const mid = j.liftAt(1010)!;
    expect(mid.startM).toBeCloseTo(1000, 6);
    expect(mid.progress).toBeCloseTo(0.5, 6);
    expect(mid.durationS).toBe(40);
    expect(j.pointAt(1010).y).toBeCloseTo(150, 0); // à mi-course, à mi-hauteur
  });

  it('met le même temps à monter, qu’on pédale fort ou pas', () => {
    const slow = secondsInLift(120);
    const fast = secondsInLift(400);
    expect(slow).toBeGreaterThanOrEqual(39);
    expect(slow).toBeLessThanOrEqual(41);
    expect(fast).toBe(slow);
  });

  it('ne compte pas la hauteur de l’ascenseur dans la montée d’un parcours', () => {
    const stats = COL_DES_ERABLES.courseStats(COL_DES_ERABLES.course('arc-en-ciel')!);
    expect(stats.climbM).toBeGreaterThan(290);
    expect(stats.climbM).toBeLessThan(340); // les 380 m de l'ascenseur n'y sont pas
    expect(stats.lengthM / 1000).toBeCloseTo(20.5, 0);
  });

  it('fait tourner le cycliste sur la plateforme, du cap de la Jetée à celui de l’Arche', () => {
    const lift = COL_DES_ERABLES.edges.get('ascenseur')!;
    const jetee = COL_DES_ERABLES.edges.get('jetee')!;
    const arche = COL_DES_ERABLES.edges.get('arche')!;
    expect(lift.headingAt(0)).toBeCloseTo(jetee.headingAt(jetee.lengthM), 6);
    expect(Math.cos(lift.headingAt(lift.lengthM) - arche.headingAt(0))).toBeCloseTo(1, 6);
  });
});

describe('routes du ciel', () => {
  /** Une route au sol d'ouest en est, et une route qui la croise du sud au nord à `altitude` m. */
  const crossing = (altitude: number, surface?: EdgeDef['surface']) =>
    new RoadNetwork({
      name: 'test',
      nodes: [
        { id: 'a', name: 'A', x: 0, z: 0, altitude: 0 },
        { id: 'b', name: 'B', x: 2000, z: 0, altitude: 0 },
        { id: 'c', name: 'C', x: 1000, z: 1000, altitude },
        { id: 'd', name: 'D', x: 1000, z: -1000, altitude },
      ],
      edges: [
        { id: 'ab', name: 'AB', from: 'a', to: 'b', plan: [], profile: [] },
        { id: 'cd', name: 'CD', from: 'c', to: 'd', plan: [], profile: [], ...(surface ? { surface } : {}) },
      ],
      start: { edge: 'ab', forward: true },
    });
  const crosses = (net: RoadNetwork) => validateNetwork(net).some((x) => x.includes('ab et cd'));

  it('peuvent passer au-dessus d’une route, assez haut', () => {
    expect(crosses(crossing(50, 'sky'))).toBe(false);
    expect(crosses(crossing(20, 'sky'))).toBe(true); // moins de 30 m : trop bas
    expect(crosses(crossing(50))).toBe(true); // une route au sol ne passe pas au-dessus d'une autre
  });

  it('se croisent toujours assez haut sur la Route arc-en-ciel', () => {
    expect(validateNetwork(COL_DES_ERABLES)).toEqual([]);
  });
});
