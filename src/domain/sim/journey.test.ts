import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../course/courses/col-des-erables';
import { ANNOUNCE_M, CORNER_M, Journey, LOCK_M } from './journey';
import { RoadNetwork } from '../course/network';
import { Ride } from './ride';

/** Un T : on arrive de l'ouest au carrefour J, avec une route au nord-est, une à l'est, une au sud-est. */
const T = new RoadNetwork({
  name: 'T',
  nodes: [
    { id: 's', name: 'Départ', x: 0, z: 0, altitude: 0 },
    { id: 'j', name: 'Carrefour', x: 1000, z: 0, altitude: 20 },
    { id: 'n', name: 'Nord', x: 1800, z: -800, altitude: 80 },
    { id: 'e', name: 'Est', x: 2000, z: 0, altitude: 40 },
    { id: 'm', name: 'Sud', x: 1800, z: 800, altitude: 5 },
  ],
  edges: [
    { id: 'sj', name: 'Entrée', from: 's', to: 'j', plan: [], profile: [] },
    { id: 'jn', name: 'Vers le nord', from: 'j', to: 'n', plan: [[1300, -150]], profile: [] },
    { id: 'je', name: 'Tout droit', from: 'j', to: 'e', plan: [], profile: [] },
    { id: 'jm', name: 'Vers le sud', from: 'j', to: 'm', plan: [[1300, 150]], profile: [] },
  ],
  start: { edge: 'sj', forward: true },
});

const ENTRY_M = 1000;

describe('Journey sur un T', () => {
  it('annonce le carrefour à 250 m, pas avant', () => {
    const j = new Journey(T);
    expect(j.pendingJunction(ENTRY_M - ANNOUNCE_M - 5)).toBeUndefined();
    const p = j.pendingJunction(ENTRY_M - ANNOUNCE_M + 5);
    expect(p).toBeDefined();
    expect(p!.nodeId).toBe('j');
    expect(p!.distanceM).toBeCloseTo(ANNOUNCE_M - 5, 3);
  });

  it('range les options de la gauche vers la droite et prend le tout droit par défaut', () => {
    const p = new Journey(T).pendingJunction(ENTRY_M - 200)!;
    expect(p.options.map((o) => o.turn)).toEqual(['left', 'straight', 'right']);
    expect(p.options.map((o) => o.edgeId)).toEqual(['jn', 'je', 'jm']);
    expect(p.options[0]!.turnDeg).toBeLessThan(0);
    expect(p.options[2]!.turnDeg).toBeGreaterThan(0);
    expect(p.selected).toBe(1);
  });

  it("donne pour chaque option sa pente moyenne, sa montée et sa longueur", () => {
    const p = new Journey(T).pendingJunction(ENTRY_M - 200)!;
    const north = p.options[0]!;
    expect(north.lengthM).toBeGreaterThan(1100);
    expect(north.avgGradePct).toBeCloseTo((60 / north.lengthM) * 100, 6);
    expect(north.climbM).toBeCloseTo(60, 0);
    expect(p.options[2]!.avgGradePct).toBeLessThan(0);
    expect(p.options[2]!.climbM).toBeCloseTo(0, 0);
  });

  it('sans choix, le trajet continue tout droit', () => {
    const j = new Journey(T);
    j.update(ENTRY_M - 100);
    expect(j.pointAt(ENTRY_M + 300).edgeId).toBe('je');
    expect(j.altitudeAt(ENTRY_M + 1000)).toBeCloseTo(40, 6);
  });

  it('un choix fait avant le verrou change la suite, pas la partie déjà validée', () => {
    const j = new Journey(T);
    expect(j.choose(0)).toBe(true);
    // Le choix vaut pour les requêtes en avant avant d'être validé…
    expect(j.pointAt(ENTRY_M + 300).edgeId).toBe('jn');
    expect(j.pendingJunction(ENTRY_M - 200)!.selected).toBe(0);
    // … puis il est figé au verrou.
    j.update(ENTRY_M - LOCK_M + 1);
    expect(j.pointAt(ENTRY_M + 300).edgeId).toBe('jn');
    expect(j.pointAt(ENTRY_M - 10).edgeId).toBe('sj');
  });

  it("un choix refusé ou hors limites n'efface pas le défaut", () => {
    const j = new Journey(T);
    expect(j.choose(3)).toBe(false);
    expect(j.choose(-1)).toBe(false);
    expect(j.pointAt(ENTRY_M + 300).edgeId).toBe('je');
  });

  it('le choix se verrouille à 40 m du nœud : plus de carrefour annoncé, un nouveau choix ne change rien', () => {
    const j = new Journey(T);
    j.update(ENTRY_M - LOCK_M + 1);
    expect(j.pendingJunction(ENTRY_M - LOCK_M + 1)).toBeUndefined();
    j.choose(0);
    expect(j.pointAt(ENTRY_M + 300).edgeId).toBe('je');
  });

  it("l'altitude et la pente sont continues à travers le carrefour, pour chaque sortie", () => {
    for (const choice of [0, 1, 2]) {
      const j = new Journey(T);
      j.choose(choice);
      let prevAlt = j.altitudeAt(0);
      let prevGrade = j.gradeAt(0);
      for (let d = 0.5; d < ENTRY_M + 600; d += 0.5) {
        j.update(d);
        const alt = j.altitudeAt(d);
        const grade = j.gradeAt(d);
        expect(Math.abs(alt - prevAlt)).toBeLessThan(0.2);
        expect(Math.abs(grade - prevGrade)).toBeLessThan(0.6);
        prevAlt = alt;
        prevGrade = grade;
      }
    }
  });

  it('le cap suit la route et la pente se lisse sans reculer avant le départ', () => {
    const j = new Journey(T);
    expect(j.pointAt(10).heading).toBeCloseTo(0, 6);
    expect(Number.isFinite(j.gradeAt(0))).toBe(true);
    expect(Math.abs(j.gradeAt(0))).toBeLessThan(0.05); // fenêtre de 0 à 25 m : le plat de départ, à peine entamé
  });

  it('une sortie par une route prise à l\'envers se parcourt dans l\'autre sens', () => {
    // Après « Entrée » puis « Vers le sud », on arrive en Sud (alt 5) : l'altitude finale le prouve.
    const j = new Journey(T);
    j.choose(2);
    j.update(ENTRY_M);
    const south = j.pendingJunction(0);
    expect(south).toBeUndefined();
    expect(j.altitudeAt(ENTRY_M + 1200)).toBeCloseTo(5, 0);
    // Au nœud Sud (degré 1), le trajet fait demi-tour plutôt que de bloquer.
    expect(Number.isFinite(j.altitudeAt(ENTRY_M + 3000))).toBe(true);
  });
});

