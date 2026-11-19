/**
 * Compte du joueur, vu de la page : qui est connecté, et les gestes du compte (connexion Strava, nom, déconnexion).
 * Parle aux adresses /api/auth/* du Worker (src/server/accounts.ts). Sans Worker (build statique, serveur de dev seul),
 * tout répond « indisponible » : l'application reste en mode sans compte.
 */
import type { User } from '../../server/accounts';
import { CSRF_HEADER } from './csrf';

export type { User } from '../../server/accounts';

export const AUTH = '/api/auth/';
const CSRF = { [CSRF_HEADER]: '1' };

export interface Methods {
  /** Connexion Strava configurée sur le serveur. */
  strava: boolean;
  /** Connexion par simple nom (développement local). */
  dev: boolean;
}

export type AccountState =
  /** Aucun serveur de comptes : mode sans compte, rien à proposer. */
  | { kind: 'unavailable' }
  | { kind: 'signed-out'; methods: Methods }
  | { kind: 'signed-in'; user: User; methods: Methods };

type Fetch = typeof fetch;

export async function fetchAccount(f: Fetch = fetch): Promise<AccountState> {
  let res: Response;
  try {
    res = await f(`${AUTH}me`, { credentials: 'same-origin' });
  } catch {
    return { kind: 'unavailable' };
  }
  const body = (await res.json().catch(() => undefined)) as { user?: User; methods?: Methods } | undefined;
  if (!body?.methods) return { kind: 'unavailable' };
  if (res.ok && body.user) return { kind: 'signed-in', user: body.user, methods: body.methods };
  if (!body.methods.strava && !body.methods.dev) return { kind: 'unavailable' };
  return { kind: 'signed-out', methods: body.methods };
}

/** Adresse qui lance la connexion Strava ; le retour se fait sur la page d'accueil de l'application. */
export const loginUrl = (viaApp = false) => `${AUTH}login${viaApp ? '?via=app' : ''}`;

/** Un essai par l'app Strava resté sans session depuis moins longtemps que ceci fait repasser par la page web. */
export const APP_RETRY_MS = 15 * 60_000;

/**
 * Passer par l'app Strava ? Seulement sur Android : Strava y ouvre son app depuis une simple adresse web (sur iPhone,
 * il faut une app native). Mais l'app rend la main au navigateur par défaut : si ce n'est pas celui de Ma Moulinette,
 * la connexion échoue. Un essai par l'app encore récent, sans session ouverte depuis, fait donc repasser par la page web.
 * C'est l'un des rares endroits où l'on regarde le système : le comportement dépend de lui, pas d'une capacité.
 */
export function prefersStravaApp(env: { userAgent: string; platform?: string }, lastAppTryMs: number | undefined, nowMs: number): boolean {
  const android = env.platform === 'Android' || /\bAndroid\b/i.test(env.userAgent);
  const recentFailure = lastAppTryMs !== undefined && nowMs - lastAppTryMs < APP_RETRY_MS;
  return android && !recentFailure;
}

async function post<T>(route: string, body: unknown, f: Fetch): Promise<T> {
  const res = await f(`${AUTH}${route}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...CSRF },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

/** Valide (ou change) le nom montré aux autres coureurs. */
export const saveDisplayName = (displayName: string, f: Fetch = fetch) =>
  post<{ user: User }>('profile', { displayName }, f).then((r) => r.user);

export const logout = (f: Fetch = fetch) => post<unknown>('logout', {}, f).then(() => undefined);

/** Connexion de développement, par simple nom. */
export const devLogin = (name: string, f: Fetch = fetch) => post<{ user: User }>('dev-login', { name }, f).then((r) => r.user);

/** Ouvre une session d'authentification système et rend l'adresse de retour (plugin de la coquille native). */
export type SystemAuth = (o: { url: string; callbackScheme: string }) => Promise<{ url: string }>;

/**
 * Coquille native : connexion Strava dans une session d'authentification système (Google refuse les WebView intégrées),
 * puis échange du ticket rendu contre la session de la WebView. `false` si la connexion est annulée ou refusée.
 */
export async function nativeStravaLogin(auth: SystemAuth, origin = location.origin, f: Fetch = fetch): Promise<boolean> {
  let back: string;
  try {
    ({ url: back } = await auth({ url: `${origin}${AUTH}login?native=1`, callbackScheme: 'moulinette' }));
  } catch {
    return false; // fermée par le coureur
  }
  const ticket = new URL(back).searchParams.get('ticket');
  if (!ticket) return false;
  await post<{ user: User }>('redeem', { ticket }, f);
  return true;
}
