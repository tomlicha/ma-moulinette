import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { StoredReport } from '../src/infra/telemetry/report.ts';
import { createD1DeviceStore, createD1Store, type D1Database } from './d1-store.ts';

/** D1 simulé avec le SQLite intégré à Node : exécute la vraie migration et le vrai SQL du magasin. */
function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  for (const m of ['0001_init', '0005_trainers']) db.exec(readFileSync(new URL(`./migrations/${m}.sql`, import.meta.url), 'utf8'));
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        run: async () => db.prepare(sql).run(...(values as never[])),
        all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
      }),
    }),
  };
}

const row = (receivedAt: number, session = 's'): StoredReport => ({
  session,
  reason: 'error',
  context: { trainer: 'KICKR' },
  entries: [{ n: 1, t: 1, level: 'error', msg: 'échec' }],
  receivedAt,
});

describe('magasin D1', () => {
  it('relit les rapports du plus ancien au plus récent, limités aux plus récents', async () => {
    const store = createD1Store(fakeD1());
    expect(await store.read({ limit: 10 })).toEqual([]);
    for (const t of [10, 20, 30, 40]) await store.append(row(t));
    expect((await store.read({ limit: 10 })).map((r) => r.receivedAt)).toEqual([10, 20, 30, 40]);
    expect((await store.read({ limit: 2 })).map((r) => r.receivedAt)).toEqual([30, 40]);
    expect((await store.read({ since: 20, limit: 10 })).map((r) => r.receivedAt)).toEqual([30, 40]);
  });

  it('rend le rapport tel qu’il a été déposé', async () => {
    const store = createD1Store(fakeD1());
    await store.append(row(5, 'abc'));
    expect(await store.read({ limit: 1 })).toEqual([row(5, 'abc')]);
  });

  it('purge les rapports plus vieux que la date donnée', async () => {
    const store = createD1Store(fakeD1());
    for (const t of [10, 20, 30]) await store.append(row(t));
    await store.purge(25);
    expect((await store.read({ limit: 10 })).map((r) => r.receivedAt)).toEqual([30]);
  });
});

describe('fiches trainer D1', () => {
  const kickr = { profile: 'wahoo-kickr', brand: 'wahoo', model: 'KICKR CORE', firmware: '1.5.36', protocol: 'wahoo', services: ['a'] };

  it('une ligne par installation : créée, inchangée, remplacée', async () => {
    const db = fakeD1();
    const devices = createD1DeviceStore(db);
    expect(await devices.upsert({ install: 'i', trainer: kickr }, 10)).toEqual({ created: true, changed: false });
    expect(await devices.upsert({ install: 'i', trainer: { ...kickr, services: ['a'] } }, 20)).toEqual({ created: false, changed: false });
    expect(await devices.upsert({ install: 'i', trainer: { ...kickr, firmware: '2.0' } }, 30)).toEqual({ created: false, changed: true });
    await devices.upsert({ install: 'j', trainer: { profile: 'tacx-neo', services: [] } }, 40);
    const all = await devices.list({ limit: 10 });
    expect(all.map((d) => d.install)).toEqual(['j', 'i']);
    expect(all[1]).toMatchObject({ firstSeen: 10, updatedAt: 30, changes: 1, trainer: { firmware: '2.0' } });
  });

  it('survit à la purge des journaux', async () => {
    const db = fakeD1();
    await createD1DeviceStore(db).upsert({ install: 'i', trainer: kickr }, 1);
    await createD1Store(db).purge(1e12);
    expect(await createD1DeviceStore(db).list({ limit: 10 })).toHaveLength(1);
  });
});
