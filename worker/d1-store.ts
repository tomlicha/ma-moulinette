import { fingerprint, type StoredDevice } from '../src/telemetry/device.ts';
import type { DeviceStore, LogStore } from '../src/telemetry/receiver.ts';
import type { StoredReport } from '../src/telemetry/report.ts';

/** Ce que ce module utilise de D1 : de quoi le simuler dans les tests sans dépendre des types de Cloudflare. */
export interface D1Database {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
}

export const RETENTION_MS = 30 * 24 * 3600 * 1000;

export function createD1Store(db: D1Database): LogStore & { purge(olderThan: number): Promise<void> } {
  return {
    async append(r: StoredReport) {
      await db
        .prepare('INSERT INTO reports (received_at, session, body) VALUES (?, ?, ?)')
        .bind(r.receivedAt, r.session, JSON.stringify(r))
        .run();
    },
    async read({ since = 0, limit }) {
      // Les `limit` plus récents, rendus du plus ancien au plus récent comme le stockage en fichier.
      const { results } = await db
        .prepare('SELECT body FROM reports WHERE received_at > ? ORDER BY received_at DESC, id DESC LIMIT ?')
        .bind(since, limit)
        .all<{ body: string }>();
      return results.map((row) => JSON.parse(row.body) as StoredReport).reverse();
    },
    async purge(olderThan) {
      await db.prepare('DELETE FROM reports WHERE received_at < ?').bind(olderThan).run();
    },
  };
}

/** Fiches trainer en D1 (migration 0005) : une ligne par installation, remplacée quand le trainer change. */
export function createD1DeviceStore(db: D1Database): DeviceStore {
  return {
    async upsert(report, now) {
      const print = fingerprint(report.trainer);
      const t = report.trainer;
      const { results } = await db
        .prepare('SELECT fingerprint FROM trainers WHERE install = ?')
        .bind(report.install)
        .all<{ fingerprint: string }>();
      const known = results[0];
      if (known?.fingerprint === print) return { created: false, changed: false };
      const body = JSON.stringify({ install: report.install, trainer: t, userAgent: report.userAgent });
      if (!known) {
        await db
          .prepare(
            'INSERT INTO trainers (install, first_seen, updated_at, changes, fingerprint, profile, brand, manufacturer, model, firmware, protocol, body) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(report.install, now, now, print, t.profile, t.brand ?? null, t.manufacturer ?? null, t.model ?? null, t.firmware ?? null, t.protocol ?? null, body)
          .run();
        return { created: true, changed: false };
      }
      await db
        .prepare(
          'UPDATE trainers SET updated_at = ?, changes = changes + 1, fingerprint = ?, profile = ?, brand = ?, manufacturer = ?, model = ?, firmware = ?, protocol = ?, body = ? WHERE install = ?',
        )
        .bind(now, print, t.profile, t.brand ?? null, t.manufacturer ?? null, t.model ?? null, t.firmware ?? null, t.protocol ?? null, body, report.install)
        .run();
      return { created: false, changed: true };
    },
    async list({ limit }) {
      const { results } = await db
        .prepare('SELECT body, first_seen, updated_at, changes FROM trainers ORDER BY updated_at DESC LIMIT ?')
        .bind(limit)
        .all<{ body: string; first_seen: number; updated_at: number; changes: number }>();
      return results.map(
        (r): StoredDevice => ({ ...JSON.parse(r.body), firstSeen: r.first_seen, updatedAt: r.updated_at, changes: r.changes }),
      );
    },
  };
}