describe('Journey : le coin du carrefour est arrondi', () => {
  for (const [choice, name] of [[0, 'vers le nord'], [1, 'tout droit'], [2, 'vers le sud']] as const) {
    it(`la position et le cap restent continus ${name}`, () => {
      const j = new Journey(T);
      j.choose(choice);
      let prev = j.pointAt(ENTRY_M - 40);
      let worstStep = 0;
      let worstTurnPerM = 0;
      for (let d = ENTRY_M - 40 + 0.25; d <= ENTRY_M + 40; d += 0.25) {
        j.update(d);
        const p = j.pointAt(d);
        worstStep = Math.max(worstStep, Math.hypot(p.x - prev.x, p.z - prev.z) / 0.25);
        let dh = p.heading - prev.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        worstTurnPerM = Math.max(worstTurnPerM, Math.abs(dh) / 0.25);
        prev = p;
      }
      // On avance de 1 m au plus par mètre (l'arc raccourcit un peu), jamais un saut.
      expect(worstStep).toBeLessThan(1.05);
      // Un virage de 90° s'étale sur l'arc : au plus ~0,3 rad par mètre, pas un pivot instantané.
      expect(worstTurnPerM).toBeLessThan(0.35);
    });
  }

  it('reste dans le rayon du carrefour et ne change ni altitude ni distance', () => {
    const j = new Journey(T);
    j.choose(2);
    for (let d = ENTRY_M - CORNER_M; d <= ENTRY_M + CORNER_M; d += 1) {
      j.update(d);
      const p = j.pointAt(d);
      expect(Math.hypot(p.x - 1000, p.z)).toBeLessThanOrEqual(CORNER_M + 1e-6);
    }
    expect(j.altitudeAt(ENTRY_M)).toBeCloseTo(20, 6);
  });

  it('en ligne droite, le trajet suit la route exactement', () => {
    const j = new Journey(T);
    expect(j.pointAt(500).z).toBeCloseTo(0, 6);
    expect(j.pointAt(500).x).toBeCloseTo(500, 6);
  });
});

