import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from './courses/col-des-erables';
import { Edge, MAX_GRADE_PCT, RoadNetwork, validateNetwork, type NetworkDef } from './network';

describe('Edge', () => {
  const a = { id: 'a', name: 'A', x: 0, z: 0, altitude: 10 };
  const b = { id: 'b', name: 'B', x: 1000, z: 0, altitude: 60 };
  const e = new Edge({ id: 'ab', name: 'AB', from: 'a', to: 'b', plan: [], profile: [] }, a, b);

  it('une route droite a la longueur de la corde', () => {
    expect(e.lengthM).toBeCloseTo(1000, 3);
    expect(e.pointAt(250).x).toBeCloseTo(250, 3);
    expect(e.headingAt(500)).toBeCloseTo(0, 6);
  });

  it("les altitudes d'extrémité sont celles des nœuds, avec 20 m plats au bout", () => {
    expect(e.altitudeAt(0)).toBeCloseTo(10, 9);
    expect(e.altitudeAt(1000)).toBeCloseTo(60, 9);
    expect(e.altitudeAt(20)).toBeCloseTo(10, 9);
    expect(e.gradePctAt(0)).toBeCloseTo(0, 9);
    expect(e.gradePctAt(1000)).toBeCloseTo(0, 9);
  });

  it("l'altitude est monotone entre deux nœuds sans point intermédiaire", () => {
    let prev = e.altitudeAt(0);
    for (let s = 5; s <= 1000; s += 5) {
      const y = e.altitudeAt(s);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it('la pente est la dérivée de l\'altitude', () => {
    const s = 400;
    const num = ((e.altitudeAt(s + 0.5) - e.altitudeAt(s - 0.5)) / 1) * 100;
    expect(e.gradePctAt(s)).toBeCloseTo(num, 3);
  });

  it('rejette un point d\'altitude dans une extrémité plate', () => {
    expect(() => new Edge({ id: 'x', name: 'X', from: 'a', to: 'b', plan: [], profile: [[0.01, 30]] }, a, b)).toThrow();
  });

  it('une courbe en épingle passe par ses points de passage et ne boucle pas', () => {
    const hp = new Edge(
      { id: 'hp', name: 'HP', from: 'a', to: 'b', plan: [[600, 0], [500, 120], [650, 240]], profile: [] },
      a,
      { ...b, x: 500, z: 360 },
    );
    const pts = hp.sample(5);
    const near = (x: number, z: number) => Math.min(...pts.map((p) => Math.hypot(p.x - x, p.z - z)));
    expect(near(600, 0)).toBeLessThan(3);
    expect(near(500, 120)).toBeLessThan(3);
    expect(near(650, 240)).toBeLessThan(3);
  });
});

describe('Col des Érables', () => {
  it('passe le contrôle de cohérence', () => {
    expect(validateNetwork(COL_DES_ERABLES)).toEqual([]);
  });

  it('mesure entre 28 et 35 km et monte au moins une fois à 9 % ou plus', () => {
    expect(COL_DES_ERABLES.lengthM).toBeGreaterThan(28_000);
    expect(COL_DES_ERABLES.lengthM).toBeLessThan(35_000);
    let steepest = 0;
    for (const e of COL_DES_ERABLES.edges.values()) {
      for (let s = 0; s <= e.lengthM; s += 5) steepest = Math.max(steepest, Math.abs(e.gradePctAt(s)));
    }
    expect(steepest).toBeGreaterThanOrEqual(9);
    expect(steepest).toBeLessThanOrEqual(MAX_GRADE_PCT);
  });

  it("chaque carrefour a au moins deux routes, et au moins un carrefour en a trois", () => {
    const degrees = [...COL_DES_ERABLES.nodes.keys()].map((id) => COL_DES_ERABLES.incident(id).length);
    expect(Math.min(...degrees)).toBeGreaterThanOrEqual(2);
    expect(degrees.filter((n) => n >= 3).length).toBeGreaterThanOrEqual(3);
  });

  it("l'altitude des routes est la même des deux côtés de chaque nœud", () => {
    for (const n of COL_DES_ERABLES.nodes.values()) {
      for (const e of COL_DES_ERABLES.incident(n.id)) {
        const s = e.from.id === n.id ? 0 : e.lengthM;
        expect(e.altitudeAt(s)).toBeCloseTo(n.altitude, 6);
      }
    }
  });
});

describe('validateNetwork', () => {
  const nodes = [
    { id: 'a', name: 'A', x: 0, z: 0, altitude: 0 },
    { id: 'b', name: 'B', x: 1000, z: 0, altitude: 0 },
    { id: 'c', name: 'C', x: 2000, z: 0, altitude: 0 },
  ];
  const make = (extra: Partial<NetworkDef> = {}) =>
    new RoadNetwork({
      name: 'test',
      nodes,
      edges: [{ id: 'ab', name: 'AB', from: 'a', to: 'b', plan: [], profile: [] }],
      start: { edge: 'ab', forward: true },
      ...extra,
    });

  it('signale une route dans un lac ou au ras de sa rive', () => {
    const lake = { id: 'lac', name: 'Lac', level: -2, shore: [[400, -200], [600, -200], [600, 200], [400, 200]] as [number, number][] };
    expect(validateNetwork(make({ water: [lake] })).some((x) => x.includes('rive de lac'))).toBe(true);
    const high = { ...lake, level: 5, shore: [[400, 60], [600, 60], [600, 300], [400, 300]] as [number, number][] };
    expect(validateNetwork(make({ water: [high] })).some((x) => x.includes('au-dessus de lac'))).toBe(true);
  });

  it('signale un cul-de-sac', () => {
    expect(validateNetwork(make()).some((x) => x.includes('cul-de-sac'))).toBe(true);
  });

  it('signale une pente trop raide', () => {
    const steep = make({
      nodes: [nodes[0]!, { ...nodes[1]!, altitude: 150 }, nodes[2]!],
    });
    expect(validateNetwork(steep).some((x) => x.includes('pente maximale'))).toBe(true);
  });

  it('signale deux routes qui se frôlent sans se toucher', () => {
    const close = new RoadNetwork({
      name: 'test',
      nodes: [
        { id: 'a', name: 'A', x: 0, z: 0, altitude: 0 },
        { id: 'b', name: 'B', x: 2000, z: 0, altitude: 0 },
        { id: 'c', name: 'C', x: 0, z: 30, altitude: 0 },
        { id: 'd', name: 'D', x: 2000, z: 30, altitude: 0 },
      ],
      edges: [
        { id: 'ab', name: 'AB', from: 'a', to: 'b', plan: [], profile: [] },
        { id: 'cd', name: 'CD', from: 'c', to: 'd', plan: [], profile: [] },
      ],
      start: { edge: 'ab', forward: true },
    });
    expect(validateNetwork(close).some((x) => x.includes('ab et cd'))).toBe(true);
  });
});

describe('parcours du monde des Érables', () => {
  const [col, rive] = COL_DES_ERABLES.courses;

  it('propose trois parcours, la montagne en premier', () => {
    expect(COL_DES_ERABLES.courses.map((c) => c.id)).toEqual(['col', 'rive', 'velodrome']);
    expect(COL_DES_ERABLES.course()).toBe(col);
    expect(COL_DES_ERABLES.course('rive')).toBe(rive);
    expect(COL_DES_ERABLES.course('inconnu')).toBe(col); // repli sur le premier
  });

  it('chaque parcours est une boucle fermée de routes bout à bout', () => {
    for (const c of COL_DES_ERABLES.courses) {
      c.guide.forEach((id, i) => {
        const next = COL_DES_ERABLES.edges.get(c.guide[(i + 1) % c.guide.length]!)!;
        expect(COL_DES_ERABLES.edges.get(id)!.to.id).toBe(next.from.id);
      });
    }
  });

  it('les deux parcours se croisent : mêmes routes et mêmes carrefours', () => {
    const edges = (c: NonNullable<typeof col>) => new Set(c.guide);
    const nodes = (c: NonNullable<typeof col>) =>
      new Set(c.guide.flatMap((id) => [COL_DES_ERABLES.edges.get(id)!.from.id, COL_DES_ERABLES.edges.get(id)!.to.id]));
    const sharedEdges = [...edges(col!)].filter((id) => edges(rive!).has(id));
    const sharedNodes = [...nodes(col!)].filter((id) => nodes(rive!).has(id));
    expect(sharedEdges.length).toBeGreaterThanOrEqual(1);
    expect(sharedNodes.length).toBeGreaterThanOrEqual(2);
    // Le Moulin est un vrai carrefour où l'on passe d'un parcours à l'autre.
    expect(sharedNodes).toContain('moulin');
    expect(COL_DES_ERABLES.incident('moulin').length).toBeGreaterThanOrEqual(3);
  });

  it('la montagne monte beaucoup, le plat presque pas', () => {
    const mountain = COL_DES_ERABLES.courseStats(col!);
    const flat = COL_DES_ERABLES.courseStats(rive!);
    expect(mountain.climbM).toBeGreaterThan(350);
    expect(mountain.lengthM).toBeGreaterThan(14_000);
    expect(flat.climbM).toBeLessThan(40);
    expect(flat.lengthM).toBeGreaterThan(8_000);
  });

  it('le plat ne dépasse jamais 2 % de pente', () => {
    let worst = 0;
    for (const id of rive!.guide) {
      const e = COL_DES_ERABLES.edges.get(id)!;
      for (let s = 0; s <= e.lengthM; s += 5) worst = Math.max(worst, Math.abs(e.gradePctAt(s)));
    }
    expect(worst).toBeLessThan(2);
  });

  it('refuse un parcours dont les routes ne s\u2019enchaînent pas', () => {
    expect(
      () =>
        new RoadNetwork({
          ...COL_DES_ERABLES.def,
          courses: [{ id: 'cassé', name: 'Cassé', description: '', guide: ['vallee', 'descente'] }],
        }),
    ).toThrow(/finit en/);
  });
});
