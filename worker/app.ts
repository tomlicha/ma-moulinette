/**
 * Worker de l'application (Cloudflare) : sert le site statique et, devant lui, les adresses /api/* :
 * comptes (connexion Strava), données du coureur synchronisées entre ses appareils, salle temps réel (Durable Object)
 * et envoi des sorties sur le compte Strava de chacun.
 * Seules les adresses /api/* passent par ce code (`run_worker_first` de wrangler.app.toml) ; le reste est servi par les ressources.
 * Secrets à créer avec `npx wrangler secret put -c wrangler.app.toml` : STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.
 */
import { networkSignature, PROTOCOL_VERSION } from '../src/infra/net/protocol.ts';
import { createAccounts } from '../src/server/accounts.ts';
import { createFriends } from '../src/server/friends.ts';
import { createSync } from '../src/server/sync.ts';
import { createUserStrava } from '../src/server/user-strava.ts';
import { CLOSE_NAME_PENDING, CLOSE_OUTDATED, CLOSE_SIGNED_OUT } from '../src/server/room.ts';
import { COL_DES_ERABLES } from '../src/domain/course/courses/col-des-erables.ts';
import { WORLD_PATH } from '../src/infra/net/world-client.ts';
import { createD1AccountStore } from './account-store.ts';
import { createD1FriendStore } from './friend-store.ts';
import { createD1SyncStore } from './sync-store.ts';
import type { D1Database } from './d1-store.ts';
import type { CfWebSocket } from './world-room.ts';

export { WorldRoom } from './world-room.ts';

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(req: Request): Promise<Response> };
}

interface Env {
  DB: D1Database;
  WORLD: DurableObjectNamespaceLike;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  /** Origine publique, quand elle diffère de celle des requêtes (serveur de dev Vite devant `wrangler dev`). */
  PUBLIC_ORIGIN?: string;
  /** « 1 » : connexion par simple nom, sans Strava. Seulement dans `.dev.vars`, jamais en ligne. */
  DEV_LOGIN?: string;
}

const SIGNATURE = networkSignature(COL_DES_ERABLES);

declare const WebSocketPair: { new (): { 0: CfWebSocket; 1: CfWebSocket & { accept(): void } } };

/** Accepte la connexion pour la refermer aussitôt avec un code lisible : un navigateur ne voit pas le statut HTTP d'un refus. */
function refuse(code: number, reason: string): Response {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].close(code, reason);
  return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const accounts = createAccounts({
      store: createD1AccountStore(env.DB),
      clientId: env.STRAVA_CLIENT_ID,
      clientSecret: env.STRAVA_CLIENT_SECRET,
      publicOrigin: env.PUBLIC_ORIGIN || undefined,
      devLogin: env.DEV_LOGIN === '1',
    });

    if (url.pathname === WORLD_PATH) {
      if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('websocket attendu', { status: 426 });
      if (!accounts.sameOrigin(req)) return new Response('origine refusée', { status: 403 });
      if (url.searchParams.get('v') !== String(PROTOCOL_VERSION) || url.searchParams.get('sig') !== String(SIGNATURE)) {
        return refuse(CLOSE_OUTDATED, 'version');
      }
      const user = await accounts.resolveUser(req);
      if (!user) return refuse(CLOSE_SIGNED_OUT, 'connexion requise');
      if (!user.nameConfirmed) return refuse(CLOSE_NAME_PENDING, 'nom à valider');
      const headers = new Headers(req.headers);
      headers.set('x-mm-user-id', user.id);
      headers.set('x-mm-user-name', encodeURIComponent(user.displayName));
      const room = env.WORLD.get(env.WORLD.idFromName('col-des-erables'));
      return room.fetch(new Request(req.url, { method: req.method, headers }));
    }

    const auth = await accounts.handle(req);
    if (auth) return auth;

    const synced = await createSync(accounts, createD1SyncStore(env.DB))(req);
    if (synced) return synced;

    const friends = await createFriends(accounts, createD1FriendStore(env.DB))(req);
    if (friends) return friends;

    const strava = createUserStrava(accounts, { clientId: env.STRAVA_CLIENT_ID, clientSecret: env.STRAVA_CLIENT_SECRET });
    return (await strava(req)) ?? new Response('not found', { status: 404 });
  },

  /** Purge des sessions expirées (déclencheur `crons` de wrangler.app.toml). */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await createD1AccountStore(env.DB).purgeSessions(Math.floor(Date.now() / 1000));
  },
};
