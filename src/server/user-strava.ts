/**
 * Envoi des sorties sur le compte Strava du coureur connecté : la passerelle (src/export/strava/relay.ts) travaille sur
 * les jetons obtenus à la connexion. Sans compte, rien à envoyer : la page ne propose que l'export FIT. Un accès Strava
 * à renouveler passe par la connexion des comptes, dans une fenêtre qui se referme seule.
 */
import { createStravaRelay, PREFIX, type RelayOptions } from '../export/strava/relay';
import type { createAccounts } from './accounts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createUserStrava(
  accounts: ReturnType<typeof createAccounts>,
  cfg: Pick<RelayOptions, 'clientId' | 'clientSecret' | 'fetch' | 'now' | 'sleep'>,
) {
  return async function handle(req: Request): Promise<Response | undefined> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(PREFIX)) return undefined;
    const route = url.pathname.slice(PREFIX.length);
    const user = await accounts.userOf(req);
    if (!user) return route === 'status' ? json({ configured: false, connected: false, signedOut: true }) : json({ error: 'not_signed_in' }, 401);
    if (route === 'login' || route === 'callback') {
      if (!accounts.mutating(req)) return json({ error: 'forbidden' }, 403);
      return json({ url: `${accounts.originOf(req)}/api/auth/login?popup=1` });
    }
    const relay = createStravaRelay({
      ...cfg,
      store: { load: () => accounts.store.loadStravaTokens(user.id), save: (t) => accounts.store.saveStravaTokens(user.id, t) },
    });
    return relay(req);
  };
}
