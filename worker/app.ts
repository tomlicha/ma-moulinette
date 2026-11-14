/**
 * Worker de l'application (Cloudflare) : sert le site statique et, devant lui, la passerelle Strava.
 * Seules les adresses /api/* passent par ce code (`run_worker_first` de wrangler.app.toml) ; le reste est servi par les ressources.
 * Secrets à créer avec `npx wrangler secret put -c wrangler.app.toml` : STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, OWNER_KEY.
 */
import { createStravaRelay } from '../src/export/strava/relay.ts';
import type { D1Database } from './d1-store.ts';
import { createD1TokenStore } from './token-store.ts';

interface Env {
  DB: D1Database;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  /** Sans clé, la passerelle refuse tout : un site public ne doit jamais écrire sur le compte du propriétaire sans elle. */
  OWNER_KEY?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const relay = createStravaRelay({
      clientId: env.STRAVA_CLIENT_ID,
      clientSecret: env.STRAVA_CLIENT_SECRET,
      ownerKey: env.OWNER_KEY || crypto.randomUUID(), // clé absente : impossible à deviner, donc tout reste verrouillé
      store: createD1TokenStore(env.DB),
    });
    return (await relay(req)) ?? new Response('not found', { status: 404 });
  },
};
