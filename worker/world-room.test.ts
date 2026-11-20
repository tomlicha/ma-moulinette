import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '../src/server/room.ts';
import { FRIENDS_PREFIX, GROUP_NEXT_KEY, GROUP_PREFIX, WorldRoom, type CfWebSocket, type DurableObjectStateLike } from './world-room.ts';

/** Une connexion factice : elle garde ce qu'on lui envoie, et son coureur en pièce jointe, comme celle de Cloudflare. */
class FakeSocket implements CfWebSocket {
  sent: string[] = [];
  constructor(private attachment: Member) {}
  send(data: string | ArrayBuffer) {
    if (typeof data === 'string') this.sent.push(data);
  }
  close() {}
  serializeAttachment(v: unknown) {
    this.attachment = v as Member;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  last(type: string): Record<string, unknown> | undefined {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>).filter((m) => m.type === type).at(-1);
  }
}

/** Le stockage d'un Durable Object, gardé en mémoire d'un « redémarrage » à l'autre. */
function fakeStorage() {
  const data = new Map<string, unknown>();
  return {
    data,
    list: async <T>({ prefix }: { prefix: string }) => new Map([...data].filter(([k]) => k.startsWith(prefix)) as [string, T][]),
    get: async <T>(k: string) => data.get(k) as T | undefined,
    put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
    delete: async (k: string) => data.delete(k),
  };
}

/** Un « démarrage » de l'objet : ses connexions survivantes, et le moment où il a fini de relire son stockage. */
function boot(storage: ReturnType<typeof fakeStorage>, sockets: FakeSocket[]) {
  let ready: Promise<unknown> = Promise.resolve();
  const ctx: DurableObjectStateLike = {
    acceptWebSocket: () => undefined,
    getWebSockets: () => sockets,
    storage,
    blockConcurrencyWhile: (cb) => (ready = cb()) as never,
  };
  const room = new WorldRoom(ctx);
  return { room, ready: () => ready };
}

const workout = {
  name: 'Sweet spot',
  steps: [{ kind: 'steady', durationS: 1200, target: { kind: 'ftp', from: 0.9, to: 0.9 } }],
  messages: [],
};
const say = (room: WorldRoom, ws: FakeSocket, msg: object) => room.webSocketMessage(ws, JSON.stringify(msg));

