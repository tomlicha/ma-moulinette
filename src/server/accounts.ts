/**
 * Comptes Ma Moulinette, ouverts par la connexion Strava : un compte par athlète Strava, une session par appareil.
 * Gestionnaire `Request` → `Response`, indépendant de l'hébergeur (le Worker lui donne D1 ; les tests, la mémoire).
 *
 * Le nom montré aux autres coureurs est celui du compte, pas celui de Strava : Strava le pré-remplit (« Tom L. »),
 * le coureur le valide ou le change. Les conditions de l'API Strava interdisent de montrer à un autre utilisateur les
 * données d'un athlète ; on ne montre donc ni photo ni activité Strava.
 */
import { authorizeUrl, exchangeCode, StravaError, type ClientConfig, type Fetch, type Tokens } from '../export/strava/api';

export const AUTH_PREFIX = '/api/auth/';
export const SESSION_COOKIE = 'mm_session';
const OAUTH_COOKIE = 'mm_oauth';
/** Même en-tête anti-CSRF que la passerelle Strava : un autre site ne peut pas l'envoyer sans préalerte CORS. */
export const CSRF_HEADER = 'x-zwift2';
export const SESSION_TTL_S = 30 * 24 * 3600;
const OAUTH_TTL_S = 600;
export const NAME_MAX = 32;

export interface User {
  id: string;
  displayName: string;
  /** Faux tant que le coureur n'a pas validé son nom : il n'apparaît pas aux autres avant. */
  nameConfirmed: boolean;
}

export type Provider = 'strava' | 'dev';

export interface AccountStore {
  userByIdentity(provider: Provider, subject: string): Promise<User | undefined>;
  createUser(provider: Provider, subject: string, displayName: string, nameConfirmed: boolean): Promise<User>;
  setDisplayName(userId: string, displayName: string): Promise<void>;
  createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void>;
  /** Utilisateur d'une session encore valide à l'instant `now` (secondes epoch). */
  userBySession(tokenHash: string, now: number): Promise<User | undefined>;
  deleteSession(tokenHash: string): Promise<void>;
  saveStravaTokens(userId: string, tokens: Tokens | undefined): Promise<void>;
  loadStravaTokens(userId: string): Promise<Tokens | undefined>;
}

export interface AccountOptions {
  store: AccountStore;
  /** Absents : la connexion Strava répond « non configurée ». */
  clientId?: string;
  clientSecret?: string;
  /**
   * Origine publique de l'application (`https://…`), pour l'adresse de retour Strava et les redirections. Absente :
   * celle de la requête. Utile derrière un mandataire (serveur de dev Vite devant `wrangler dev`).
   */
  publicOrigin?: string;
  /** Connexion sans Strava, par simple nom : pour le développement local seulement, jamais en ligne. */
  devLogin?: boolean;
  fetch?: Fetch;
  /** Secondes epoch. */
  now?: () => number;
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) =>
  [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

function randomToken(bytes = 32): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Comparaison en temps constant. */
function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function cookie(name: string, value: string, maxAgeS: number, path = '/'): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAgeS}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Nom proposé à partir de Strava : prénom et initiale du nom (« Tom L. »). Le nom complet n'est jamais proposé :
 * le coureur l'écrit lui-même s'il le veut.
 */
export function suggestedName(t: Pick<Tokens, 'firstname' | 'lastname'>): string {
  const raw = (t.firstname ?? '').trim();
  const first = raw.charAt(0).toUpperCase() + raw.slice(1);
  const initial = (t.lastname ?? '').trim().charAt(0);
  const name = [first, initial && `${initial.toUpperCase()}.`].filter(Boolean).join(' ');
  return cleanName(name) ?? 'Coureur';
}

