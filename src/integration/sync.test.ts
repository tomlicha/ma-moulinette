import { describe, expect, it } from 'vitest';
import { createAccounts, CSRF_HEADER } from '../server/accounts';
import { createMemoryAccountStore, createMemorySyncStore } from '../server/memory-store';
import { createSync } from '../server/sync';
import type { KeyValueStore } from '../shared/util/key-value-store';
import { BlockLibrary } from '../domain/workout/block-library';
import type { EditorBlock } from '../domain/workout/blocks';
import { WorkoutLibrary } from '../domain/workout/library';
import { migrateLegacyKeys } from '../infra/storage/legacy-storage';
import { createSyncClient, type SyncSource } from '../infra/sync/client';
import { SyncJournal } from '../infra/sync/journal';
import { blockSource, workoutSource } from '../infra/sync/sources';

const ORIGIN = 'https://moulinette.example';
const steady: EditorBlock[] = [{ type: 'steady', durationS: 300, power: 0.8 }];

class MemStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
  get length() {
    return this.data.size;
  }
  key = (i: number) => [...this.data.keys()][i] ?? null;
}

/** Un serveur : comptes (connexion de développement) et synchronisation, en mémoire. */
function server() {
  const accounts = createAccounts({ store: createMemoryAccountStore(), devLogin: true });
  const sync = createSync(accounts, createMemorySyncStore());
  let calls = 0;
  async function login(name: string) {
    const res = (await accounts.handle(
      new Request(`${ORIGIN}/api/auth/dev-login`, {
        method: 'POST',
        headers: { origin: ORIGIN, [CSRF_HEADER]: '1' },
        body: JSON.stringify({ name }),
      }),
    ))!;
    const body = (await res.json()) as { user: { id: string } };
    return { id: body.user.id, cookie: res.headers.getSetCookie()[0]!.split(';')[0]! };
  }
  /** `fetch` d'un appareil : même origine, avec son cookie de session. */
  const fetchFor = (session: () => string | undefined): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const headers = new Headers(init?.headers);
      headers.set('origin', ORIGIN);
      const cookie = session();
      if (cookie) headers.set('cookie', cookie);
      return (await sync(new Request(`${ORIGIN}${String(input)}`, { ...init, headers })))!;
    }) as typeof fetch;
  return { login, fetchFor, calls: () => calls };
}

/** Un appareil : son stockage, ses bibliothèques, sa FTP et son client de synchronisation. */
function device(srv: ReturnType<typeof server>, store = new MemStore()) {
  let cookie: string | undefined;
  const journal = new SyncJournal(store);
  const workouts = new WorkoutLibrary(store, undefined, journal);
  const blocks = new BlockLibrary(store, undefined, journal);
  const settings: SyncSource = {
    kind: 'setting',
    all: () => (store.getItem('ftp') === null ? [] : [{ kind: 'setting', id: 'ftp', body: Number(store.getItem('ftp')), updatedAt: journal.stamp('setting', 'ftp') ?? 0 }]),
    apply: (items) => {
      for (const i of items) if (i.id === 'ftp') store.setItem('ftp', String(i.body));
    },
    clear: () => store.removeItem('ftp'),
  };
  const changed: string[][] = [];
  const client = createSyncClient({
    journal,
    sources: [settings, workoutSource(workouts, (ids) => changed.push([...ids])), blockSource(blocks, () => {})],
    log: () => {},
    fetch: srv.fetchFor(() => cookie),
    debounceMs: 60_000,
  });
  return {
    store,
    journal,
    workouts,
    blocks,
    changed,
    client,
    setFtp(v: number, at: number) {
      store.setItem('ftp', String(v));
      journal.record('setting', 'ftp', v, at);
    },
    ftp: () => Number(store.getItem('ftp')),
    async signIn(user: { id: string; cookie: string }) {
      cookie = user.cookie;
      await client.setUser(user);
    },
    signOut() {
      cookie = undefined;
      void client.setUser(undefined);
    },
    names: () => workouts.list().map((w) => w.name),
  };
}

