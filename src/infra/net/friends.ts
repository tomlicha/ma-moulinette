/**
 * Les amis du compte, vus de la page : lire la liste et l'ajouter ou la retirer (`/api/friends`, src/server/friends.ts).
 * Sans Worker (build statique, serveur de dev seul), tout répond « indisponible » : on reste sans amis, sans erreur.
 */
import { CSRF_HEADER } from '../../shared/protocol/csrf';
import { FRIENDS_PATH, type Friend } from '../../shared/protocol/friends';

type Fetch = typeof fetch;

export type FriendsResult = { ok: true; friends: Friend[] } | { ok: false; reason: 'too-many' | 'unknown' | 'signed-out' | 'unavailable' };

const isFriends = (v: unknown): v is Friend[] =>
  Array.isArray(v) && v.every((f) => typeof (f as Friend)?.id === 'string' && typeof (f as Friend)?.name === 'string');

async function answer(res: Response): Promise<FriendsResult> {
  const body = (await res.json().catch(() => undefined)) as { friends?: unknown; error?: string } | undefined;
  if (res.ok && isFriends(body?.friends)) return { ok: true, friends: body.friends };
  if (res.status === 401) return { ok: false, reason: 'signed-out' };
  if (res.status === 409) return { ok: false, reason: 'too-many' };
  if (res.status === 404) return { ok: false, reason: 'unknown' };
  return { ok: false, reason: 'unavailable' };
}

/** Les amis du compte connecté. */
export async function fetchFriends(f: Fetch = fetch): Promise<FriendsResult> {
  try {
    return await answer(await f(FRIENDS_PATH, { credentials: 'same-origin' }));
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** Ajoute (`add`) ou retire (`remove`) un ami ; rend la liste mise à jour. */
export async function changeFriend(change: { add: string } | { remove: string }, f: Fetch = fetch): Promise<FriendsResult> {
  try {
    return await answer(
      await f(FRIENDS_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
        body: JSON.stringify(change),
      }),
    );
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
