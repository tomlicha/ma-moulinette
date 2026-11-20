import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../domain/course/courses/col-des-erables';
import { StateCodec, type RiderState } from '../infra/net/protocol';
import { Room, STATE_TTL_MS, type Connection, type Member } from './room';

const codec = new StateCodec(COL_DES_ERABLES);
const edge0 = [...COL_DES_ERABLES.edges.keys()][0]!;

class FakeConn implements Connection {
  sent: (string | ArrayBuffer)[] = [];
  saved: Member[] = [];
  send(d: string | ArrayBuffer) {
    this.sent.push(d);
  }
  close() {}
  save(m: Member) {
    this.saved.push(m);
  }
  texts() {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d) as Record<string, unknown>);
  }
  last(type: string) {
    return this.texts().filter((t) => t.type === type).at(-1);
  }
}

const state = (over: Partial<RiderState> = {}): RiderState => ({
  pos: { edgeId: edge0, forward: true, s: 120 },
  tMs: 1000,
  speedMs: 10,
  powerW: 200,
  cadenceRpm: 90,
  riding: true,
  ...over,
});

/** Une salle avec Lucie qui roule, Marc qui roule et Zoé qui ne roule pas. */
function setup(opts: ConstructorParameters<typeof Room>[2] = {}) {
  let t = 0;
  const room = new Room(COL_DES_ERABLES, () => t, opts);
  const conns = { lucie: new FakeConn(), marc: new FakeConn(), zoe: new FakeConn() };
  const slots = {
    lucie: room.join({ id: 'u-lucie', name: 'Lucie' }, conns.lucie),
    marc: room.join({ id: 'u-marc', name: 'Marc' }, conns.marc),
    zoe: room.join({ id: 'u-zoe', name: 'Zoé' }, conns.zoe),
  };
  room.receive(slots.lucie, codec.encodeState(state()));
  t += 200;
  room.receive(slots.marc, codec.encodeState(state({ pos: { edgeId: edge0, forward: true, s: 300 } })));
  const send = (slot: number, msg: object) => room.receive(slot, JSON.stringify(msg));
  return { room, conns, slots, send, advance: (ms: number) => (t += ms) };
}

