import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../domain/course/courses/col-des-erables';
import { Journey } from '../domain/sim/journey';
import { MSG_SNAPSHOT, StateCodec, type RiderState } from '../infra/net/protocol';
import { WorldClient, type WorldStatus } from '../infra/net/world-client';
import { CLOSE_REPLACED, MAX_SPEED_MS, Room, STATE_TTL_MS, TICK_MS, type Connection } from './room';

const codec = new StateCodec(COL_DES_ERABLES);
const edge0 = [...COL_DES_ERABLES.edges.keys()][0]!;

class FakeConn implements Connection {
  sent: (string | ArrayBuffer)[] = [];
  closed?: { code: number; reason: string };
  send(d: string | ArrayBuffer) {
    this.sent.push(d);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  texts() {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
  }
  snapshots() {
    return this.sent.filter((d): d is ArrayBuffer => typeof d !== 'string').map((d) => codec.decodeSnapshot(d)!);
  }
}

const state = (over: Partial<RiderState> = {}): RiderState => ({
  pos: { edgeId: edge0, forward: true, s: 100 },
  tMs: 1000,
  speedMs: 10,
  powerW: 200,
  cadenceRpm: 90,
  riding: true,
  ...over,
});

describe('Room', () => {
  it("accueille chacun avec la liste de la salle et annonce l'arrivée aux autres", () => {
    const room = new Room(COL_DES_ERABLES);
    const a = new FakeConn();
    const b = new FakeConn();
    const sa = room.join({ id: 'u1', name: 'Tom L.' }, a);
    const sb = room.join({ id: 'u2', name: 'Léa' }, b);
    expect(a.texts()).toEqual([
      { type: 'welcome', slot: sa, members: [{ slot: sa, name: 'Tom L.' }] },
      { type: 'join', slot: sb, name: 'Léa' },
    ]);
    expect(b.texts()[0]).toEqual({ type: 'welcome', slot: sb, members: [{ slot: sa, name: 'Tom L.' }, { slot: sb, name: 'Léa' }] });
    room.leave(sa);
    expect(b.texts().at(-1)).toEqual({ type: 'leave', slot: sa });
    expect(room.size).toBe(1);
  });

  it("remplace la connexion d'un compte déjà présent", () => {
    const room = new Room(COL_DES_ERABLES);
    const old = new FakeConn();
    const other = new FakeConn();
    const s1 = room.join({ id: 'u1', name: 'Tom' }, old);
    room.join({ id: 'u2', name: 'Léa' }, other);
    const s3 = room.join({ id: 'u1', name: 'Tom' }, new FakeConn());
    expect(old.closed?.code).toBe(CLOSE_REPLACED);
    expect(other.texts()).toContainEqual({ type: 'leave', slot: s1 });
    expect(room.size).toBe(2);
    // La fermeture de l'ancienne connexion arrive après coup : elle ne fait partir personne.
    expect(s3).not.toBe(s1);
    room.leave(s1);
    expect(room.size).toBe(2);
  });

  it('relaie les états reçus à tous, 20 octets par coureur', () => {
    let t = 0;
    const room = new Room(COL_DES_ERABLES, () => t);
    const a = new FakeConn();
    const b = new FakeConn();
    const sa = room.join({ id: 'u1', name: 'A' }, a);
    room.join({ id: 'u2', name: 'B' }, b);
    room.tick();
    expect(b.snapshots()).toEqual([]); // personne n'a encore roulé
    expect(room.active).toBe(false);
    room.receive(sa, codec.encodeState(state()));
    expect(room.active).toBe(true);
    room.tick();
    const raw = b.sent.at(-1) as ArrayBuffer;
    expect(new Uint8Array(raw)[0]).toBe(MSG_SNAPSHOT);
    expect(raw.byteLength).toBe(2 + 20);
    expect(b.snapshots().at(-1)).toEqual([{ slot: sa, state: state() }]);
    // Plus de nouvelles : l'état n'est plus relayé, la salle peut se mettre en veille.
    t += STATE_TTL_MS;
    expect(room.active).toBe(false);
  });

  it('rejette les états mal formés, invraisemblables ou trop fréquents', () => {
    let t = 0;
    const room = new Room(COL_DES_ERABLES, () => t);
    const a = new FakeConn();
    const sa = room.join({ id: 'u1', name: 'A' }, a);
    room.receive(sa, new ArrayBuffer(3));
    room.receive(sa, codec.encodeState(state({ speedMs: MAX_SPEED_MS + 1 })));
    room.receive(sa, codec.encodeState(state({ pos: { edgeId: edge0, forward: true, s: 1e6 } })));
    expect(room.rejected).toBe(3);
    expect(room.active).toBe(false);
    room.receive(sa, codec.encodeState(state({ powerW: 100 })));
    t += 10;
    room.receive(sa, codec.encodeState(state({ powerW: 999 }))); // 10 ms après : ignoré
    room.tick();
    expect(a.snapshots().at(-1)![0]!.state.powerW).toBe(100);
  });

  it('reprend ses coureurs au réveil sans rien annoncer', () => {
    const room = new Room(COL_DES_ERABLES);
    const a = new FakeConn();
    room.restore({ slot: 7, userId: 'u1', name: 'A' }, a);
    expect(a.sent).toEqual([]);
    const b = new FakeConn();
    expect(room.join({ id: 'u2', name: 'B' }, b)).toBe(8); // jamais un numéro déjà pris
    expect(b.texts()[0].members).toContainEqual({ slot: 7, name: 'A' });
  });
});

/** Prise reliée directement à une salle : ce que fait le Durable Object, sans réseau. */
class LoopSocket {
  binaryType: BinaryType = 'blob';
  readyState = 1;
  onopen: ((ev: Event) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  slot = 0;
  constructor(private readonly room: Room, user: { id: string; name: string }) {
    queueMicrotask(() => {
      this.slot = room.join(user, {
        send: (data) => this.onmessage?.({ data } as MessageEvent),
        close: (code) => this.onclose?.({ code } as CloseEvent),
      });
    });
  }
  send(data: ArrayBuffer) {
    this.room.receive(this.slot, data);
  }
  close() {
    this.room.leave(this.slot);
    this.onclose?.({ code: 1000 } as CloseEvent);
  }
}

describe('client ↔ salle ↔ client', () => {
  it("chaque joueur voit l'autre rouler là où il est vraiment, 200 ms plus tard", async () => {
    let now = 0;
    const room = new Room(COL_DES_ERABLES, () => now);
    const client = (id: string, name: string) =>
      new WorldClient(COL_DES_ERABLES, { url: 'ws://test', now: () => now, createSocket: () => new LoopSocket(room, { id, name }) });
    const tom = client('u1', 'Tom L.');
    const lea = client('u2', 'Léa');
    const statuses: WorldStatus[] = [];
    lea.onStatus = (s) => statuses.push(s);
    tom.connect();
    lea.connect();
    await Promise.resolve();
    expect(statuses).toEqual(['connecting', 'online']);
    expect(lea.population).toBe(2);

    // Tom roule à 12 m/s sur le Col des Érables ; la salle émet ses instantanés toutes les 250 ms.
    const journey = new Journey(COL_DES_ERABLES);
    const speed = 12;
    let worst = 0;
    for (let step = 0; step <= 3000; step++) {
      now = step * 50;
      const d = (now / 1000) * speed;
      journey.update(d);
      tom.update({ pos: journey.locate(d), speedMs: speed, powerW: 230, cadenceRpm: 88, riding: true });
      if (now % TICK_MS === 0) room.tick();
      const seen = lea.riders(now);
      if (now < 1000) continue;
      expect(seen).toHaveLength(1);
      const r = seen[0]!;
      expect(r.name).toBe('Tom L.');
      // Ce que Léa voit, c'est Tom il y a 200 ms (le retard d'affichage), à l'écart d'une demi-image près.
      const truth = journey.pointAt(((now - 200) / 1000) * speed);
      worst = Math.max(worst, Math.hypot(r.point.x - truth.x, r.point.z - truth.z));
    }
    expect(worst).toBeLessThan(0.05);
    expect(tom.riders(now)).toEqual([]); // on ne se voit pas soi-même

    tom.disconnect();
    expect(lea.riders(now)).toEqual([]);
    expect(lea.population).toBe(1);
  });
});

describe('gestion d’intérêt', () => {
  const edges = [...COL_DES_ERABLES.edges.values()];

  /** Génère un monde de `n` coureurs répartis au hasard sur le réseau (graine fixe), chacun avec sa connexion. */
  function crowd(n: number, opts: { interestK: number; rangeM?: number }) {
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const room = new Room(COL_DES_ERABLES, () => 1000, opts);
    const riders = Array.from({ length: n }, (_, i) => {
      const edge = edges[Math.floor(rnd() * edges.length)]!;
      const s = rnd() * edge.lengthM;
      const conn = new FakeConn();
      const slot = room.join({ id: `u${i}`, name: `C${i}` }, conn);
      const p = edge.pointAt(s);
      room.receive(slot, codec.encodeState(state({ pos: { edgeId: edge.id, forward: true, s } })));
      return { slot, conn, x: p.x, z: p.z };
    });
    return { room, riders };
  }

  /** Numéros reçus au dernier instantané ; vide si personne n'est à portée (alors rien n'est envoyé). */
  const lastSlots = (conn: FakeConn) => new Set((conn.snapshots().at(-1) ?? []).map((e) => e.slot));

  it('envoie à chacun ses K plus proches voisins, lui exclu, comme un calcul exhaustif', () => {
    const K = 6;
    const rangeM = 4000;
    const { room, riders } = crowd(60, { interestK: K, rangeM });
    room.tick();
    for (const r of riders) {
      const expected = riders
        .filter((o) => o !== r)
        .map((o) => ({ slot: o.slot, d: Math.hypot(o.x - r.x, o.z - r.z) }))
        .filter((o) => o.d <= rangeM)
        .sort((a, b) => a.d - b.d)
        .slice(0, K);
      const got = lastSlots(r.conn);
      expect(got.size).toBe(expected.length);
      expect(got.has(r.slot)).toBe(false);
      // Les éventuelles égalités de distance mises à part, ce sont les mêmes coureurs.
      for (const e of expected) expect(got.has(e.slot)).toBe(true);
    }
  });

  it('ne dépasse jamais K coureurs par message, quelle que soit la taille de la salle', () => {
    const { room, riders } = crowd(300, { interestK: 10 });
    room.tick();
    for (const r of riders) expect(r.conn.snapshots().at(-1)!.length).toBeLessThanOrEqual(10);
  });

  it('écarte les coureurs hors de portée', () => {
    const { room, riders } = crowd(40, { interestK: 5, rangeM: 150 });
    room.tick();
    for (const r of riders) {
      for (const slot of lastSlots(r.conn)) {
        const o = riders.find((x) => x.slot === slot)!;
        expect(Math.hypot(o.x - r.x, o.z - r.z)).toBeLessThanOrEqual(150);
      }
    }
  });

  it('petite salle : tout le monde reçoit tout, soi-même compris (comme avant)', () => {
    const { room, riders } = crowd(5, { interestK: 10 });
    room.tick();
    for (const r of riders) expect(lastSlots(r.conn).size).toBe(5);
  });

  it('un coureur qui n’a pas encore donné de position ne reçoit rien, sans gêner les autres', () => {
    const { room, riders } = crowd(20, { interestK: 4 });
    const late = new FakeConn();
    room.join({ id: 'late', name: 'Retard' }, late);
    room.tick();
    expect(late.snapshots()).toHaveLength(0);
    expect(riders[0]!.conn.snapshots().at(-1)!.length).toBeLessThanOrEqual(4);
  });
});
