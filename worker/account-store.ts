import type { Tokens } from '../src/export/strava/api.ts';
import type { AccountStore, Provider, User } from '../src/server/accounts.ts';
import type { D1Database } from './d1-store.ts';

interface UserRow {
  id: string;
  display_name: string;
  name_confirmed: number;
}

const toUser = (r: UserRow): User => ({ id: r.id, displayName: r.display_name, nameConfirmed: !!r.name_confirmed });

/** Comptes dans D1 (migration 0003). */
export function createD1AccountStore(db: D1Database): AccountStore & { purgeSessions(now: number): Promise<void> } {
  const first = async <T>(sql: string, ...values: unknown[]) => (await db.prepare(sql).bind(...values).all<T>()).results[0];
  return {
    async userByIdentity(provider: Provider, subject: string) {
      const r = await first<UserRow>(
        'SELECT u.id, u.display_name, u.name_confirmed FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?',
        provider,
        subject,
      );
      return r && toUser(r);
    },
    async createUser(provider, subject, displayName, nameConfirmed) {
      const id = crypto.randomUUID();
      await db
        .prepare('INSERT INTO users (id, display_name, name_confirmed, created_at) VALUES (?, ?, ?, ?)')
        .bind(id, displayName, nameConfirmed ? 1 : 0, Date.now())
        .run();
      await db.prepare('INSERT INTO identities (provider, subject, user_id) VALUES (?, ?, ?)').bind(provider, subject, id).run();
      return { id, displayName, nameConfirmed };
    },
    async setDisplayName(userId, displayName) {
      await db.prepare('UPDATE users SET display_name = ?, name_confirmed = 1 WHERE id = ?').bind(displayName, userId).run();
    },
    async createSession(tokenHash, userId, expiresAt) {
      await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(tokenHash, userId, expiresAt).run();
    },
    async userBySession(tokenHash, now) {
      const r = await first<UserRow>(
        'SELECT u.id, u.display_name, u.name_confirmed FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
        tokenHash,
        now,
      );
      return r && toUser(r);
    },
    async deleteSession(tokenHash) {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    },
    async saveStravaTokens(userId, tokens: Tokens | undefined) {
      if (!tokens) await db.prepare('DELETE FROM user_strava_tokens WHERE user_id = ?').bind(userId).run();
      else
        await db
          .prepare('INSERT INTO user_strava_tokens (user_id, body) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET body = excluded.body')
          .bind(userId, JSON.stringify(tokens))
          .run();
    },
    async loadStravaTokens(userId) {
      const r = await first<{ body: string }>('SELECT body FROM user_strava_tokens WHERE user_id = ?', userId);
      return r ? (JSON.parse(r.body) as Tokens) : undefined;
    },
    async purgeSessions(now) {
      await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run();
    },
  };
}
