import { describe, expect, it } from 'vitest';
import type { NearbyRiders } from '../render/others-model';
import { clampToFrame, climbText, frameFor, HOLD_AFTER_MS, junctionHeader, pathOf, placeLabel, projector, rangeText, TabController } from './ride-map-model';

const north = -Math.PI / 2; // cap vers le nord (z décroît)

describe('projector', () => {
  const f = frameFor(100, 200);
  it('pose le coureur à l’ancre, trois quarts en bas', () => {
    const [x, y] = projector({ x: 10, z: 20, heading: north }, f)({ x: 10, z: 20 });
    expect(x).toBe(50);
    expect(y).toBeCloseTo(146, 5);
  });
  it('met la route devant soi en haut : un point au nord, cap au nord', () => {
    const p = projector({ x: 0, z: 0, heading: north }, f);
    const [, y0] = p({ x: 0, z: 0 });
    const [x1, y1] = p({ x: 0, z: -100 });
    expect(x1).toBeCloseTo(50, 5);
    expect(y1).toBeCloseTo(y0 - 100 * f.ppm, 5);
  });
  it('met la droite du coureur à droite, quel que soit son cap', () => {
    // Cap à l'est (x croît) : sa droite est le sud (z croît).
    const [x, y] = projector({ x: 0, z: 0, heading: 0 }, f)({ x: 0, z: 100 });
    expect(x).toBeCloseTo(50 + 100 * f.ppm, 5);
    expect(y).toBeCloseTo(f.cy, 5);
    // Cap au nord : sa droite est l'est.
    const [x2] = projector({ x: 0, z: 0, heading: north }, f)({ x: 100, z: 0 });
    expect(x2).toBeCloseTo(50 + 100 * f.ppm, 5);
  });
  it('tourne la carte avec le cap : un point devant reste en haut', () => {
    const p = projector({ x: 0, z: 0, heading: Math.PI / 4 }, f); // cap sud-est
    const [x, y] = p({ x: 70.71, z: 70.71 });
    expect(x).toBeCloseTo(50, 1);
    expect(y).toBeLessThan(f.cy);
  });
});

describe('frameFor', () => {
  it('garde la même échelle à hauteur égale, quelle que soit la largeur', () => {
    expect(frameFor(158, 206).ppm).toBe(frameFor(175, 206).ppm);
  });
  it('montre environ 600 m de route sur la hauteur', () => {
    expect(frameFor(170, 310).h / frameFor(170, 310).ppm).toBeCloseTo(620, 5);
  });
});

describe('pathOf', () => {
  it('trace M puis L, arrondi au dixième, et ferme à la demande', () => {
    const id = (p: { x: number; z: number }): [number, number] => [p.x, p.z];
    expect(pathOf([{ x: 1.04, z: 2 }, { x: 3, z: 4.26 }], id)).toBe('M1 2L3 4.3');
    expect(pathOf([{ x: 0, z: 0 }, { x: 1, z: 1 }], id, true)).toBe('M0 0L1 1Z');
    expect(pathOf([], id)).toBe('');
  });
});

describe('clampToFrame', () => {
  const f = frameFor(100, 100);
  it('laisse un point dans le cadre', () => expect(clampToFrame(50, 50, f)).toEqual({ x: 50, y: 50, out: false }));
  it('ramène un coureur hors cadre au bord, à 7 px', () => {
    expect(clampToFrame(-30, 50, f)).toEqual({ x: 7, y: 50, out: true });
    expect(clampToFrame(50, 400, f)).toEqual({ x: 50, y: 93, out: true });
  });
});

describe('placeLabel', () => {
  const f = frameFor(160, 200);
  it('pose le nom au bord gauche pour une route qui part à gauche, au-dessus si elle monte', () => {
    const p = placeLabel([20, 60], [80, 100], f, 12.5, 2);
    expect(p.anchor).toBe('start');
    expect(p.x).toBe(6);
    expect(p.y).toBeLessThan(60);
  });
  it('pose le nom au bord droit pour une route qui part à droite, au-dessous si elle descend', () => {
    const p = placeLabel([150, 160], [80, 100], f, 12.5, 1);
    expect(p).toMatchObject({ anchor: 'end', x: 154 });
    expect(p.y).toBeGreaterThan(160);
  });
  it('reste dans le cadre', () => {
    const p = placeLabel([10, 2], [80, 100], f, 12.5, 2);
    expect(p.y).toBeGreaterThanOrEqual(14.5);
    const q = placeLabel([10, 199], [80, 100], f, 12.5, 2);
    expect(q.y).toBeLessThanOrEqual(200 - 16.5);
  });
});

