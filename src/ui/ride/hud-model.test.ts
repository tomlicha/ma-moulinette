import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../../domain/course/courses/col-des-erables';
import { Journey } from '../../domain/sim/journey';
import { DEMO_ROUTE, Route } from '../../domain/course/route';
import type { StepKind, WorkoutStep } from '../../domain/workout/model';
import {
  ClimbCounter,
  findSeries,
  fmt1,
  junctionLabel,
  liftBanner,
  nextSummitM,
  profileWindow,
  repetitionAt,
  signed,
  turnArrow,
  upcoming,
  zoneLabel,
} from './hud-model';

describe('ClimbCounter', () => {
  it('ne cumule que les montées', () => {
    const c = new ClimbCounter();
    for (const a of [100, 105, 103, 110, 90]) c.add(a);
    expect(c.total).toBe(12);
    c.reset();
    c.add(50);
    expect(c.total).toBe(0);
  });
});

describe('sommets', () => {
  it('compte jusqu’au prochain sommet, tour suivant compris', () => {
    expect(nextSummitM(DEMO_ROUTE, 400)).toBe(2600);
    expect(nextSummitM(DEMO_ROUTE, 3500)).toBe(5500);
    expect(nextSummitM(DEMO_ROUTE, 6400)).toBe(2600);
  });

  it('ne trouve rien sur un parcours plat', () => {
    expect(nextSummitM(new Route('Plat', [{ lengthM: 1000, gradePct: 0 }]), 10)).toBeUndefined();
  });

  it('ignore une bosse de moins de 8 m', () => {
    const bosse = new Route('Bosse', [
      { lengthM: 100, gradePct: 0 },
      { lengthM: 100, gradePct: 5 },
      { lengthM: 100, gradePct: -5 },
      { lengthM: 20000, gradePct: 0 },
    ]);
    expect(nextSummitM(bosse, 0)).toBeUndefined(); // 5 m de montée
  });

  it('trouve le sommet du Col sur un trajet réel', () => {
    const j = new Journey(COL_DES_ERABLES);
    // On prend le Col au Moulin : le trajet par défaut serait tout droit.
    for (let d = 0; d <= 2300; d += 10) {
      j.update(d);
      const p = j.pendingJunction(d);
      if (p) j.choose(p.options.findIndex((o) => o.edgeId === 'col'));
    }
    const toSummit = nextSummitM(j, 2300, 9000)!;
    const there = j.altitudeAt(2300 + toSummit);
    expect(there).toBeGreaterThan(365);
    expect(toSummit).toBeGreaterThan(3000);
  });
});

