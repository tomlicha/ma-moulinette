import { describe, expect, it } from 'vitest';
import { FollowSession } from '../app/follow-session';
import { COL_DES_ERABLES } from '../domain/course/courses/col-des-erables';
import { Journey } from '../domain/sim/journey';
import { WorldClient } from '../infra/net/world-client';
import { Room, TICK_MS } from '../server/room';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Prise reliée directement à la salle, texte et binaire : ce que fait le Durable Object, sans réseau. */
class LoopSocket {
  binaryType: BinaryType = 'blob';
  readyState = 1;
  onopen: ((ev: Event) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  slot = 0;
  constructor(
    private readonly room: Room,
    user: { id: string; name: string },
  ) {
    queueMicrotask(() => {
      this.slot = room.join(user, {
        // Comme un vrai WebSocket : la livraison est asynchrone, le numéro est connu avant la première réponse.
        send: (data) => queueMicrotask(() => this.onmessage?.({ data } as MessageEvent)),
        close: (code) => this.onclose?.({ code } as CloseEvent),
      });
    });
  }
  send(data: string | ArrayBuffer) {
    this.room.receive(this.slot, data);
  }
  close() {
    this.room.leave(this.slot);
    this.onclose?.({ code: 1000 } as CloseEvent);
  }
}

describe('rejoindre et suivre : deux vrais clients contre la vraie salle', () => {
  it('Tom rejoint Léa en roulant : placé 10 m derrière elle, il la suit, elle le sait, puis il arrête', async () => {
    let now = 0;
    const room = new Room(COL_DES_ERABLES, () => now);
    const client = (id: string, name: string) =>
      new WorldClient(COL_DES_ERABLES, { url: 'ws://test', now: () => now, createSocket: () => new LoopSocket(room, { id, name }) });
    const tomWorld = client('u1', 'Tom');
    const leaWorld = client('u2', 'Léa');
    const tom = new FollowSession({ world: tomWorld });
    const lea = new FollowSession({ world: leaWorld });
    tomWorld.onGroup = (m) => tom.handle(m);
    leaWorld.onGroup = (m) => lea.handle(m);
    tomWorld.connect();
    leaWorld.connect();
    await flush();

    // Léa roule depuis le départ du Col, à 10 m/s.
    const leaJourney = new Journey(COL_DES_ERABLES);
    let leaD = 0;
    for (let step = 0; step < 100; step++) {
      now = step * 100;
      leaD = (now / 1000) * 10 + 300;
      leaJourney.update(leaD);
      leaWorld.update({ pos: leaJourney.locate(leaD), speedMs: 10, powerW: 220, cadenceRpm: 90, riding: true });
      if (now % TICK_MS === 0) room.tick();
      await flush();
    }
    const leaPos = leaJourney.locate(leaD);
    const slotOfLea = tomWorld.riders(now).find((r) => r.name === 'Léa')!.slot;

    const started: unknown[] = [];
    tom.on('started', (i) => started.push(i));
    tom.request(slotOfLea, 'Léa', 'place');
    await flush();
    expect(started).toHaveLength(1);
    expect(tom.state?.phase).toBe('following');
    expect(lea.followers).toEqual([{ slot: expect.any(Number), name: 'Tom' }]);

    // La sortie de Tom repart derrière Léa : son trajet commence là, 10 m en arrière sur la même route.
    const tomJourney = new Journey(COL_DES_ERABLES);
    const info = started[0] as { pos: { edgeId: string; forward: boolean; s: number } };
    const placed = tomJourney.placeAt(info.pos)!;
    expect(placed.edgeId).toBe(leaPos.edgeId);
    expect(placed.forward).toBe(leaPos.forward);
    const gap = leaPos.forward ? leaPos.s - placed.s : placed.s - leaPos.s;
    expect(gap).toBeGreaterThan(9); // 10 m, moins ce que Léa a avancé depuis le dernier état reçu par la salle
    expect(gap).toBeLessThan(20);

    // Tom arrête : Léa n'est plus suivie.
    tom.stop();
    await flush();
    expect(lea.followers).toEqual([]);
  });

  it('Léa se met sur « personne » : Tom est refusé, avec une raison lisible', async () => {
    let now = 0;
    const room = new Room(COL_DES_ERABLES, () => now);
    const client = (id: string, name: string) =>
      new WorldClient(COL_DES_ERABLES, { url: 'ws://test', now: () => now, createSocket: () => new LoopSocket(room, { id, name }) });
    const tomWorld = client('u1', 'Tom');
    const leaWorld = client('u2', 'Léa');
    const tom = new FollowSession({ world: tomWorld });
    tomWorld.onGroup = (m) => tom.handle(m);
    // Le réglage est choisi avant la connexion : il part avec elle.
    leaWorld.setJoinable('none');
    tomWorld.connect();
    leaWorld.connect();
    await flush();
    const journey = new Journey(COL_DES_ERABLES);
    leaWorld.update({ pos: journey.locate(300), speedMs: 10, powerW: 220, cadenceRpm: 90, riding: true });
    now += 300;
    room.tick();
    await flush();
    const slot = tomWorld.riders(now).find((r) => r.name === 'Léa')!.slot;
    const ended: unknown[] = [];
    tom.on('ended', (reason, name) => ended.push([reason, name]));
    tom.request(slot, 'Léa', 'chase');
    await flush();
    expect(ended).toEqual([['denied', 'Léa']]);
    expect(tom.state).toBeUndefined();
  });
});
