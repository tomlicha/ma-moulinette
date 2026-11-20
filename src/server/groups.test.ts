import { describe, expect, it } from 'vitest';
import type { Workout } from '../domain/workout/model';
import { Groups, type GroupSnapshot, type GroupStore } from './groups';

const workout: Workout = {
  name: 'Sweet spot',
  steps: [{ kind: 'steady', durationS: 1200, target: { kind: 'ftp', from: 0.9, to: 0.9 } }],
  messages: [],
  warnings: [],
};
const ref = { ftpW: 280, massKg: 78 };

/** Un « stockage » qui garde ce qu'on lui range, comme le Durable Object le fera. */
function store() {
  const saved = new Map<string, GroupSnapshot>();
  let next = 0;
  const calls: string[] = [];
  const s: GroupStore = {
    save: (g, n) => {
      saved.set(g.id, structuredClone(g));
      next = n;
      calls.push(`save ${g.id}`);
    },
    remove: (id, n) => {
      saved.delete(id);
      next = n;
      calls.push(`remove ${id}`);
    },
  };
  return { s, saved, calls, next: () => next };
}

describe('Groups : rangés à chaque changement', () => {
  it('range le groupe à la création, à l’arrivée, au départ d’un membre, au choix d’une route', () => {
    const { s, saved, calls } = store();
    const g = new Groups(s);
    g.create({ slot: 1, name: 'Léa' }, workout, 'col', 300, 0, ref);
    expect(saved.get('g1')).toMatchObject({ id: 'g1', ftpW: 280, massKg: 78, members: [[1, 'Léa']], routes: [] });
    g.join({ slot: 2, name: 'Tom' }, 'g1');
    expect(saved.get('g1')!.members).toEqual([[1, 'Léa'], [2, 'Tom']]);
    g.route(1, 4, 2);
    expect(saved.get('g1')!.routes).toEqual([[4, 2]]);
    g.leave(1);
    expect(saved.get('g1')!.members).toEqual([[2, 'Tom']]);
    expect(calls.every((c) => c === 'save g1')).toBe(true);
  });

  it('efface le groupe quand le dernier part, ou quand il est fini depuis trop longtemps', () => {
    const { s, saved } = store();
    const g = new Groups(s);
    g.create({ slot: 1, name: 'Léa' }, workout, 'col', 60, 0, ref);
    g.leave(1);
    expect(saved.size).toBe(0);
    g.create({ slot: 2, name: 'Tom' }, workout, 'col', 60, 0, ref);
    expect(saved.size).toBe(1);
    g.expire(60_000 + 1200_000 + 10 * 60_000 + 1);
    expect(saved.size).toBe(0);
  });

  it("range aussi le prochain numéro : un numéro ne sert pas deux fois", () => {
    const { s, next } = store();
    const g = new Groups(s);
    g.create({ slot: 1, name: 'Léa' }, workout, 'col', 60, 0, ref);
    g.create({ slot: 2, name: 'Tom' }, workout, 'col', 60, 0, ref);
    expect(next()).toBe(3);
  });
});

describe('Groups.restore : après un redémarrage', () => {
  /** Deux groupes rangés, puis un nouvel objet qui les relit. */
  function crashed() {
    const { s, saved, next } = store();
    const g = new Groups(s);
    g.create({ slot: 1, name: 'Léa' }, workout, 'col', 300, 0, ref);
    g.join({ slot: 2, name: 'Tom' }, 'g1');
    g.join({ slot: 3, name: 'Zoé' }, 'g1');
    g.route(1, 4, 2);
    g.create({ slot: 5, name: 'Marc' }, { ...workout, name: 'Rampe' }, 'rive', 600, 0, ref);
    return { snaps: [...saved.values()], next: next() };
  }

  it('retrouve les membres dans leur ordre, le créateur, les choix de route et l’allure', () => {
    const { snaps, next } = crashed();
    const g = new Groups();
    g.restore(snaps, next, () => true);
    expect(g.members('g1').map((m) => m.name)).toEqual(['Léa', 'Tom', 'Zoé']);
    expect(g.leader('g1')).toBe(1);
    expect(g.groupOf(2)).toBe('g1');
    const joined = g.join({ slot: 7, name: 'Paul' }, 'g1');
    expect(joined.ok && joined.group).toMatchObject({ ftpW: 280, massKg: 78, routes: [[4, 2]], leader: 1 });
    expect(g.summaries().map((x) => x.workoutName).sort()).toEqual(['Rampe', 'Sweet spot']);
  });

  it('poursuit la numérotation : le prochain groupe ne reprend pas un numéro déjà donné', () => {
    const { snaps, next } = crashed();
    const g = new Groups();
    g.restore(snaps, next, () => true);
    const created = g.create({ slot: 9, name: 'Nina' }, workout, 'col', 60, 0, ref);
    expect(created.ok && created.group.id).toBe('g3');
  });

  it('retire ceux dont la connexion n’a pas survécu : le créateur parti laisse la place au plus ancien, un groupe vide disparaît', () => {
    const { snaps, next } = crashed();
    const { s, saved } = store();
    const g = new Groups(s);
    g.restore(snaps, next, (slot) => slot === 2 || slot === 3); // Léa et Marc ne sont plus là
    expect(g.members('g1').map((m) => m.name)).toEqual(['Tom', 'Zoé']);
    expect(g.leader('g1')).toBe(2);
    expect(g.summaries().map((x) => x.id)).toEqual(['g1']); // le groupe de Marc n'a plus personne
    expect(saved.get('g1')!.members).toEqual([[2, 'Tom'], [3, 'Zoé']]); // ce qu'il en reste est rangé
  });

  it('ignore une donnée abîmée sans faire échouer le réveil', () => {
    const { snaps, next } = crashed();
    const broken = [{ ...snaps[0]!, workout: { name: 'x', steps: [] } as unknown as Workout }, snaps[1]!];
    const g = new Groups();
    g.restore(broken, next, () => true);
    expect(g.summaries().map((x) => x.id)).toEqual(['g2']);
  });
});
