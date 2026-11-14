import type { Tokens } from '../src/export/strava/api.ts';
import type { TokenStore } from '../src/export/strava/relay.ts';
import type { D1Database } from './d1-store.ts';

/** Jetons Strava dans D1 : une ligne, écrasée à chaque rafraîchissement (un jeton de rafraîchissement perdu obligerait à se reconnecter). */
export function createD1TokenStore(db: D1Database): TokenStore {
  return {
    async load() {
      const { results } = await db.prepare('SELECT body FROM strava_tokens WHERE id = ?').bind(1).all<{ body: string }>();
      return results[0] ? (JSON.parse(results[0].body) as Tokens) : undefined;
    },
    async save(tokens) {
      if (!tokens) await db.prepare('DELETE FROM strava_tokens WHERE id = ?').bind(1).run();
      else
        await db
          .prepare('INSERT INTO strava_tokens (id, body) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body')
          .bind(JSON.stringify(tokens))
          .run();
    },
  };
}
