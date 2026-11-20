import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../domain/course/courses/col-des-erables';
import type { Workout } from '../domain/workout/model';
import { StateCodec, type RiderState } from '../infra/net/protocol';
import { MAX_GROUPS, MAX_MEMBERS, MAX_START_IN_S, MIN_START_IN_S } from './groups';
import { Room, STATE_TTL_MS, WHO_MAX, type Connection } from './room';

const codec = new StateCodec(COL_DES_ERABLES);
const edge0 = [...COL_DES_ERABLES.edges.keys()][0]!;

class FakeConn implements Connection {
  sent: (string | ArrayBuffer)[] = [];
  send(d: string | ArrayBuffer) {
    this.sent.push(d);
  }
  close() {}
  texts() {
    // Les messages sont inspectés au champ près : un test les lit sans les typer un à un.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d) as Record<string, any>);
  }
  last(type: string) {
    return this.texts().filter((t) => t.type === type).at(-1);
  }
  count(type: string) {
    return this.texts().filter((t) => t.type === type).length;
  }
}

const riding = (over: Partial<RiderState> = {}): RiderState => ({ pos: { edgeId: edge0, forward: true, s: 100 }, tMs: 1000, speedMs: 10, powerW: 200, cadenceRpm: 90, riding: true, ...over });

const workout: Workout = {
  name: 'Sweet spot',
  steps: [
    { kind: 'warmup', durationS: 300, target: { kind: 'ftp', from: 0.5, to: 0.75 } },
    { kind: 'steady', durationS: 1200, target: { kind: 'ftp', from: 0.9, to: 0.9 } },
  ],
  messages: [],
  warnings: [],
};

function setup() {
  let t = 1_000_000;
  const room = new Room(COL_DES_ERABLES, () => t);
  const names = ['Tom', 'Léa', 'Émile', 'Zoé'];
  const conns = names.map(() => new FakeConn());
  const slots = names.map((n, i) => room.join({ id: `u${i}`, name: n }, conns[i]!));
  const send = (i: number, msg: object) => room.receive(slots[i]!, JSON.stringify(msg));
  return { room, conns, slots, send, advance: (ms: number) => (t += ms), now: () => t };
}

describe('Room : qui est en ligne', () => {
  it("liste les coureurs en sortie d'abord, puis les autres par nom, sans soi", () => {
    const { room, conns, slots, send, advance } = setup();
    room.receive(slots[2]!, codec.encodeState(riding())); // Émile roule
    advance(200);
    send(0, { type: 'who' });
    const who = conns[0]!.last('who')!;
    expect(who.riders).toEqual([
      { slot: slots[2], name: 'Émile', riding: true },
      { slot: slots[1], name: 'Léa', riding: false },
      { slot: slots[3], name: 'Zoé', riding: false },
    ]);
    expect(who.total).toBe(3);
  });

  it('cherche sans tenir compte des accents ni des majuscules', () => {
    const { conns, send } = setup();
    send(0, { type: 'who', q: 'lea' });
    expect(conns[0]!.last('who')!.riders.map((r: { name: string }) => r.name)).toEqual(['Léa']);
    send(2, { type: 'who', q: 'EMILE' });
    expect(conns[2]!.last('who')!.riders.map((r: { name: string }) => r.name)).toEqual([]); // Émile se cherche lui-même : exclu
    send(1, { type: 'who', q: 'emile' });
    expect(conns[1]!.last('who')!.riders.map((r: { name: string }) => r.name)).toEqual(['Émile']);
  });

  it('cache ceux qui ne veulent pas être rejoints, et un coureur arrêté depuis longtemps ne roule plus', () => {
    const { room, conns, slots, send, advance } = setup();
    send(1, { type: 'joinable', who: 'none' });
    room.receive(slots[2]!, codec.encodeState(riding()));
    advance(STATE_TTL_MS + 1);
    send(0, { type: 'who' });
    const riders = conns[0]!.last('who')!.riders as { name: string; riding: boolean }[];
    expect(riders.map((r) => r.name)).toEqual(['Émile', 'Zoé']);
    expect(riders[0]!.riding).toBe(false);
  });

  it('limite la réponse et ne répond pas plus d’une fois par seconde à un même coureur', () => {
    const { room, conns, send, advance } = setup();
    for (let i = 0; i < 40; i++) room.join({ id: `x${i}`, name: `Coureur ${String(i).padStart(2, '0')}` }, new FakeConn());
    send(0, { type: 'who' });
    expect(conns[0]!.last('who')!.riders).toHaveLength(WHO_MAX);
    expect(conns[0]!.last('who')!.total).toBe(43);
    send(0, { type: 'who' });
    expect(conns[0]!.count('who')).toBe(1);
    advance(1000);
    send(0, { type: 'who' });
    expect(conns[0]!.count('who')).toBe(2);
  });

  it("répond à une mesure d'horloge avec l'heure du serveur", () => {
    const { conns, send, now } = setup();
    send(0, { type: 'time', c: 12345 });
    expect(conns[0]!.last('time')).toEqual({ type: 'time', c: 12345, s: now() });
  });
});

