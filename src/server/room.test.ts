import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../sim/courses/col-des-erables';
import { Journey } from '../sim/journey';
import { MSG_SNAPSHOT, StateCodec, type RiderState } from '../net/protocol';
import { WorldClient, type WorldStatus } from '../net/world-client';
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