describe('WorldRoom : les groupes survivent à un redémarrage', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('range les groupes, puis les retrouve avec leurs membres, leur créateur et leurs choix de route', async () => {
    const storage = fakeStorage();
    const lea = new FakeSocket({ slot: 1, userId: 'u1', name: 'Léa' });
    const tom = new FakeSocket({ slot: 2, userId: 'u2', name: 'Tom' });
    const first = boot(storage, [lea, tom]);
    await first.ready();
    // Les coureurs sont connus de la salle au démarrage (leurs connexions ont survécu) : on leur fait créer et rejoindre le groupe.
    say(first.room, lea, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 280, massKg: 78 });
    say(first.room, tom, { type: 'groupJoin', id: 'g1' });
    say(first.room, lea, { type: 'groupRoute', leg: 4, index: 2 });
    expect(storage.data.has(GROUP_PREFIX + 'g1')).toBe(true);
    expect(storage.data.get(GROUP_NEXT_KEY)).toBe(2);

    // Redémarrage : un nouvel objet, mêmes connexions (leurs pièces jointes), même stockage.
    const lea2 = new FakeSocket(lea.deserializeAttachment() as Member);
    const tom2 = new FakeSocket(tom.deserializeAttachment() as Member);
    const second = boot(storage, [lea2, tom2]);
    await second.ready();

    // Le groupe est là : qui est en ligne le liste, un nouvel arrivant le rejoint avec tout l'historique.
    say(second.room, tom2, { type: 'who' });
    expect((tom2.last('who') as { groups: { id: string; count: number }[] }).groups).toMatchObject([{ id: 'g1', count: 2 }]);
    // La liste des membres continue de vivre : le créateur choisit, l'autre reçoit.
    say(second.room, lea2, { type: 'groupRoute', leg: 9, index: 1 });
    expect(tom2.last('groupRoute')).toEqual({ type: 'groupRoute', leg: 9, index: 1 });
    // Un nouveau groupe ne reprend pas le numéro g1.
    say(second.room, tom2, { type: 'groupLeave' });
    say(second.room, tom2, { type: 'groupCreate', workout, courseId: 'rive', startInS: 60, ftpW: 250, massKg: 75 });
    expect((tom2.last('groupState') as { group: { id: string } }).group.id).toBe('g2');
  });

  it("une arrivée dans le groupe après le redémarrage rejoue tout : allure, choix déjà faits, créateur", async () => {
    const storage = fakeStorage();
    const lea = new FakeSocket({ slot: 1, userId: 'u1', name: 'Léa' });
    const first = boot(storage, [lea]);
    await first.ready();
    say(first.room, lea, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 280, massKg: 78 });
    say(first.room, lea, { type: 'groupRoute', leg: 4, index: 2 });

    const lea2 = new FakeSocket(lea.deserializeAttachment() as Member);
    const paul = new FakeSocket({ slot: 3, userId: 'u3', name: 'Paul' });
    const second = boot(storage, [lea2, paul]);
    await second.ready();
    say(second.room, paul, { type: 'groupJoin', id: 'g1' });
    expect(paul.last('groupState')).toMatchObject({ group: { id: 'g1', ftpW: 280, massKg: 78, leader: 1, routes: [[4, 2]] } });
  });

  it("retire du groupe ceux dont la connexion n'a pas survécu, et efface un groupe devenu vide", async () => {
    const storage = fakeStorage();
    const lea = new FakeSocket({ slot: 1, userId: 'u1', name: 'Léa' });
    const tom = new FakeSocket({ slot: 2, userId: 'u2', name: 'Tom' });
    const marc = new FakeSocket({ slot: 3, userId: 'u3', name: 'Marc' });
    const first = boot(storage, [lea, tom, marc]);
    await first.ready();
    say(first.room, lea, { type: 'groupCreate', workout, courseId: 'col', startInS: 300, ftpW: 280, massKg: 78 });
    say(first.room, tom, { type: 'groupJoin', id: 'g1' });
    say(first.room, marc, { type: 'groupCreate', workout, courseId: 'rive', startInS: 300, ftpW: 250, massKg: 75 });
    expect([...storage.data.keys()].filter((k) => k.startsWith(GROUP_PREFIX)).sort()).toEqual([GROUP_PREFIX + 'g1', GROUP_PREFIX + 'g2']);

    // Au redémarrage, seul Tom est encore connecté.
    const tom2 = new FakeSocket(tom.deserializeAttachment() as Member);
    const second = boot(storage, [tom2]);
    await second.ready();
    say(second.room, tom2, { type: 'who' });
    expect((tom2.last('who') as { groups: { id: string; count: number }[] }).groups).toMatchObject([{ id: 'g1', count: 1 }]);
    expect(storage.data.has(GROUP_PREFIX + 'g2')).toBe(false); // le groupe de Marc n'a plus personne
    expect((storage.data.get(GROUP_PREFIX + 'g1') as { members: unknown[] }).members).toEqual([[2, 'Tom']]);
  });

  it("démarre à vide sans rien de rangé", async () => {
    const storage = fakeStorage();
    const lea = new FakeSocket({ slot: 1, userId: 'u1', name: 'Léa' });
    const { room, ready } = boot(storage, [lea]);
    await ready();
    say(room, lea, { type: 'who' });
    expect((lea.last('who') as { groups: unknown[] }).groups).toEqual([]);
  });

  it("range la liste d'amis de chaque coureur et la retrouve après un redémarrage ; celle d'un coureur parti est effacée", async () => {
    const storage = fakeStorage();
    const lea = new FakeSocket({ slot: 1, userId: 'u1', name: 'Léa' });
    const tom = new FakeSocket({ slot: 2, userId: 'u2', name: 'Tom' });
    const first = boot(storage, [lea, tom]);
    await first.ready();
    say(first.room, lea, { type: 'friends', ids: ['u2'] });
    say(first.room, tom, { type: 'friends', ids: ['u1', 'u9'] });
    expect(storage.data.get(FRIENDS_PREFIX + 'u1')).toEqual(['u2']);
    expect(storage.data.get(FRIENDS_PREFIX + 'u2')).toEqual(['u1', 'u9']);

    // Redémarrage : Léa est encore connectée, Tom non.
    const lea2 = new FakeSocket(lea.deserializeAttachment() as Member);
    const paul = new FakeSocket({ slot: 3, userId: 'u3', name: 'Paul' });
    const second = boot(storage, [lea2, paul]);
    await second.ready();
    expect(storage.data.has(FRIENDS_PREFIX + 'u2')).toBe(false); // celle de Tom n'a plus personne
    // La liste de Léa a été reprise : Paul est ami de personne, Léa a Tom (parti) ; elle voit Paul sans le marquer.
    say(second.room, paul, { type: 'who' });
    say(second.room, lea2, { type: 'who' });
    expect((lea2.last('who') as { riders: { name: string; friend: boolean }[] }).riders).toEqual([expect.objectContaining({ name: 'Paul', friend: false })]);
    // Et son « mes amis » marche : elle a ajouté u3 ? non, elle n'a que u2. Elle ajoute Paul : il est marqué sans nouveau redémarrage.
    say(second.room, lea2, { type: 'friends', ids: ['u3'] });
    expect(storage.data.get(FRIENDS_PREFIX + 'u1')).toEqual(['u3']);
  });
});