describe('Room : séances de groupe', () => {
  it('crée un groupe : le créateur le rejoint, départ sur l’horloge du serveur', () => {
    const { conns, slots, send, now } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250, massKg: 75 });
    const state = conns[0]!.last('groupState')!.group;
    expect(state).toMatchObject({ id: 'g1', name: 'Séance de Tom', courseId: 'col', t0: now() + 300_000, members: [{ slot: slots[0], name: 'Tom' }] });
    expect(state.workout.name).toBe('Sweet spot');
  });

  it('borne le départ : pas avant 30 s, pas après 30 min', () => {
    const { conns, send, now } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 1, ftpW: 250, massKg: 75 });
    expect(conns[0]!.last('groupState')!.group.t0).toBe(now() + MIN_START_IN_S * 1000);
    send(1, { type: 'groupCreate', workout, courseId: 'col', startInS: 99999, ftpW: 250, massKg: 75 });
    expect(conns[1]!.last('groupState')!.group.t0).toBe(now() + MAX_START_IN_S * 1000);
  });

  it('un nouvel arrivant reçoit la séance entière, les autres la liste des membres', () => {
    const { conns, slots, send } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250, massKg: 75 });
    send(1, { type: 'groupJoin', id: 'g1' });
    expect(conns[1]!.last('groupState')!.group.members.map((m: { name: string }) => m.name)).toEqual(['Tom', 'Léa']);
    expect(conns[0]!.last('groupMembers')).toEqual({ type: 'groupMembers', id: 'g1', leader: slots[0], members: [{ slot: slots[0], name: 'Tom' }, { slot: slots[1], name: 'Léa' }] });
    expect(conns[1]!.last('groupMembers')).toBeUndefined(); // il n'est pas prévenu de sa propre arrivée
  });

  it('refuse un groupe inconnu, plein, ou une séance invalide', () => {
    const { conns, room, send } = setup();
    send(1, { type: 'groupJoin', id: 'g99' });
    expect(conns[1]!.last('groupClosed')).toEqual({ type: 'groupClosed', id: 'g99', reason: 'unknown' });
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250, massKg: 75 });
    for (let i = 0; i < MAX_MEMBERS; i++) {
      const c = new FakeConn();
      const slot = room.join({ id: `m${i}`, name: `M${i}` }, c);
      room.receive(slot, JSON.stringify({ type: 'groupJoin', id: 'g1' }));
    }
    send(1, { type: 'groupJoin', id: 'g1' });
    expect(conns[1]!.last('groupClosed')).toEqual({ type: 'groupClosed', id: 'g1', reason: 'full' });
    const before = room.rejected;
    send(2, { type: 'groupCreate', workout: { ...workout, steps: [] }, courseId: 'col', startInS: 60, ftpW: 250, massKg: 75 });
    expect(room.rejected).toBe(before + 1); // séance hors bornes : message rejeté
  });

  it('quitter ou partir prévient les autres ; le dernier qui part ferme le groupe', () => {
    const { room, conns, slots, send, advance } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250, massKg: 75 });
    send(1, { type: 'groupJoin', id: 'g1' });
    send(1, { type: 'groupLeave' });
    expect(conns[0]!.last('groupMembers')!.members).toEqual([{ slot: slots[0], name: 'Tom' }]);
    send(1, { type: 'who' });
    expect(conns[1]!.last('who')!.groups).toHaveLength(1);
    room.leave(slots[0]!); // le dernier part : le groupe se ferme
    advance(1000);
    send(1, { type: 'who' });
    expect(conns[1]!.last('who')!.groups).toEqual([]);
  });

  it('un coureur est dans un seul groupe : en rejoindre un autre quitte le premier', () => {
    const { conns, slots, send } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250, massKg: 75 });
    send(2, { type: 'groupCreate', workout: { ...workout, name: 'Rampe' }, courseId: 'col', startInS: 600, ftpW: 250, massKg: 75 });
    send(1, { type: 'groupJoin', id: 'g1' });
    send(1, { type: 'groupJoin', id: 'g2' });
    expect(conns[0]!.last('groupMembers')!.members).toEqual([{ slot: slots[0], name: 'Tom' }]);
    expect(conns[2]!.last('groupMembers')!.members.map((m: { name: string }) => m.name)).toEqual(['Émile', 'Léa']);
  });

  it('liste les groupes ouverts avec « qui est en ligne », le plus proche du départ d’abord', () => {
    const { conns, send, advance } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 600, ftpW: 250, massKg: 75 });
    send(2, { type: 'groupCreate', workout: { ...workout, name: 'Rampe' }, courseId: 'rive', startInS: 120, ftpW: 250, massKg: 75 });
    advance(1000);
    send(1, { type: 'who' });
    const groups = conns[1]!.last('who')!.groups;
    expect(groups.map((g: { workoutName: string }) => g.workoutName)).toEqual(['Rampe', 'Sweet spot']);
    expect(groups[0]).toMatchObject({ id: 'g2', name: 'Séance de Émile', courseId: 'rive', count: 1, durationS: 1500 });
  });

  it('ferme un groupe dont la séance est finie depuis plus de dix minutes, et prévient ses membres', () => {
    const { room, conns, send, advance } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 60, ftpW: 250, massKg: 75 });
    advance((60 + 1500 + 600) * 1000 + 1);
    room.tick();
    expect(conns[0]!.last('groupClosed')).toEqual({ type: 'groupClosed', id: 'g1', reason: 'over' });
    send(1, { type: 'who' });
    expect(conns[1]!.last('who')!.groups).toEqual([]);
  });

  it('ne dépasse pas le nombre de groupes ouverts dans la salle', () => {
    const { room } = setup();
    const conns: FakeConn[] = [];
    for (let i = 0; i < MAX_GROUPS + 1; i++) {
      const c = new FakeConn();
      conns.push(c);
      const slot = room.join({ id: `g${i}`, name: `G${i}` }, c);
      room.receive(slot, JSON.stringify({ type: 'groupCreate', workout, courseId: 'col', startInS: 60, ftpW: 250, massKg: 75 }));
    }
    expect(conns.at(-1)!.last('groupClosed')).toMatchObject({ reason: 'full' });
  });
});

