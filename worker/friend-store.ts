import type { FriendStore } from '../src/server/friends.ts';
import type { D1Database } from './d1-store.ts';

/** Amis en D1 (migration 0006) : une ligne par ami, sans réciprocité. */
export function createD1FriendStore(db: D1Database): FriendStore {
  const all = async <T>(sql: string, ...values: unknown[]) => (await db.prepare(sql).bind(...values).all<T>()).results;
  return {
    async list(userId) {
      // Seuls les comptes dont le nom est validé sont montrés : un compte qui l'a depuis effacé ou changé n'apparaît pas sous un ancien nom.
      return all<{ id: string; name: string }>(
        `SELECT u.id AS id, u.display_name AS name FROM friends f JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = ? AND u.name_confirmed = 1 ORDER BY f.created_at, u.id`,
        userId,
      );
    },
    async describe(id) {
      const [u] = await all<{ id: string; name: string }>('SELECT id, display_name AS name FROM users WHERE id = ? AND name_confirmed = 1', id);
      return u;
    },
    async add(userId, friendId, now) {
      await db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').bind(userId, friendId, now).run();
    },
    async remove(userId, friendId) {
      await db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').bind(userId, friendId).run();
    },
  };
}
