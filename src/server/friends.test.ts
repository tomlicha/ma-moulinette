import { describe, expect, it } from 'vitest';
import { MAX_FRIENDS } from '../shared/protocol/friends';
import { createAccounts, CSRF_HEADER } from './accounts';
import { createFriends } from './friends';
import { createMemoryAccountStore, createMemoryFriendStore } from './memory-store';

const ORIGIN = 'https://moulinette.example';

async function setup() {
  const store = createMemoryAccountStore();
  const accounts = createAccounts({ store, devLogin: true });
  let t = 1000;
  const friends = createFriends(accounts, createMemoryFriendStore(store), () => t++);
  /** Un compte de plus, avec son nom validé (ou non) : sa session, et son identifiant. */
  const login = async (name: string, confirmed = true) => {
    const res = (await accounts.handle(
      new Request(`${ORIGIN}/api/auth/dev-login`, {
        method: 'POST',
        headers: { origin: ORIGIN, [CSRF_HEADER]: '1', 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    ))!;
    const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!;
    const user = [...store.users.values()].find((u) => u.displayName === name)!;
    store.users.set(user.id, { ...user, nameConfirmed: confirmed });
    return { cookie, id: user.id };
  };
  const call = async (cookie: string | undefined, method: 'GET' | 'POST', body?: unknown, headers: Record<string, string> = { [CSRF_HEADER]: '1' }) =>
    (await friends(
      new Request(`${ORIGIN}/api/friends`, {
        method,
        headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(method === 'POST' ? headers : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    ))!;
  const list = async (cookie: string) => ((await (await call(cookie, 'GET')).json()) as { friends: { id: string; name: string }[] }).friends;
  return { login, call, list, friends, store };
}

describe('amis', () => {
  it("ne répond que sur son adresse", async () => {
    const { friends } = await setup();
    expect(await friends(new Request(`${ORIGIN}/api/sync`))).toBeUndefined();
  });

  it("une liste vide au départ, et il faut être connecté", async () => {
    const { login, call, list } = await setup();
    const tom = await login('Tom');
    expect(await list(tom.cookie)).toEqual([]);
    expect((await call(undefined, 'GET')).status).toBe(401);
    expect((await call(undefined, 'POST', { add: 'u1' })).status).toBe(401);
  });

  it("ajoute un ami sans réciprocité : l'autre ne l'a pas dans sa liste", async () => {
    const { login, call, list } = await setup();
    const tom = await login('Tom');
    const lea = await login('Léa');
    const res = await call(tom.cookie, 'POST', { add: lea.id });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { friends: unknown[] }).friends).toEqual([{ id: lea.id, name: 'Léa' }]);
    expect(await list(tom.cookie)).toEqual([{ id: lea.id, name: 'Léa' }]);
    expect(await list(lea.cookie)).toEqual([]);
  });

  it("ajouter deux fois ne change rien ; retirer le retire ; retirer un inconnu est sans effet", async () => {
    const { login, call, list } = await setup();
    const tom = await login('Tom');
    const lea = await login('Léa');
    await call(tom.cookie, 'POST', { add: lea.id });
    await call(tom.cookie, 'POST', { add: lea.id });
    expect(await list(tom.cookie)).toHaveLength(1);
    expect((await call(tom.cookie, 'POST', { remove: 'inconnu' })).status).toBe(200);
    await call(tom.cookie, 'POST', { remove: lea.id });
    expect(await list(tom.cookie)).toEqual([]);
  });

  it("garde l'ordre d'ajout", async () => {
    const { login, call, list } = await setup();
    const tom = await login('Tom');
    const lea = await login('Léa');
    const zoe = await login('Zoé');
    await call(tom.cookie, 'POST', { add: zoe.id });
    await call(tom.cookie, 'POST', { add: lea.id });
    expect((await list(tom.cookie)).map((f) => f.name)).toEqual(['Zoé', 'Léa']);
  });

  it("refuse de s'ajouter soi-même, un compte inconnu ou au nom pas validé, et une demande absurde", async () => {
    const { login, call } = await setup();
    const tom = await login('Tom');
    const pending = await login('Nouveau', false);
    expect((await call(tom.cookie, 'POST', { add: tom.id })).status).toBe(400);
    expect((await call(tom.cookie, 'POST', { add: 'inconnu' })).status).toBe(404);
    expect((await call(tom.cookie, 'POST', { add: pending.id })).status).toBe(404);
    expect((await call(tom.cookie, 'POST', { add: 'x'.repeat(50) })).status).toBe(400);
    expect((await call(tom.cookie, 'POST', { add: 12 })).status).toBe(400);
    expect((await call(tom.cookie, 'POST', {})).status).toBe(400);
  });

  it(`pas plus de ${MAX_FRIENDS} amis`, async () => {
    const { login, call, store } = await setup();
    const tom = await login('Tom');
    for (let i = 0; i < MAX_FRIENDS; i++) {
      const id = `f${i}`;
      store.users.set(id, { id, displayName: `Ami ${i}`, nameConfirmed: true });
      expect((await call(tom.cookie, 'POST', { add: id })).status).toBe(200);
    }
    store.users.set('de-trop', { id: 'de-trop', displayName: 'De trop', nameConfirmed: true });
    const res = await call(tom.cookie, 'POST', { add: 'de-trop' });
    expect(res.status).toBe(409);
    // un ami déjà ajouté reste acceptable (sans effet)
    expect((await call(tom.cookie, 'POST', { add: 'f0' })).status).toBe(200);
  });

  it("une modification exige l'en-tête anti-CSRF et la même origine ; une lecture non", async () => {
    const { login, call, friends } = await setup();
    const tom = await login('Tom');
    expect((await call(tom.cookie, 'POST', { add: 'x' }, {})).status).toBe(403);
    const other = (await friends(
      new Request(`${ORIGIN}/api/friends`, { method: 'POST', headers: { origin: 'https://autre.example', [CSRF_HEADER]: '1', cookie: tom.cookie }, body: '{}' }),
    ))!;
    expect(other.status).toBe(403);
    expect((await call(tom.cookie, 'GET')).status).toBe(200);
  });

  it("un ami dont le nom n'est plus validé n'est plus montré sous un ancien nom", async () => {
    const { login, call, list, store } = await setup();
    const tom = await login('Tom');
    const lea = await login('Léa');
    await call(tom.cookie, 'POST', { add: lea.id });
    store.users.set(lea.id, { ...store.users.get(lea.id)!, nameConfirmed: false });
    expect(await list(tom.cookie)).toEqual([]);
  });

  it("refuse les autres méthodes", async () => {
    const { friends, login } = await setup();
    const tom = await login('Tom');
    const res = (await friends(new Request(`${ORIGIN}/api/friends`, { method: 'DELETE', headers: { cookie: tom.cookie } })))!;
    expect(res.status).toBe(405);
  });
});