describe('Room : suivre un coureur', () => {
  it("accepte le suivi d'un coureur qui roule, lui donne sa position et prévient le coureur suivi", () => {
    const { conns, slots, send } = setup();
    send(slots.marc, { type: 'follow', slot: slots.lucie });
    expect(conns.marc.last('followStart')).toEqual({
      type: 'followStart',
      slot: slots.lucie,
      name: 'Lucie',
      pos: { edgeId: edge0, forward: true, s: 120 },
    });
    expect(conns.lucie.last('followedBy')).toEqual({ type: 'followedBy', slot: slots.marc, name: 'Marc' });
  });

  it("refuse de suivre quelqu'un qui ne roule pas, qui n'existe pas, ou soi-même", () => {
    const { conns, slots, send } = setup();
    send(slots.marc, { type: 'follow', slot: slots.zoe });
    expect(conns.marc.last('followEnd')).toEqual({ type: 'followEnd', reason: 'unavailable' });
    send(slots.marc, { type: 'follow', slot: 999 });
    expect(conns.marc.texts().filter((t) => t.type === 'followEnd')).toHaveLength(2);
    send(slots.marc, { type: 'follow', slot: slots.marc });
    expect(conns.marc.texts().filter((t) => t.type === 'followEnd')).toHaveLength(3);
    expect(conns.marc.last('followStart')).toBeUndefined();
  });

  it("refuse un coureur arrêté : « riding » faux, ou plus de nouvelles depuis trop longtemps", () => {
    const { room, conns, slots, send, advance } = setup();
    room.receive(slots.lucie, codec.encodeState(state({ riding: false })));
    advance(200);
    send(slots.marc, { type: 'follow', slot: slots.lucie });
    expect(conns.marc.last('followEnd')).toEqual({ type: 'followEnd', reason: 'unavailable' });
    room.receive(slots.lucie, codec.encodeState(state()));
    advance(STATE_TTL_MS);
    send(slots.marc, { type: 'follow', slot: slots.lucie });
    expect(conns.marc.texts().filter((t) => t.type === 'followEnd')).toHaveLength(2);
  });

  it("applique « Qui peut me rejoindre » : personne, amis, tous", () => {
    const friends = new Set(['u-marc|u-lucie']);
    const { conns, slots, send } = setup({ areFriends: (a, b) => friends.has(`${a}|${b}`) });
    send(slots.lucie, { type: 'joinable', who: 'none' });
    send(slots.marc, { type: 'follow', slot: slots.lucie });
    expect(conns.marc.last('followEnd')).toEqual({ type: 'followEnd', reason: 'denied' });
    expect(conns.lucie.last('followedBy')).toBeUndefined();

    send(slots.lucie, { type: 'joinable', who: 'friends' });
    send(slots.marc, { type: 'follow', slot: slots.lucie });
    expect(conns.marc.last('followStart')).toBeDefined(); // Marc est ami de Lucie

    send(slots.marc, { type: 'unfollow' });
    send(slots.zoe, { type: 'follow', slot: slots.lucie }); // Zoé ne l'est pas
    expect(conns.zoe.last('followEnd')).toEqual({ type: 'followEnd', reason: 'denied' });
  });

  it("garde le réglage avec la connexion, pour le retrouver au réveil de la salle", () => {
    const { room, conns, slots, send } = setup();
    send(slots.lucie, { type: 'joinable', who: 'none' });
    expect(conns.lucie.saved.at(-1)).toEqual({ slot: slots.lucie, userId: 'u-lucie', name: 'Lucie', joinable: 'none' });
    // Réveil : une nouvelle salle reprend Lucie avec son réglage, et refuse Marc.
    const woken = new Room(COL_DES_ERABLES, () => 0);
    const lucie = new FakeConn();
    const marc = new FakeConn();
    woken.restore(conns.lucie.saved.at(-1)!, lucie);
    woken.restore({ slot: slots.marc, userId: 'u-marc', name: 'Marc' }, marc);
    woken.receive(slots.lucie, codec.encodeState(state()));
    woken.receive(slots.marc, JSON.stringify({ type: 'follow', slot: slots.lucie }));
    expect(marc.last('followEnd')).toEqual({ type: 'followEnd', reason: 'denied' });
    expect(room.size).toBe(3);
  });

  it("annonce la fin du suivi à celui qui était suivi", () => {
    const { conns, slots, send } = setup();
    send(slots.marc, { type: 'follow', slot: slots.lucie });
    send(slots.marc, { type: 'unfollow' });
    expect(conns.lucie.last('unfollowedBy')).toEqual({ type: 'unfollowedBy', slot: slots.marc });
  });

  it("le coureur suivi peut renvoyer un suiveur, et lui seul", () => {
    const { conns, slots, send } = setup();
    send(slots.marc, { type: 'follow', slot: slots.lucie });
    send(slots.zoe, { type: 'refuse', slot: slots.marc }); // Zoé n'est pas suivie par Marc : sans effet
    expect(conns.marc.last('followEnd')).toBeUndefined();
    send(slots.lucie, { type: 'refuse', slot: slots.marc });
    expect(conns.marc.last('followEnd')).toEqual({ type: 'followEnd', reason: 'refused' });
  });

  it("suivre quelqu'un d'autre met fin au suivi précédent ; suivre le même meneur deux fois n'annonce qu'une fois", () => {
    const { room, conns, slots, send } = setup();
    room.receive(slots.zoe, codec.encodeState(state({ pos: { edgeId: edge0, forward: true, s: 500 } })));
    send(slots.marc, { type: 'follow', slot: slots.lucie });
    send(slots.marc, { type: 'follow', slot: slots.lucie });
    expect(conns.lucie.texts().filter((t) => t.type === 'followedBy')).toHaveLength(1);
    send(slots.marc, { type: 'follow', slot: slots.zoe });
    expect(conns.lucie.last('unfollowedBy')).toEqual({ type: 'unfollowedBy', slot: slots.marc });
    expect(conns.zoe.last('followedBy')).toEqual({ type: 'followedBy', slot: slots.marc, name: 'Marc' });
  });

  it("quand le coureur suivi part, ses suiveurs l'apprennent ; quand un suiveur part, le coureur suivi aussi", () => {
    const { room, conns, slots, send } = setup();
    send(slots.marc, { type: 'follow', slot: slots.lucie });
    room.leave(slots.lucie);
    expect(conns.marc.last('followEnd')).toEqual({ type: 'followEnd', reason: 'left' });

    const b = setup();
    b.send(b.slots.marc, { type: 'follow', slot: b.slots.lucie });
    b.room.leave(b.slots.marc);
    expect(b.conns.lucie.last('unfollowedBy')).toEqual({ type: 'unfollowedBy', slot: b.slots.marc });
  });

  it("rejette les messages texte mal formés ou inconnus, sans rien casser", () => {
    const { room, slots } = setup();
    for (const bad of ['pas du json', '{"type":"follow"}', '{"type":"follow","slot":-1}', '{"type":"x"}', '{"type":"joinable","who":"tous"}', '"x"', 'x'.repeat(400)]) {
      room.receive(slots.marc, bad);
    }
    expect(room.rejected).toBe(7);
  });
});
