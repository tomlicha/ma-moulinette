import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createMemorySyncStore } from '../src/server/memory-store.ts';
import type { SyncStore } from '../src/server/sync.ts';
import type { D1Database } from './d1-store.ts';
import { createD1SyncStore } from './sync-store.ts';

/** D1 simulé avec le SQLite intégré à Node : exécute les vraies migrations et le vrai SQL du magasin. */
function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const m of ['0003_accounts.sql', '0004_user_items.sql']) db.exec(readFileSync(new URL(`./migrations/${m}`, import.meta.url), 'utf8'));
  db.exec("INSERT INTO users (id, display_name, name_confirmed, created_at) VALUES ('u1', 'Tom', 1, 0), ('u2', 'Léa', 1, 0)");
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        run: async () => db.prepare(sql).run(...(values as never[])),
        all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
      }),
    }),
  };
}

const ftp = (body: number | null, updatedAt: number) => ({ kind: 'setting' as const, id: 'ftp', body, updatedAt });

for (const [name, make] of [
  ['D1', () => createD1SyncStore(fakeD1())],
  ['mémoire', createMemorySyncStore],
] as [string, () => SyncStore][]) {
  describe(`magasin de synchronisation (${name})`, () => {
    it('numérote les écritures par compte et garde la plus récente', async () => {
      const s = make();
      expect(await s.maxRev('u1')).toBe(0);
      await s.put('u1', ftp(230, 1000));
      await s.put('u1', { kind: 'workout', id: 'w1', body: { name: 'A', blocks: [] }, updatedAt: 1000 });
      await s.put('u2', ftp(180, 1000));
      expect(await s.maxRev('u1')).toBe(2);
      expect(await s.maxRev('u2')).toBe(1);

      await s.put('u1', ftp(200, 900)); // plus ancienne : ignorée
      await s.put('u1', ftp(200, 1000)); // même instant : ignorée
      expect(await s.get('u1', 'setting', 'ftp')).toEqual({ ...ftp(230, 1000), rev: 1 });
      await s.put('u1', ftp(240, 2000));
      expect(await s.get('u1', 'setting', 'ftp')).toEqual({ ...ftp(240, 2000), rev: 3 });

      expect((await s.changes('u1', 0, 10)).map((r) => [r.id, r.rev])).toEqual([
        ['w1', 2],
        ['ftp', 3],
      ]);
      expect((await s.changes('u1', 2, 10)).map((r) => r.id)).toEqual(['ftp']);
      expect(await s.changes('u1', 0, 1)).toHaveLength(1);
    });

    it('garde les suppressions, sans les compter', async () => {
      const s = make();
      await s.put('u1', { kind: 'block', id: 'b1', body: { name: 'B', blocks: [{ type: 'steady' }] }, updatedAt: 1 });
      await s.put('u1', { kind: 'block', id: 'b2', body: { name: 'C', blocks: [{ type: 'steady' }] }, updatedAt: 1 });
      expect(await s.countLive('u1')).toBe(2);
      await s.put('u1', { kind: 'block', id: 'b1', body: null, updatedAt: 2 });
      expect(await s.countLive('u1')).toBe(1);
      expect(await s.get('u1', 'block', 'b1')).toEqual({ kind: 'block', id: 'b1', body: null, updatedAt: 2, rev: 3 });
    });
  });
}
