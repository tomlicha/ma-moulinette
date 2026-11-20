import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../domain/course/courses/col-des-erables';
import { MAX_FRIENDS } from '../shared/protocol/friends';
import { StateCodec, type RiderState } from '../infra/net/protocol';
import { Room, type Connection, type FriendListStore } from './room';

const codec = new StateCodec(COL_DES_ERABLES);
const edge0 = [...COL_DES_ERABLES.edges.keys()][0]!;
const riding = (): RiderState => ({ pos: { edgeId: edge0, forward: true, s: 100 }, tMs: 1000, speedMs: 10, powerW: 200, cadenceRpm: 90, riding: true });

class FakeConn implements Connection {
  sent: string[] = [];
  send(d: string | ArrayBuffer) {
    if (typeof d === 'string') this.sent.push(d);
  }
  close() {}
  last(type: string) {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>).filter((m) => m.type === type).at(-1);
  }
}

function setup(store?: FriendListStore) {
  let t = 1000;
  const room = new Room(COL_DES_ERABLES, () => t, store ? { friendStore: store } : {});
  const users = { tom: 'u-tom', lea: 'u-lea', marc: 'u-marc', zoe: 'u-zoe' } as const;
  const names = ['tom', 'lea', 'marc', 'zoe'] as const;
  const conns = Object.fromEntries(names.map((n) => [n, new FakeConn()])) as Record<(typeof names)[number], FakeConn>;
  const slots = Object.fromEntries(names.map((n) => [n, room.join({ id: users[n], name: n[0]!.toUpperCase() + n.slice(1) }, conns[n])])) as Record<(typeof names)[number], number>;
  for (const n of names) room.receive(slots[n], codec.encodeState(riding()));
  const say = (who: (typeof names)[number], msg: object) => {
    t += 1000;
    room.receive(slots[who], JSON.stringify(msg));
  };
  const riders = (who: (typeof names)[number]) => (conns[who].last('who') as { riders: { name: string; friend: boolean; open: boolean; uid: string }[] }).riders;
  return { room, conns, slots, say, riders, users };
}