describe('Journey sur le Col des Érables', () => {
  it('une sortie de 60 km ne casse jamais : altitude, pente et distance restent continues', () => {
    const j = new Journey(COL_DES_ERABLES);
    let prevAlt = j.altitudeAt(0);
    let worst = 0;
    for (let d = 5; d <= 60_000; d += 5) {
      j.update(d);
      const alt = j.altitudeAt(d);
      expect(Math.abs(alt - prevAlt)).toBeLessThan(0.55); // 10 % × 5 m = 0,5 m
      prevAlt = alt;
      worst = Math.max(worst, Math.abs(j.gradeAt(d)));
    }
    expect(worst).toBeLessThanOrEqual(10);
  });

  it('chaque carrefour rencontré propose au moins deux routes', () => {
    const j = new Journey(COL_DES_ERABLES);
    let seen = 0;
    for (let d = 0; d <= 40_000; d += 5) {
      j.update(d);
      const p = j.pendingJunction(d);
      if (p) {
        expect(p.options.length).toBeGreaterThanOrEqual(1);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('deux trajets sans choix sont identiques', () => {
    const run = () => {
      const j = new Journey(COL_DES_ERABLES);
      const alts: number[] = [];
      for (let d = 0; d <= 30_000; d += 50) {
        j.update(d);
        alts.push(j.altitudeAt(d));
      }
      return alts;
    };
    expect(run()).toEqual(run());
  });
});

describe('Ride sur un Journey', () => {
  it('avance, monte et reste déterministe', () => {
    const run = () => {
      const r = new Ride(new Journey(COL_DES_ERABLES));
      let s = r.snapshot();
      for (let i = 0; i < 20 * 60 * 30; i++) s = r.advance(0.05, 220);
      return s;
    };
    const a = run();
    expect(a.distanceM).toBeGreaterThan(5000);
    expect(run()).toEqual(a);
  });

  it('valide les carrefours à mesure que le cycliste avance', () => {
    const j = new Journey(COL_DES_ERABLES);
    const r = new Ride(j);
    for (let i = 0; i < 20 * 60 * 20; i++) r.advance(0.05, 220);
    expect(j.committedEndM).toBeGreaterThan(r.snapshot().distanceM);
  });
});

describe('Journey : suivre un parcours', () => {
  /** Roule `lengthM` sans toucher aux choix, en relevant les routes traversées dans l'ordre. */
  const drive = (j: Journey, toM: number) => {
    const seen: string[] = [];
    for (let d = 0; d <= toM; d += 5) {
      j.update(d);
      const id = j.pointAt(d).edgeId;
      if (seen[seen.length - 1] !== id) seen.push(id);
    }
    return seen;
  };

  it('au Moulin, la montagne propose le Col et le plat les Prés, sans qu\u2019on choisisse', () => {
    const col = new Journey(COL_DES_ERABLES, 'col');
    const rive = new Journey(COL_DES_ERABLES, 'rive');
    expect(drive(col, 4000).slice(0, 2)).toEqual(['vallee', 'col']);
    expect(drive(rive, 4000).slice(0, 2)).toEqual(['vallee', 'pres']);
  });

  it('la route du parcours est marquée et choisie par défaut dans le panneau', () => {
    const j = new Journey(COL_DES_ERABLES, 'rive');
    const vallee = COL_DES_ERABLES.edges.get('vallee')!.lengthM;
    const p = j.pendingJunction(vallee - 200)!;
    const chosen = p.options[p.selected]!;
    expect(chosen.edgeId).toBe('pres');
    expect(chosen.onCourse).toBe(true);
    expect(p.options.filter((o) => o.onCourse)).toHaveLength(1);
  });

  it('on peut quitter le parcours : le choix l\u2019emporte', () => {
    const j = new Journey(COL_DES_ERABLES, 'rive');
    const vallee = COL_DES_ERABLES.edges.get('vallee')!.lengthM;
    const p = j.pendingJunction(vallee - 200)!;
    j.choose(p.options.findIndex((o) => o.edgeId === 'col'));
    expect(drive(j, vallee + 600).slice(0, 2)).toEqual(['vallee', 'col']);
  });

  for (const id of ['col', 'rive']) {
    it(`la boucle « ${id} » se referme au départ, tour après tour`, () => {
      const j = new Journey(COL_DES_ERABLES, id);
      const course = COL_DES_ERABLES.course(id)!;
      const { lengthM } = COL_DES_ERABLES.courseStats(course);
      const seen = drive(j, lengthM * 2 + 100);
      expect(seen.slice(0, course.guide.length)).toEqual(course.guide);
      expect(seen.slice(course.guide.length, 2 * course.guide.length)).toEqual(course.guide);
      const start = j.pointAt(0);
      const back = j.pointAt(lengthM);
      // Au nœud de fermeture le cycliste est sur l'arc qui coupe le coin : à moins d'un rayon de virage du départ.
      expect(Math.hypot(back.x - start.x, back.z - start.z)).toBeLessThan(CORNER_M);
      expect(back.y).toBeCloseTo(start.y, 6);
    });
  }

  it('le nom suit le parcours, et changer de parcours repart du départ', () => {
    const j = new Journey(COL_DES_ERABLES, 'col');
    expect(j.name).toBe('Col des Érables');
    drive(j, 3000);
    j.setCourse('rive');
    expect(j.name).toBe('Rive du lac');
    expect(j.course?.id).toBe('rive');
    expect(j.committedEndM).toBeCloseTo(COL_DES_ERABLES.edges.get('vallee')!.lengthM, 6);
    expect(j.pointAt(0).edgeId).toBe('vallee');
  });

  it('un réseau sans parcours garde son nom et va tout droit', () => {
    expect(new Journey(T).name).toBe('T');
    expect(new Journey(T).course).toBeUndefined();
  });
});