describe('synchronisation entre appareils', () => {
  it('les données d’avant le compte le rejoignent, puis suivent sur un autre appareil', async () => {
    const srv = server();
    const tom = await srv.login('Tom');
    const phone = device(srv);
    phone.setFtp(245, 1000);
    phone.workouts.save({ name: 'Seuil', blocks: steady }, 1000);
    phone.blocks.save('Mon bloc', steady, 1000);

    await phone.signIn(tom);
    const tablet = device(srv);
    await tablet.signIn(tom);

    expect(tablet.ftp()).toBe(245);
    expect(tablet.names()).toEqual(['Seuil']);
    expect(tablet.blocks.list().map((b) => b.name)).toEqual(['Mon bloc']);
    expect(tablet.journal.pending()).toEqual([]);
  });

  it('les deux appareils fusionnent leurs séances, et les suppressions passent', async () => {
    const srv = server();
    const tom = await srv.login('Tom');
    const a = device(srv);
    const b = device(srv);
    a.workouts.save({ name: 'A', blocks: steady }, 1000);
    b.workouts.save({ name: 'B', blocks: steady }, 1000);
    await a.signIn(tom);
    await b.signIn(tom);
    await a.client.now();
    expect(a.names().sort()).toEqual(['A', 'B']);
    expect(b.names().sort()).toEqual(['A', 'B']);

    const idA = a.workouts.list().find((w) => w.name === 'A')!.id;
    b.workouts.remove(idA, 2000);
    await b.client.now();
    await a.client.now();
    expect(a.names()).toEqual(['B']);
    expect(a.changed.at(-1)).toEqual([idA]);
  });

  it('modifications sur deux appareils : la plus récente gagne partout', async () => {
    const srv = server();
    const tom = await srv.login('Tom');
    const a = device(srv);
    const b = device(srv);
    await a.signIn(tom);
    await b.signIn(tom);
    a.setFtp(230, 5000);
    b.setFtp(250, 4000); // faite plus tôt, envoyée plus tard
    await a.client.now();
    await b.client.now();
    await a.client.now();
    expect([a.ftp(), b.ftp()]).toEqual([230, 230]);
    expect(b.journal.pending()).toEqual([]);
  });

  it('sans compte, les modifications attendent la prochaine connexion du même compte', async () => {
    const srv = server();
    const tom = await srv.login('Tom');
    const a = device(srv);
    await a.signIn(tom);
    a.signOut();
    a.setFtp(260, 2000);
    expect(a.journal.pending()).toHaveLength(1);
    await a.signIn(tom);
    const b = device(srv);
    await b.signIn(tom);
    expect(b.ftp()).toBe(260);
  });

  it('un autre compte sur l’appareil : ses données remplacent celles du précédent', async () => {
    const srv = server();
    const tom = await srv.login('Tom');
    const lea = await srv.login('Léa');
    const leaPhone = device(srv);
    leaPhone.setFtp(190, 1000);
    leaPhone.workouts.save({ name: 'Côtes', blocks: steady }, 1000);
    await leaPhone.signIn(lea);

    const shared = device(srv);
    shared.setFtp(280, 1000);
    shared.workouts.save({ name: 'Seuil de Tom', blocks: steady }, 1000);
    await shared.signIn(tom);
    shared.signOut();
    await shared.signIn(lea);
    expect(shared.ftp()).toBe(190);
    expect(shared.names()).toEqual(['Côtes']);
    // Et Tom retrouve les siennes en revenant.
    shared.signOut();
    await shared.signIn(tom);
    expect(shared.ftp()).toBe(280);
    expect(shared.names()).toEqual(['Seuil de Tom']);
  });

  it('une modification faite pendant un envoi reste à envoyer', async () => {
    const srv = server();
    const tom = await srv.login('Tom');
    const a = device(srv);
    await a.signIn(tom);
    a.setFtp(230, 1000);
    const flying = a.client.now();
    a.setFtp(240, 2000);
    await flying;
    await a.client.now();
    const b = device(srv);
    await b.signIn(tom);
    expect(b.ftp()).toBe(240);
  });

  it('reprend le journal entre deux lancements', async () => {
    const srv = server();
    const tom = await srv.login('Tom');
    const a = device(srv);
    await a.signIn(tom);
    a.workouts.save({ name: 'X', blocks: steady }, 1000);
    const relaunched = device(srv, a.store);
    expect(relaunched.journal.owner).toBe(tom.id);
    await relaunched.signIn(tom);
    expect(relaunched.journal.pending()).toEqual([]);
    const b = device(srv);
    await b.signIn(tom);
    expect(b.names()).toEqual(['X']);
  });

  it('sans compte, rien ne part sur le réseau', async () => {
    const srv = server();
    const a = device(srv);
    a.setFtp(230, 1000);
    await a.client.now();
    expect(srv.calls()).toBe(0);
  });
});

describe('anciennes clés du navigateur', () => {
  it('reprend les données `zwift2.*` sous `mamoulinette.*` sans écraser les nouvelles', () => {
    const s = new MemStore();
    s.setItem('zwift2.ftp', '240');
    s.setItem('zwift2.workouts', '[]');
    s.setItem('zwift2.mass', '70');
    s.setItem('mamoulinette.mass', '72');
    s.setItem('autre', 'x');
    expect(migrateLegacyKeys(s)).toBe(2);
    expect(Object.fromEntries(s.data)).toEqual({ 'mamoulinette.ftp': '240', 'mamoulinette.workouts': '[]', 'mamoulinette.mass': '72', autre: 'x' });
    expect(migrateLegacyKeys(s)).toBe(0);
  });
});