describe('Room : les amis', () => {
  it('passe mes amis en tête de la liste, marqués, avec le compte de chacun', () => {
    const { say, riders, users } = setup();
    say('tom', { type: 'friends', ids: [users.zoe] });
    say('tom', { type: 'who' });
    const list = riders('tom');
    expect(list.map((r) => r.name)).toEqual(['Zoe', 'Lea', 'Marc']); // Zoe, mon amie, passe devant malgré l'ordre alphabétique
    expect(list.map((r) => r.friend)).toEqual([true, false, false]);
    expect(list[0]!.uid).toBe('u-zoe');
  });

  it("les amis sont à sens unique : l'autre ne voit pas qu'on l'a ajouté", () => {
    const { say, riders, users } = setup();
    say('tom', { type: 'friends', ids: [users.lea] });
    say('lea', { type: 'who' });
    expect(riders('lea').every((r) => !r.friend)).toBe(true);
  });

  it("« ouvert » dit si je peux rejoindre : tout le monde, ou ses amis dont je suis ; « personne » se cache", () => {
    const { say, riders, users } = setup();
    say('lea', { type: 'joinable', who: 'friends' });
    say('marc', { type: 'joinable', who: 'none' });
    say('lea', { type: 'friends', ids: [users.tom] }); // Léa a ajouté Tom : Tom peut la rejoindre
    say('tom', { type: 'who' });
    const byName = Object.fromEntries(riders('tom').map((r) => [r.name, r.open]));
    expect(byName).toEqual({ Lea: true, Zoe: true }); // Marc ne s'affiche pas
    say('zoe', { type: 'who' });
    expect(Object.fromEntries(riders('zoe').map((r) => [r.name, r.open])).Lea).toBe(false); // Zoé n'est pas dans la liste de Léa
  });

  it("« mes amis peuvent me rejoindre » : seuls ceux que le coureur suivi a ajoutés, pas l'inverse", () => {
    const { say, conns, slots, users } = setup();
    say('lea', { type: 'joinable', who: 'friends' });
    say('lea', { type: 'friends', ids: [users.marc] }); // Léa a ajouté Marc
    say('tom', { type: 'friends', ids: [users.lea] }); // Tom a ajouté Léa : cela ne donne rien à Tom
    say('marc', { type: 'follow', slot: slots.lea });
    expect(conns.marc.last('followStart')).toBeDefined();
    say('tom', { type: 'follow', slot: slots.lea });
    expect(conns.tom.last('followEnd')).toEqual({ type: 'followEnd', reason: 'denied' });
    say('zoe', { type: 'follow', slot: slots.lea });
    expect(conns.zoe.last('followEnd')).toEqual({ type: 'followEnd', reason: 'denied' });
  });

  it("ignore soi-même dans sa liste, les doublons, et rejette une liste mal formée ou trop longue", () => {
    const { room, say, riders, users } = setup();
    say('tom', { type: 'friends', ids: [users.tom, users.lea, users.lea] });
    say('tom', { type: 'who' });
    expect(riders('tom').filter((r) => r.friend).map((r) => r.name)).toEqual(['Lea']);
    const before = room.rejected;
    say('tom', { type: 'friends', ids: 'u1' });
    say('tom', { type: 'friends', ids: [12] });
    say('tom', { type: 'friends', ids: ['a b'] });
    say('tom', { type: 'friends', ids: Array.from({ length: MAX_FRIENDS + 1 }, (_, i) => `u${i}`) });
    expect(room.rejected).toBe(before + 4);
  });

  it("range la liste, la retire quand le compte part, et ne reprend que celles des comptes encore connectés", () => {
    const saved = new Map<string, readonly string[]>();
    const store: FriendListStore = { save: (u, ids) => void saved.set(u, [...ids]), remove: (u) => void saved.delete(u) };
    const { room, say, slots, users } = setup(store);
    say('tom', { type: 'friends', ids: [users.lea, users.zoe] });
    say('lea', { type: 'friends', ids: [users.tom] });
    expect(saved.get('u-tom')).toEqual(['u-lea', 'u-zoe']);
    room.leave(slots.tom);
    expect(saved.has('u-tom')).toBe(false);
    expect(saved.get('u-lea')).toEqual(['u-tom']);

    // Redémarrage : une nouvelle salle reprend Léa (connectée) mais pas Tom (parti), et efface ce qui est resté de lui.
    const removed: string[] = [];
    const woken = new Room(COL_DES_ERABLES, () => 0, { friendStore: { save: () => undefined, remove: (u) => void removed.push(u) } });
    const conn = new FakeConn();
    woken.restore({ slot: 9, userId: 'u-lea', name: 'Lea' }, conn);
    woken.restore({ slot: 10, userId: 'u-zoe', name: 'Zoé' }, new FakeConn());
    woken.restoreFriends([['u-lea', ['u-zoe']], ['u-tom', ['u-lea']]]);
    expect(removed).toEqual(['u-tom']);
    woken.receive(10, codec.encodeState(riding()));
    woken.receive(10, JSON.stringify({ type: 'who' }));
    woken.receive(9, JSON.stringify({ type: 'who' }));
    const who = conn.last('who') as { riders: { name: string; friend: boolean }[] };
    expect(who.riders).toEqual([expect.objectContaining({ name: 'Zoé', friend: true })]);
  });

  it("un compte connecté deux fois garde sa liste tant qu'une connexion reste", () => {
    const saved = new Map<string, readonly string[]>();
    const { room, say, slots, users } = setup({ save: (u, ids) => void saved.set(u, [...ids]), remove: (u) => void saved.delete(u) });
    say('tom', { type: 'friends', ids: [users.lea] });
    const second = room.join({ id: 'u-tom', name: 'Tom' }, new FakeConn()); // l'autre onglet remplace le premier
    expect(second).not.toBe(slots.tom);
    expect(saved.has('u-tom')).toBe(false); // la première connexion est partie : la page renverra sa liste
  });
});