/** Nom affichable : espaces resserrés, sans caractère de contrôle, 1 à `NAME_MAX` caractères ; sinon `undefined`. */
export function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  if (!name || [...name].length > NAME_MAX) return undefined;
  return name;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const page = (message: string, status: number) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Ma Moulinette</title><body style="font:16px system-ui;padding:2rem">` +
      `<p>${message}</p><p><a href="/">Revenir à l’application</a></p>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

function redirect(to: string, cookies: string[] = []): Response {
  const headers = new Headers({ location: to });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

export function createAccounts(opts: AccountOptions) {
  const f: Fetch = opts.fetch ?? ((...a) => fetch(...a));
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const cfg: ClientConfig | undefined =
    opts.clientId && opts.clientSecret ? { clientId: opts.clientId, clientSecret: opts.clientSecret } : undefined;
  const { store } = opts;

  const originOf = (req: Request) => opts.publicOrigin?.replace(/\/$/, '') ?? new URL(req.url).origin;

  function sameOrigin(req: Request): boolean {
    const origin = req.headers.get('origin');
    if (!origin) return true;
    const host = new URL(origin).host;
    return host === new URL(req.url).host || (!!opts.publicOrigin && host === new URL(opts.publicOrigin).host);
  }

  /** Requête qui modifie quelque chose : même origine et en-tête anti-CSRF. */
  const mutating = (req: Request) => req.method === 'POST' && sameOrigin(req) && !!req.headers.get(CSRF_HEADER);

  async function openSession(userId: string): Promise<string> {
    const token = randomToken();
    await store.createSession(await sha256Hex(token), userId, now() + SESSION_TTL_S);
    return cookie(SESSION_COOKIE, token, SESSION_TTL_S);
  }

  /** L'utilisateur de la requête, d'après son cookie de session. */
  async function userOf(req: Request): Promise<User | undefined> {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return undefined;
    return store.userBySession(await sha256Hex(token), now());
  }

  /** Connexion de développement : un compte par nom, nom déjà validé. */
  async function devUser(name: string): Promise<User> {
    return (await store.userByIdentity('dev', name)) ?? store.createUser('dev', name, name, true);
  }

  async function callback(req: Request, url: URL): Promise<Response> {
    if (!cfg) return page('La connexion Strava n’est pas configurée.', 503);
    const [expected = '', popupFlag] = (readCookie(req, OAUTH_COOKIE) ?? '').split('.');
    const popup = popupFlag === 'p';
    const clear = cookie(OAUTH_COOKIE, '', 0, AUTH_PREFIX);
    const state = url.searchParams.get('state') ?? '';
    if (!expected || !safeEqual(state, expected)) {
      // Cas typique sur Android : l'app Strava a rendu la main à un autre navigateur que celui de Ma Moulinette.
      return page(
        'Connexion non terminée : cette page ne retrouve pas ta demande (expirée, ou ouverte dans un autre navigateur que ' +
          'celui de Ma Moulinette). Reviens dans Ma Moulinette et touche de nouveau « Connect with Strava » : la connexion ' +
          'passera cette fois par la page web de Strava.',
        400,
      );
    }
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error') || !code) return redirect('/', [clear]);

    let tokens: Tokens;
    try {
      tokens = await exchangeCode(cfg, code, f);
    } catch (e) {
      // Strava refuse l'échange quand l'application a atteint son nombre d'athlètes autorisés.
      if (e instanceof StravaError && e.status === 403) {
        return page('Toutes les places sont prises pour l’instant : l’application Strava a atteint son nombre de coureurs autorisés.', 403);
      }
      return page(`Connexion Strava impossible : ${e instanceof Error ? e.message : e}`, 502);
    }
    if (!tokens.athleteId) return page('Strava n’a pas donné d’identifiant d’athlète.', 502);

    const user =
      (await store.userByIdentity('strava', tokens.athleteId)) ??
      (await store.createUser('strava', tokens.athleteId, suggestedName(tokens), false));
    await store.saveStravaTokens(user.id, tokens);
    const session = await openSession(user.id);
    if (!popup) return redirect('/', [clear, session]);
    const res = new Response(
      `<!doctype html><meta charset="utf-8"><title>Strava</title><body style="font:16px system-ui;padding:2rem">` +
        `<p>Strava est connecté. Cette fenêtre va se fermer.</p>` +
        `<script>window.opener&&window.opener.postMessage('strava-connected',location.origin);setTimeout(()=>window.close(),800)</script>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
    res.headers.append('set-cookie', clear);
    res.headers.append('set-cookie', session);
    return res;
  }

  async function handle(req: Request): Promise<Response | undefined> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(AUTH_PREFIX)) return undefined;
    const route = url.pathname.slice(AUTH_PREFIX.length);

    if (route === 'me' && req.method === 'GET') {
      const user = await userOf(req);
      const methods = { strava: !!cfg, dev: !!opts.devLogin };
      // 200 même sans session : ne pas être connecté est un état normal, pas une erreur (et la console reste propre).
      return json({ user: user ?? null, methods });
    }

    if (route === 'login' && req.method === 'GET') {
      if (!cfg) return page('La connexion Strava n’est pas configurée : renseigner STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET.', 503);
      const state = randomToken(16);
      // `?popup=1` : ouverte dans une fenêtre par l'envoi à Strava (accès Strava à renouveler) ; elle se refermera seule.
      const popup = url.searchParams.get('popup') === '1';
      // `?via=app` : passer par l'app Strava (Android). Jamais pour la fenêtre : l'app rendrait la main au navigateur, pas à elle.
      const viaApp = url.searchParams.get('via') === 'app' && !popup;
      const to = authorizeUrl(cfg.clientId, `${originOf(req)}${AUTH_PREFIX}callback`, state, viaApp);
      return redirect(to, [cookie(OAUTH_COOKIE, popup ? `${state}.p` : state, OAUTH_TTL_S, AUTH_PREFIX)]);
    }

    if (route === 'callback' && req.method === 'GET') return callback(req, url);

    if (route === 'profile') {
      if (!mutating(req)) return json({ error: 'forbidden' }, 403);
      const user = await userOf(req);
      if (!user) return json({ error: 'not_signed_in' }, 401);
      const body = (await req.json().catch(() => ({}))) as { displayName?: unknown };
      const name = cleanName(body.displayName);
      if (!name) return json({ error: 'invalid_name', max: NAME_MAX }, 400);
      await store.setDisplayName(user.id, name);
      return json({ user: { ...user, displayName: name, nameConfirmed: true } });
    }

    if (route === 'logout') {
      if (!mutating(req)) return json({ error: 'forbidden' }, 403);
      const token = readCookie(req, SESSION_COOKIE);
      if (token) await store.deleteSession(await sha256Hex(token));
      return json({ signedIn: false }, 200, { 'set-cookie': cookie(SESSION_COOKIE, '', 0) });
    }

    if (route === 'dev-login') {
      if (!opts.devLogin) return json({ error: 'not_found' }, 404);
      if (!mutating(req)) return json({ error: 'forbidden' }, 403);
      const body = (await req.json().catch(() => ({}))) as { name?: unknown };
      const name = cleanName(body.name);
      if (!name) return json({ error: 'invalid_name', max: NAME_MAX }, 400);
      const user = await devUser(name);
      return json({ user }, 200, { 'set-cookie': await openSession(user.id) });
    }

    return json({ error: 'not_found' }, 404);
  }

  /**
   * L'utilisateur qui ouvre la connexion temps réel. En développement, `?dev=<nom>` suffit (robots de test, plusieurs
   * coureurs dans un même navigateur).
   */
  async function resolveUser(req: Request): Promise<User | undefined> {
    if (opts.devLogin) {
      const name = cleanName(new URL(req.url).searchParams.get('dev'));
      if (name) return devUser(name);
    }
    return userOf(req);
  }

  return { handle, resolveUser, userOf, sameOrigin, store, mutating, originOf };
}
