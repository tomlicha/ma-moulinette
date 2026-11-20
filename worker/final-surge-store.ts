import type { FinalSurgeStore } from '../src/server/final-surge.ts';
import type { D1Database } from './d1-store.ts';

export function createD1FinalSurgeStore(db: D1Database): FinalSurgeStore {
  return {
    async load(userId) {
      const { results } = await db.prepare('SELECT encrypted_credentials FROM user_final_surge WHERE user_id = ?').bind(userId).all<{ encrypted_credentials: string }>();
      return results[0]?.encrypted_credentials;
    },
    async save(userId, encrypted) {
      await db.prepare('INSERT INTO user_final_surge (user_id, encrypted_credentials, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted_credentials = excluded.encrypted_credentials, updated_at = excluded.updated_at')
        .bind(userId, encrypted, Date.now()).run();
    },
    async remove(userId) {
      await db.prepare('DELETE FROM user_final_surge WHERE user_id = ?').bind(userId).run();
    },
  };
}