describe('textes', () => {
  it('climbText : la montée en mètres, « plat » sous 10 m', () => {
    expect(climbText(357.4)).toBe('+357 m');
    expect(climbText(95)).toBe('+95 m');
    expect(climbText(9.9)).toBe('plat');
    expect(climbText(0)).toBe('plat');
  });
  const at = (gapM: number) => ({ slot: 1, name: 'x', gapM, x: 0, z: 0 });
  it('rangeText : l’étendue du groupe, comme la liste', () => {
    const n: NearbyRiders = { ahead: [at(190), at(140)], behind: [at(-40), at(-265)] };
    expect(rangeText(n)).toBe('4 autres · de −265 m à +190 m');
    expect(rangeText({ ahead: [at(10)], behind: [] })).toBe('1 autre · +10 m');
    expect(rangeText({ ahead: [], behind: [at(-40)] })).toBe('1 autre · −40 m');
    expect(rangeText({ ahead: [], behind: [] })).toBe('');
    expect(rangeText(undefined)).toBe('');
  });
  it('junctionHeader : arrondi à 10 m, absent une fois le nœud passé', () => {
    expect(junctionHeader('Le Moulin', 212)).toBe('Carrefour · Le Moulin · 210 m');
    expect(junctionHeader('Le Moulin', 0)).toBe('Carrefour · Le Moulin · 0 m');
    expect(junctionHeader('Le Moulin', -3)).toBeNull();
  });
});

describe('TabController', () => {
  const NODE = 2468;
  const pending = { atM: NODE };
  it('garde le choix du coureur hors carrefour', () => {
    const c = new TabController('list');
    c.tick({ distanceM: 100, pending: undefined, now: 0 });
    expect(c.tab).toBe('list');
    c.select('map');
    expect(c.tab).toBe('map');
    expect(c.pref).toBe('map');
  });
  it('passe seul sur la carte à l’annonce du carrefour, sans changer le choix mémorisé', () => {
    const c = new TabController('list');
    c.tick({ distanceM: NODE - 250, pending, now: 0 });
    expect(c.tab).toBe('map');
    expect(c.pref).toBe('list');
    expect(c.junction).toBe(true);
  });
  it('reste sur la carte après le verrouillage (le carrefour n’est plus « annoncé »)', () => {
    const c = new TabController('list');
    c.tick({ distanceM: NODE - 250, pending, now: 0 });
    c.tick({ distanceM: NODE - 30, pending: undefined, now: 4000 });
    expect(c.tab).toBe('map');
  });
  it('revient à l’onglet d’avant 10 s après le nœud, pas avant', () => {
    const c = new TabController('list');
    c.tick({ distanceM: NODE - 250, pending, now: 0 });
    c.tick({ distanceM: NODE + 5, pending: undefined, now: 10_000 }); // nœud passé à t = 10 s
    c.tick({ distanceM: NODE + 60, pending: undefined, now: 10_000 + HOLD_AFTER_MS - 1 });
    expect(c.tab).toBe('map');
    c.tick({ distanceM: NODE + 100, pending: undefined, now: 10_000 + HOLD_AFTER_MS });
    expect(c.tab).toBe('list');
    expect(c.junction).toBe(false);
  });
  it('ne rend rien si le coureur a basculé lui-même pendant l’approche', () => {
    const c = new TabController('list');
    c.tick({ distanceM: NODE - 250, pending, now: 0 });
    c.select('list'); // il veut la liste
    c.tick({ distanceM: NODE - 100, pending, now: 1000 });
    expect(c.tab).toBe('list');
    c.tick({ distanceM: NODE + 1, pending: undefined, now: 5000 });
    c.tick({ distanceM: NODE + 200, pending: undefined, now: 5000 + HOLD_AFTER_MS });
    expect(c.tab).toBe('list');
    expect(c.pref).toBe('list');
  });
  it('part de la carte quand c’était déjà l’onglet choisi : rien ne bouge', () => {
    const c = new TabController('map');
    c.tick({ distanceM: NODE - 250, pending, now: 0 });
    c.tick({ distanceM: NODE + 1, pending: undefined, now: 1000 });
    c.tick({ distanceM: NODE + 200, pending: undefined, now: 1000 + HOLD_AFTER_MS });
    expect(c.tab).toBe('map');
  });
  it('suit un deuxième carrefour annoncé pendant le maintien, et rend l’onglet d’origine à la fin', () => {
    const c = new TabController('list');
    c.tick({ distanceM: NODE - 250, pending, now: 0 });
    c.tick({ distanceM: NODE + 10, pending: undefined, now: 2000 });
    c.tick({ distanceM: NODE + 100, pending: { atM: NODE + 300 }, now: 4000 }); // route de 300 m
    c.tick({ distanceM: NODE + 305, pending: undefined, now: 6000 });
    c.tick({ distanceM: NODE + 400, pending: undefined, now: 6000 + HOLD_AFTER_MS });
    expect(c.tab).toBe('list');
  });
  it('abandonne le maintien quand le trajet repart du début', () => {
    const c = new TabController('list');
    c.tick({ distanceM: NODE - 250, pending, now: 0 });
    c.tick({ distanceM: 0, pending: undefined, now: 1000 });
    expect(c.junction).toBe(false);
    expect(c.tab).toBe('list');
  });
  it('un nœud jamais atteint ne bloque pas la carte : retour dès le départ d’une nouvelle sortie', () => {
    const c = new TabController('map');
    c.tick({ distanceM: NODE - 100, pending, now: 0 });
    c.tick({ distanceM: 5, pending: undefined, now: 500 });
    expect(c.junction).toBe(false);
  });
});