describe('Room : le créateur du groupe choisit la route', () => {
  it("le créateur est le premier membre ; son choix est renvoyé à tous les membres, lui compris", () => {
    const { conns, slots, send } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250, massKg: 75 });
    expect(conns[0]!.last('groupState')!.group.leader).toBe(slots[0]);
    send(1, { type: 'groupJoin', id: 'g1' });
    send(0, { type: 'groupRoute', leg: 4, index: 1 });
    for (const i of [0, 1]) expect(conns[i]!.last('groupRoute')).toEqual({ type: 'groupRoute', leg: 4, index: 1 });
    expect(conns[2]!.last('groupRoute')).toBeUndefined(); // un coureur hors du groupe ne reçoit rien
  });

  it("un autre membre, ou un coureur sans groupe, ne choisit pas", () => {
    const { conns, send } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250, massKg: 75 });
    send(1, { type: 'groupJoin', id: 'g1' });
    send(1, { type: 'groupRoute', leg: 4, index: 1 });
    send(3, { type: 'groupRoute', leg: 4, index: 1 });
    for (const c of conns) expect(c.last('groupRoute')).toBeUndefined();
  });

  it("un nouvel arrivant reçoit les choix déjà faits, pour rejouer le même trajet", () => {
    const { conns, send } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250, massKg: 75 });
    send(0, { type: 'groupRoute', leg: 4, index: 1 });
    send(0, { type: 'groupRoute', leg: 9, index: 2 });
    send(0, { type: 'groupRoute', leg: 4, index: 0 }); // il change d'avis : le dernier compte
    send(1, { type: 'groupJoin', id: 'g1' });
    expect(conns[1]!.last('groupState')!.group.routes).toEqual([[4, 0], [9, 2]]);
  });

  it("quand le créateur part, le plus ancien qui reste choisit à sa place", () => {
    const { room, conns, slots, send } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250, massKg: 75 });
    send(1, { type: 'groupJoin', id: 'g1' });
    send(2, { type: 'groupJoin', id: 'g1' });
    room.leave(slots[0]!);
    expect(conns[1]!.last('groupMembers')!.leader).toBe(slots[1]);
    send(2, { type: 'groupRoute', leg: 1, index: 0 }); // le troisième n'est pas le créateur
    expect(conns[1]!.last('groupRoute')).toBeUndefined();
    send(1, { type: 'groupRoute', leg: 1, index: 0 });
    expect(conns[2]!.last('groupRoute')).toEqual({ type: 'groupRoute', leg: 1, index: 0 });
  });

  it("rejette un rang ou une option absurdes", () => {
    const { room, send } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250, massKg: 75 });
    const before = room.rejected;
    send(0, { type: 'groupRoute', leg: -1, index: 0 });
    send(0, { type: 'groupRoute', leg: 1.5, index: 0 });
    send(0, { type: 'groupRoute', leg: 1, index: 99 });
    send(0, { type: 'groupRoute', leg: 100000, index: 0 });
    expect(room.rejected).toBe(before + 4);
  });
});

describe('Room : le groupe prend l\'allure de son créateur', () => {
  it("garde sa FTP et sa masse, et les donne à ceux qui arrivent", () => {
    const { conns, send } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 310, massKg: 82 });
    expect(conns[0]!.last('groupState')!.group).toMatchObject({ ftpW: 310, massKg: 82 });
    send(1, { type: 'groupJoin', id: 'g1' });
    expect(conns[1]!.last('groupState')!.group).toMatchObject({ ftpW: 310, massKg: 82 });
  });

  it("ne change pas quand le créateur part : l'allure est celle de la création", () => {
    const { room, conns, slots, send } = setup();
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 310, massKg: 82 });
    send(1, { type: 'groupJoin', id: 'g1' });
    room.leave(slots[0]!);
    send(2, { type: 'groupJoin', id: 'g1' });
    expect(conns[2]!.last('groupState')!.group).toMatchObject({ ftpW: 310, massKg: 82 });
  });

  it("refuse une FTP ou une masse absurdes, ou absentes", () => {
    const { room, send } = setup();
    const before = room.rejected;
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 5000, massKg: 75 });
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250, massKg: 2 });
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 250 });
    send(0, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 'x', massKg: 75 });
    expect(room.rejected).toBe(before + 4);
  });
});
