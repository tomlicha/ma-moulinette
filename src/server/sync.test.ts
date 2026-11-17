import { describe, expect, it } from 'vitest';
import { createAccounts, CSRF_HEADER, SESSION_COOKIE } from './accounts';
import { createMemoryAccountStore, createMemorySyncStore } from './memory-store';
import { createSync } from './sync';
import { SYNC_LIMITS, type SyncItem, type SyncResponse } from '../sync/protocol';

const ORIGIN = 'https://moulinette.example';

async function setup() {
  const accounts = createAccounts({ store: createMemoryAccountStore(), devLogin: true });
  const sync = createSync(accounts, createMemorySyncStore());
  const login = async (name: string) => {
    const res = (await accounts.handle(
      new Request(`${ORIGIN}/api/auth/dev-login`, {
        method: 'POST',
        headers: { origin: ORIGIN, [CSRF_HEADER]: '1', 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    ))!;
    return res.headers.getSetCookie()[0]!.split(';')[0]!;
  };
  const call = async (cookie: string | undefined, body: unknown, headers: Record<string, string> = { [CSRF_HEADER]: '1' }) =>
    (await sync(
      new Request(`${ORIGIN}/api/sync`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
        body: JSON.stringify(body),
      }),
    ))!;
  const ok = async (cookie: string, since: number, changes: SyncItem[] = []) => {
    const res = await call(cookie, { since, changes });
    expect(res.status).toBe(200);
    return (await res.json()) as SyncResponse;
  };
  return { sync, login, call, ok };
}

const ftp = (body: number | null, updatedAt: number): SyncItem => ({ kind: 'setting', id: 'ftp', body, updatedAt });
const workout = (id: string, name: string, updatedAt: number): SyncItem => ({
  kind: 'workout',
  id,
  body: { name, blocks: [{ type: 'steady', durationS: 300, power: 0.8 }] },
  updatedAt,
});

describe('synchronisation des données du coureur', () => {
  it('garde les modifications et les rend aux autres appareils du même compte', async () => {
    const { login, ok } = await setup();
    const tom = await login('Tom');
    const first = await ok(tom, 0, [ftp(230, 1000), workout('w1', 'Sweet spot', 1000)]);
    expect(first.rev).toBe(2);
    // Autre appareil, jamais synchronisé : il reçoit tout.
    const other = await ok(tom, 0);
    expect(other.items).toEqual([ftp(230, 1000), workout('w1', 'Sweet spot', 1000)]);
    expect(other.rev).toBe(2);
    // À jour : rien de neuf.
    expect((await ok(tom, 2)).items).toEqual([]);
  });

  it('la modification la plus récente gagne, et la page apprend la version du serveur', async () => {
    const { login, ok } = await setup();
    const tom = await login('Tom');
    await ok(tom, 0, [ftp(250, 2000)]);
    // Modification plus ancienne (horloge d'un autre appareil) : refusée, le serveur rend la sienne.
    const stale = await ok(tom, 1, [ftp(220, 1500)]);
    expect(stale.items).toEqual([ftp(250, 2000)]);
    expect(stale.rev).toBe(1);
    const newer = await ok(tom, 1, [ftp(260, 3000)]);
    expect(newer.items).toEqual([ftp(260, 3000)]);
    expect(newer.rev).toBe(2);
  });

  it('transmet les suppressions', async () => {
    const { login, ok } = await setup();
    const tom = await login('Tom');
    await ok(tom, 0, [workout('w1', 'A', 1000)]);
    await ok(tom, 1, [{ kind: 'workout', id: 'w1', body: null, updatedAt: 2000 }]);
    expect((await ok(tom, 1)).items).toEqual([{ kind: 'workout', id: 'w1', body: null, updatedAt: 2000 }]);
  });

  it('sépare les comptes', async () => {
    const { login, ok } = await setup();
    const tom = await login('Tom');
    const lea = await login('Léa');
    await ok(tom, 0, [ftp(230, 1000)]);
    expect((await ok(lea, 0)).items).toEqual([]);
  });

  it('refuse sans compte, sans en-tête anti-CSRF ou depuis un autre site', async () => {
    const { login, call } = await setup();
    const tom = await login('Tom');
    expect((await call(undefined, { since: 0, changes: [] })).status).toBe(401);
    expect((await call(`${SESSION_COOKIE}=${'0'.repeat(64)}`, { since: 0, changes: [] })).status).toBe(401);
    expect((await call(tom, { since: 0, changes: [] }, {})).status).toBe(403);
    expect((await call(tom, { since: 0, changes: [] }, { [CSRF_HEADER]: '1', origin: 'https://evil.example' })).status).toBe(403);
  });

  it('accepte encore l’ancien en-tête anti-CSRF (page de la version précédente)', async () => {
    const { login, call } = await setup();
    const tom = await login('Tom');
    expect((await call(tom, { since: 0, changes: [] }, { 'x-zwift2': '1' })).status).toBe(200);
  });

  it('écarte les éléments invalides sans bloquer les autres', async () => {
    const { login, ok, call } = await setup();
    const tom = await login('Tom');
    const res = await ok(tom, 0, [
      ftp(9999, 1000),
      { kind: 'setting', id: 'couleur', body: 3, updatedAt: 1000 },
      { kind: 'workout', id: 'w1', body: { name: '', blocks: [] }, updatedAt: 1000 },
      { kind: 'block', id: 'b1', body: { name: 'Vide', blocks: [] }, updatedAt: 1000 },
      { kind: 'workout', id: '../x', body: null, updatedAt: 1000 },
      workout('w2', 'Bonne', 1000),
    ] as SyncItem[]);
    expect(res.rejected).toEqual(['setting/ftp', 'setting/couleur', 'workout/w1', 'block/b1', 'workout/../x']);
    expect(res.items).toEqual([workout('w2', 'Bonne', 1000)]);
    expect((await call(tom, { since: -1, changes: [] })).status).toBe(400);
    expect((await call(tom, { since: 0, changes: 'x' })).status).toBe(400);
    expect((await call(tom, { since: 0, changes: Array(SYNC_LIMITS.changesPerRequest + 1).fill(ftp(200, 1)) })).status).toBe(400);
  });

  it('rend les gros comptes par pages', async () => {
    const { login, ok } = await setup();
    const tom = await login('Tom');
    for (let i = 0; i < 3; i++) {
      await ok(tom, 0, Array.from({ length: 100 }, (_, j) => workout(`w${i}-${j}`, 'S', 1000)));
    }
    const p1 = await ok(tom, 0);
    expect(p1.items).toHaveLength(SYNC_LIMITS.itemsPerPage);
    expect(p1.more).toBe(true);
    const p2 = await ok(tom, p1.rev);
    expect(p2.items).toHaveLength(100);
    expect(p2.more).toBe(false);
    expect(p2.rev).toBe(300);
  });

  it('repart de zéro quand la révision demandée est inconnue du serveur', async () => {
    const { login, ok } = await setup();
    const tom = await login('Tom');
    await ok(tom, 0, [ftp(230, 1000)]);
    expect((await ok(tom, 999)).items).toEqual([ftp(230, 1000)]);
  });
});
