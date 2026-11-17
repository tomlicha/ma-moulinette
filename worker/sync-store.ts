import type { SyncRow, SyncStore } from '../src/server/sync.ts';
import type { SyncKind } from '../src/sync/protocol.ts';
import type { D1Database } from './d1-store.ts';

interface Row {
  kind: string;
  id: string;
  body: string | null;
  updated_at: number;
  rev: number;
}

const toRow = (r: Row): SyncRow => ({
  kind: r.kind as SyncKind,
  id: r.id,
  body: r.body === null ? null : (JSON.parse(r.body) as unknown),
  updatedAt: r.updated_at,
  rev: r.rev,
});

/**
 * Données synchronisées dans D1 (migration 0004). L'écriture tient en une instruction : la révision suivante du compte
 * est calculée dans la même instruction que l'écriture, ce qui la garde unique même avec deux appareils en même temps.
 */
export function createD1SyncStore(db: D1Database): SyncStore {
  const all = async <T>(sql: string, ...values: unknown[]) => (await db.prepare(sql).bind(...values).all<T>()).results;
  return {
    async put(userId, item) {
      await db
        .prepare(
          `INSERT INTO user_items (user_id, kind, id, body, updated_at, rev)
           SELECT ?1, ?2, ?3, ?4, ?5, COALESCE(MAX(rev), 0) + 1 FROM user_items WHERE user_id = ?1
           ON CONFLICT (user_id, kind, id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, rev = excluded.rev
           WHERE excluded.updated_at > user_items.updated_at`,
        )
        .bind(userId, item.kind, item.id, item.body === null ? null : JSON.stringify(item.body), item.updatedAt)
        .run();
    },
    async changes(userId, since, limit) {
      const rows = await all<Row>(
        'SELECT kind, id, body, updated_at, rev FROM user_items WHERE user_id = ? AND rev > ? ORDER BY rev LIMIT ?',
        userId,
        since,
        limit,
      );
      return rows.map(toRow);
    },
    async get(userId, kind, id) {
      const [r] = await all<Row>('SELECT kind, id, body, updated_at, rev FROM user_items WHERE user_id = ? AND kind = ? AND id = ?', userId, kind, id);
      return r && toRow(r);
    },
    async maxRev(userId) {
      const [r] = await all<{ rev: number | null }>('SELECT MAX(rev) AS rev FROM user_items WHERE user_id = ?', userId);
      return r?.rev ?? 0;
    },
    async countLive(userId) {
      const [r] = await all<{ n: number }>('SELECT COUNT(*) AS n FROM user_items WHERE user_id = ? AND body IS NOT NULL', userId);
      return r?.n ?? 0;
    },
  };
}
