import { describe, expect, it } from 'vitest';
import { ResolutionGovernor, type GovernorOptions } from './resolution-governor';

/** Alimente le régulateur d'images de `ms` chacune pendant `seconds`, et renvoie les changements (instant, densité). */
function run(g: ResolutionGovernor, state: { now: number }, ms: number, seconds: number): Array<[number, number]> {
  const changes: Array<[number, number]> = [];
  const end = state.now + seconds * 1000;
  while (state.now < end) {
    state.now += ms;
    const r = g.frame(ms, state.now);
    if (r !== undefined) changes.push([state.now, r]);
  }
  return changes;
}

const make = (o: Partial<GovernorOptions> = {}) => ({ g: new ResolutionGovernor({ max: 1.5, warmupFrames: 0, ...o }), t: { now: 0 } });

describe('ResolutionGovernor', () => {
  it('part de la densité de repos et ne bouge pas quand tout va bien', () => {
    const { g, t } = make();
    expect(g.ratio).toBe(1.5);
    expect(run(g, t, 16.7, 60)).toEqual([]);
    expect(g.ratio).toBe(1.5);
  });

  it('baisse d’un cran quand les images tardent (95e centile au-dessus de 40 ms)', () => {
    const { g, t } = make();
    const changes = run(g, t, 50, 5);
    expect(changes[0]![1]).toBe(1.25);
    expect(g.ratio).toBeLessThan(1.5);
  });

  it('un cran à la fois, avec un délai entre deux : pas de dégringolade d’un coup', () => {
    const { g, t } = make({ cooldownMs: 5000 });
    const changes = run(g, t, 50, 12);
    expect(changes.map(([, r]) => r)).toEqual([1.25, 1]);
    expect(changes[1]![0] - changes[0]![0]).toBeGreaterThanOrEqual(5000);
  });

  it('ne descend pas sous le plancher', () => {
    const { g, t } = make({ cooldownMs: 1000 });
    run(g, t, 80, 60);
    expect(g.ratio).toBe(0.75);
  });

  it('le plancher est borné par le plafond : une densité de repos de 0,5 reste à 0,5', () => {
    const { g, t } = make({ max: 0.5 });
    expect(run(g, t, 80, 30)).toEqual([]);
    expect(g.ratio).toBe(0.5);
  });

  it('juge le 95e centile, pas la moyenne : des à-coups répétés suffisent', () => {
    const { g, t } = make();
    const changes: Array<[number, number]> = [];
    // 1 image sur 10 dure 80 ms (10 % au-dessus de 40 ms), les autres 12 ms : moyenne 19 ms, mais p95 = 80 ms.
    for (let i = 0; i < 600 && !changes.length; i++) {
      const ms = i % 10 === 0 ? 80 : 12;
      t.now += ms;
      const r = g.frame(ms, t.now);
      if (r !== undefined) changes.push([t.now, r]);
    }
    expect(changes).toHaveLength(1);
  });

  it('une image isolée très lente ne baisse rien', () => {
    const { g, t } = make();
    run(g, t, 16.7, 5);
    t.now += 200;
    expect(g.frame(200, t.now)).toBeUndefined();
    expect(run(g, t, 16.7, 5)).toEqual([]);
  });

  it('remonte après une longue période à l’aise', () => {
    const { g, t } = make({ calmMs: 20_000, cooldownMs: 5000 });
    run(g, t, 50, 5); // baisse à 1,25
    expect(g.ratio).toBe(1.25);
    expect(run(g, t, 12, 15)).toEqual([]); // pas encore 20 s à l'aise
    // La densité de repos est interdite un moment : on ne remonte pas au-dessus de 1,25 avant la fin de l'interdiction.
    expect(run(g, t, 12, 60)).toEqual([]);
    expect(g.ratio).toBe(1.25);
  });

  it('remonte une fois l’interdiction levée', () => {
    const { g, t } = make({ calmMs: 10_000, cooldownMs: 2000, banMs: 30_000 });
    run(g, t, 50, 5);
    expect(g.ratio).toBe(1.25);
    const changes = run(g, t, 12, 120);
    expect(changes.map(([, r]) => r)).toEqual([1.5]);
    expect(changes[0]![0]).toBeGreaterThan(30_000);
  });

  it('ne remonte pas au-dessus du plafond', () => {
    const { g, t } = make({ calmMs: 1000, cooldownMs: 1000, banMs: 1000 });
    run(g, t, 50, 3);
    run(g, t, 12, 120);
    expect(g.ratio).toBe(1.5);
  });

  it('entre « lent » et « à l’aise », rien ne bouge et l’attente de remontée repart de zéro', () => {
    const { g, t } = make({ calmMs: 10_000, banMs: 1000, cooldownMs: 1000 });
    while (g.frame(50, (t.now += 50)) === undefined); // jusqu'à la première baisse
    const lowered = g.ratio;
    expect(lowered).toBe(1.25);
    expect(run(g, t, 30, 40)).toEqual([]); // 33 images/s : ni lent ni à l'aise
    expect(g.ratio).toBe(lowered);
  });

  it('une pause (onglet masqué) vide la fenêtre au lieu de compter pour une image lente', () => {
    const { g, t } = make();
    run(g, t, 16.7, 2);
    t.now += 5000;
    expect(g.frame(5000, t.now)).toBeUndefined();
    expect(run(g, t, 16.7, 5)).toEqual([]);
  });

  it('reset() oublie les durées d’avant', () => {
    const { g, t } = make();
    run(g, t, 50, 1.5);
    g.reset();
    expect(run(g, t, 16.7, 10)).toEqual([]);
    expect(g.ratio).toBe(1.5);
  });

  it('ignore les premières images (compilation des shaders, caches froids) au départ et à chaque reprise', () => {
    const { g, t } = make({ warmupFrames: 60 });
    // 60 images très lentes au départ, puis tout va bien : rien ne baisse.
    run(g, t, 300, 18);
    expect(g.ratio).toBe(1.5);
    expect(run(g, t, 16.7, 10)).toEqual([]);
    // Même chose après une reprise.
    g.reset();
    run(g, t, 300, 18);
    expect(g.ratio).toBe(1.5);
  });

  it('ignore une durée nulle, négative ou illisible', () => {
    const { g } = make();
    expect(g.frame(0, 1)).toBeUndefined();
    expect(g.frame(-5, 2)).toBeUndefined();
    expect(g.frame(Number.NaN, 3)).toBeUndefined();
  });
});