describe('profileWindow', () => {
  it('place le cycliste à 400 m du bord gauche et le sommet en haut du repère', () => {
    const p = profileWindow(DEMO_ROUTE, 2600, 600, 34, 3000, 400);
    expect(p.startM).toBe(2200);
    expect(p.endM).toBe(5200);
    expect(p.x(2600)).toBeCloseTo(80); // 400 m sur 3 000 m, dans 600 px
    expect(p.y(100)).toBeCloseTo(3);
    expect(p.y(40)).toBeCloseTo(31);
    expect(p.area.endsWith('Z')).toBe(true);
  });

  it('ne recule pas avant le départ', () => {
    const p = profileWindow(DEMO_ROUTE, 100, 600, 34);
    expect(p.startM).toBe(0);
    expect(p.x(100)).toBeCloseTo(20); // 100 m sur 3 000 m
  });

  it('laisse un plat plat : quelques mètres d’écart, ou un bruit de calcul, ne remplissent pas la hauteur', () => {
    const flat = { altitudeAt: (d: number) => 15 + (d % 40 === 0 ? 1e-9 : 0) + Math.sin(d / 300) * 2 } as unknown as Parameters<typeof profileWindow>[0];
    const p = profileWindow(flat, 1000, 600, 34);
    const ys = [...p.line.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(4); // 4 m sur 40 m : moins de 3 px sur 28
  });

  it('montre une route entière : le point avance, le profil ne bouge pas', () => {
    const j = new Journey(COL_DES_ERABLES);
    j.update(0);
    const road = j.roadAt(10);
    expect(road.startM).toBe(0);
    expect(j.roadAt(road.lengthM - 1)).toEqual(road); // toute la route, jusqu'au carrefour
    const a = profileWindow(j, road.startM, 600, 34, road.lengthM, 0);
    expect(a.startM).toBe(0);
    expect(a.endM).toBe(road.lengthM);
    expect(a.x(0)).toBeCloseTo(0);
    expect(a.x(road.lengthM / 2)).toBeCloseTo(300);
    expect(a.x(road.lengthM)).toBeCloseTo(600);
  });

  it('suit le relief en glissant : même forme, un peu plus loin', () => {
    const a = profileWindow(DEMO_ROUTE, 1500, 600, 34);
    const b = profileWindow(DEMO_ROUTE, 1520, 600, 34);
    expect(b.startM - a.startM).toBe(20);
    expect(a.line).not.toBe(b.line);
  });
});

describe('formats', () => {
  it('écrit les nombres à la française', () => {
    expect(fmt1(18.44)).toBe('18,4');
    expect(signed(4.2, 1)).toBe('+4,2');
    expect(signed(-3)).toBe('−3');
    expect(signed(-0.2)).toBe('+0');
  });

  it('nomme la zone d’après la FTP', () => {
    expect(zoneLabel(215, 260)).toEqual({ id: 'z3', label: 'Z3 · Tempo' });
    expect(zoneLabel(270, 260).id).toBe('z4');
  });
});

const st = (kind: StepKind, durationS: number, from?: number, to = from): WorkoutStep => ({
  kind,
  durationS,
  target: from === undefined ? { kind: 'free' } : { kind: 'ftp', from, to: to! },
});
const rep = (n: number, a: WorkoutStep, b: WorkoutStep) => Array.from({ length: n }, () => [a, b]).flat();
// Échauffement, 30/30 × 10, récupération 5 min, 40/20 × 8, retour au calme.
const VO2 = [
  st('warmup', 600, 0.5, 0.75),
  ...rep(9, st('on', 30, 1.2), st('off', 30, 0.5)),
  st('on', 30, 1.2),
  st('off', 300, 0.55),
  ...rep(8, st('on', 40, 1.3), st('off', 20, 0.5)),
  st('cooldown', 480, 0.6, 0.45),
];

describe('findSeries', () => {
  it('repère les séries d’intervalles et leurs répétitions', () => {
    expect(findSeries(VO2)).toEqual([
      { start: 1, end: 19, reps: 10 },
      { start: 21, end: 36, reps: 8 },
    ]);
  });

  it('ignore les paliers qui ne se répètent pas', () => {
    expect(findSeries([st('warmup', 600, 0.5, 0.75), st('steady', 300, 0.8), st('on', 60, 1.1), st('cooldown', 300, 0.5)])).toEqual([]);
    expect(findSeries([st('steady', 60, 0.8), st('steady', 60, 0.8), st('steady', 60, 0.8)])).toEqual([]);
  });

  it('numérote la répétition de l’effort comme de sa récupération', () => {
    const s = findSeries(VO2);
    expect(repetitionAt(s, 5)).toEqual({ rep: 3, reps: 10 });
    expect(repetitionAt(s, 6)).toEqual({ rep: 3, reps: 10 });
    expect(repetitionAt(s, 20)).toBeUndefined();
  });
});

describe('upcoming', () => {
  const series = findSeries(VO2);

  it('pendant un effort : la série en tête, sa récupération à venir', () => {
    const { items, rest } = upcoming(VO2, series, 5, 260);
    expect(items.map((i) => i.kind)).toEqual(['series', 'step', 'series', 'step']);
    const first = items[0]!;
    expect(first.kind === 'series' && { nextIs: first.nextIs, rep: first.rep, reps: first.reps }).toEqual({ nextIs: 1, rep: 3, reps: 10 });
    expect(first.kind === 'series' && first.steps.map((x) => [x.fromW, x.durationS, x.zoneFrom])).toEqual([
      [312, 30, 'z5'],
      [130, 30, 'z1'],
    ]);
    const next = items[2]!;
    expect(next.kind === 'series' && { nextIs: next.nextIs, rep: next.rep, reps: next.reps }).toEqual({ nextIs: undefined, rep: 1, reps: 8 });
    expect(rest).toBe(0);
  });

  it('pendant une récupération : la répétition suivante arrive', () => {
    const first = upcoming(VO2, series, 6, 260).items[0]!;
    expect(first.kind === 'series' && [first.nextIs, first.rep]).toEqual([0, 4]);
  });

  it('montre seul le dernier effort d’une série', () => {
    const first = upcoming(VO2, series, 18, 260).items[0]!;
    expect(first).toEqual({ kind: 'step', step: { fromW: 312, toW: 312, durationS: 30, zoneFrom: 'z5', zoneTo: 'z5' } });
  });

  it('suit l’intensité, les rampes et les paliers libres', () => {
    const steps = [st('steady', 60, 1), st('cooldown', 300, 0.6, 0.45), st('free', 120)];
    const { items } = upcoming(steps, [], 0, 200, 1.1);
    expect(items).toEqual([
      { kind: 'step', step: { fromW: 132, toW: 99, durationS: 300, zoneFrom: 'z2', zoneTo: 'z1' } },
      { kind: 'step', step: { fromW: undefined, toW: undefined, durationS: 120, zoneFrom: 'free', zoneTo: 'free' } },
    ]);
  });

  it('s’arrête au nombre d’éléments demandé et compte le reste', () => {
    const steps = Array.from({ length: 8 }, (_, k) => st('steady', 60 + k, 0.7));
    const { items, rest } = upcoming(steps, [], 0, 260);
    expect(items).toHaveLength(4);
    expect(rest).toBe(3);
    expect(upcoming(steps, [], 7, 260)).toEqual({ items: [], rest: 0 });
  });
});

describe('junctionLabel', () => {
  const opt = { edgeId: 'col', forward: true, onCourse: true, name: 'Le Col', lengthM: 6370, avgGradePct: 5.6, climbM: 357.4, turnDeg: -70, turn: 'left' as const };

  it('donne la flèche, le nom et le résumé de la route', () => {
    expect(junctionLabel(opt)).toEqual({ arrow: '←', name: 'Le Col', meta: '6,4 km · +5,6 % · +357 m', base: '6,4 km · +5,6 %', climb: ' · +357 m' });
  });

  it('sépare la montée du reste : le téléphone la laisse à la carte de l’encart', () => {
    const l = junctionLabel(opt);
    expect(l.base + l.climb).toBe(l.meta);
    expect(junctionLabel({ ...opt, climbM: 4 })).toMatchObject({ base: '6,4 km · +5,6 %', climb: '' });
  });

  it('une flèche par direction, et pas de montée sur une descente', () => {
    expect(junctionLabel({ ...opt, turnDeg: 80, turn: 'right' }).arrow).toBe('→');
    expect(junctionLabel({ ...opt, turnDeg: 3, turn: 'straight' }).arrow).toBe('↑');
    expect(junctionLabel({ ...opt, avgGradePct: -3.2, climbM: 4 }).meta).toBe('6,4 km · −3,2 %');
  });
});

describe('turnArrow', () => {
  it('distingue le biais, l’angle droit et l’épingle de chaque côté', () => {
    expect([-130, -70, -40, 0, 40, 70, 130].map(turnArrow)).toEqual(['↙', '←', '↖', '↑', '↗', '→', '↘']);
  });
});

describe('liftBanner', () => {
  const lift = {
    startM: 483,
    lengthM: 20,
    durationS: 40,
    progress: 0.55,
    fromAltitudeM: 100,
    toAltitudeM: 480,
    altitudeM: 311.6,
    toName: 'Gare céleste',
    name: 'Ascenseur céleste',
  };

  it('montre l’altitude, le trajet de l’ascenseur et le temps qui reste', () => {
    expect(liftBanner(lift)).toEqual({
      label: 'Altitude',
      value: '312',
      unit: 'm',
      info: 'Ascenseur céleste · 100 → 480 m',
      right: 'Gare céleste dans 18 s',
    });
  });

  it('ne dit jamais « dans 0 s » tant que la cabine bouge', () => {
    expect(liftBanner({ ...lift, progress: 0.999 }).right).toBe('Gare céleste dans 1 s');
    expect(liftBanner({ ...lift, progress: 0 }).right).toBe('Gare céleste dans 40 s');
  });
});
