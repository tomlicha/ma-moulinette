/**
 * Les amis d'un compte (`/api/friends`) : ceux qu'il a ajoutés depuis la liste « En ligne ». Pas de réciprocité : l'ajout est
 * à sens unique, l'autre n'est pas prévenu et n'a rien à accepter. Les amis servent à les passer en tête de la liste et au
 * réglage « Qui peut me rejoindre : mes amis » (docs/design/groupe.md).
 *
 *   GET  /api/friends                     → { friends: [{ id, name }] }, les noms que les amis montrent aux autres
 *   POST /api/friends { add: id }         → la liste mise à jour (ajoute ; sans effet s'il l'est déjà)
 *   POST /api/friends { remove: id }      → la liste mise à jour
 *
 * Seuls les comptes qui ont validé leur nom (ceux que la salle montre) peuvent être ajoutés ; on ne s'ajoute pas soi-même ;
 * `MAX_FRIENDS` au plus.
 */
import { FRIENDS_PATH, isAccountId, MAX_FRIENDS, type Friend } from '../shared/protocol/friends';
import type { User } from './accounts';

export interface FriendStore {
  /** Les amis du compte, avec leur nom, par ordre d'ajout. */
  list(userId: string): Promise<Friend[]>;
  /** Le compte `id` tel que la salle le montre (nom validé) ; `undefined` s'il n'existe pas ou n'a pas validé son nom. */
  describe(id: string): Promise<Friend | undefined>;
  add(userId: string, friendId: string, now: number): Promise<void>;
  remove(userId: string, friendId: string): Promise<void>;
}

interface Accounts {
  userOf(req: Request): Promise<User | undefined>;
  mutating(req: Request): boolean;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function createFriends(accounts: Accounts, store: FriendStore, now: () => number = () => Date.now()) {
  return async function handle(req: Request): Promise<Response | undefined> {
    if (new URL(req.url).pathname !== FRIENDS_PATH) return undefined;
    if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (req.method === 'POST' && !accounts.mutating(req)) return json({ error: 'forbidden' }, 403);
    const user = await accounts.userOf(req);
    if (!user) return json({ error: 'not_signed_in' }, 401);

    if (req.method === 'POST') {
      const text = await req.text();
      let body: { add?: unknown; remove?: unknown };
      try {
        body = JSON.parse(text.length > 512 ? '' : text) as typeof body;
      } catch {
        return json({ error: 'invalid_json' }, 400);
      }
      if (body?.add !== undefined) {
        if (!isAccountId(body.add) || body.add === user.id) return json({ error: 'invalid_friend' }, 400);
        const known = await store.list(user.id);
        if (!known.some((f) => f.id === body.add)) {
          if (known.length >= MAX_FRIENDS) return json({ error: 'too_many', max: MAX_FRIENDS }, 409);
          if (!(await store.describe(body.add))) return json({ error: 'unknown_friend' }, 404);
          await store.add(user.id, body.add, now());
        }
      } else if (body?.remove !== undefined) {
        if (!isAccountId(body.remove)) return json({ error: 'invalid_friend' }, 400);
        await store.remove(user.id, body.remove);
      } else {
        return json({ error: 'invalid_request' }, 400);
      }
    }
    return json({ friends: await store.list(user.id) });
  };
}
