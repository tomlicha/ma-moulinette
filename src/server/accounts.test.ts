import { describe, expect, it } from 'vitest';
import { cleanName, createAccounts, CSRF_HEADER, readCookie, SESSION_COOKIE, suggestedName, type AccountOptions } from './accounts';
import { createMemoryAccountStore } from './memory-store';
import { createUserStrava } from './user-strava';
import { APP_RETRY_MS, prefersStravaApp } from '../net/account';

const ORIGIN = 'https://moulinette.example';
const NOW = 1_800_000_000;

function setup(over: Partial<AccountOptions> = {}, tokenResponse: () => Response = () => stravaTokens()) {
  const store = createMemoryAccountStore();
  const calls: string[] = [];
  const accounts = createAccounts({
    store,
    clientId: '123',
    clientSecret: 'secret',
    now: () => NOW,
    fetch: async (input) => {
      calls.push(String(input));
      return tokenResponse();
    },
    ...over,
  });
  return { store, accounts, calls };
}

const stravaTokens = (athlete: object = { id: 4242, firstname: 'tom', lastname: 'licha' }) =>
  new Response(JSON.stringify({ access_token: 'acc', refresh_token: 'ref', expires_at: NOW + 21600, athlete }), { status: 200 });

const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieValue = (res: Response, name: string) =>
  setCookies(res)
    .map((c) => c.split(';')[0]!)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/** Parcours complet : login → Strava → callback. Renvoie le cookie de session. */
async function signIn(accounts: ReturnType<typeof setup>['accounts']) {
  const login = (await accounts.handle(new Request(`${ORIGIN}/api/auth/login`)))!;
  const state = new URL(login.headers.get('location')!).searchParams.get('state')!;
  const oauth = cookieValue(login, 'mm_oauth')!;
  const cb = (await accounts.handle(
    new Request(`${ORIGIN}/api/auth/callback?state=${state}&code=abc&scope=read,activity:write`, {
      headers: { cookie: `mm_oauth=${oauth}` },
    }),
  ))!;
  return { cb, session: cookieValue(cb, SESSION_COOKIE) };
}

const post = (path: string, body: unknown, cookie?: string, headers: Record<string, string> = { [CSRF_HEADER]: '1' }) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}), ...headers },
    body: JSON.stringify(body),
  });

describe('comptes par Strava', () => {
  it("envoie vers Strava avec l'adresse de retour publique et un état lié au navigateur", async () => {
    const { accounts } = setup({ publicOrigin: 'http://localhost:5173' });
    const res = (await accounts.handle(new Request('http://127.0.0.1:8787/api/auth/login')))!;
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.origin + to.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(to.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/callback');
    expect(cookieValue(res, 'mm_oauth')).toBe(to.searchParams.get('state'));
    expect(setCookies(res)[0]).toContain('HttpOnly');
  });

  it('crée le compte à la première connexion, avec un nom proposé à valider', async () => {
    const { accounts, store } = setup();
    const { cb, session } = await signIn(accounts);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/');
    expect(session).toMatch(/^[0-9a-f]{64}$/);
    const me = await (await accounts.handle(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } })))!.json();
    expect(me.user).toMatchObject({ displayName: 'Tom L.', nameConfirmed: false });
    expect(await store.loadStravaTokens(me.user.id)).toMatchObject({ accessToken: 'acc', athleteId: '4242' });
  });

  it('retrouve le même compte à la connexion suivante, sans toucher au nom choisi', async () => {
    const { accounts, store } = setup();
    const first = await signIn(accounts);
    const cookie = `${SESSION_COOKIE}=${first.session}`;
    expect((await accounts.handle(post('/api/auth/profile', { displayName: '  Tom   la Fusée ' }, cookie)))!.status).toBe(200);
    const again = await signIn(accounts);
    expect(again.session).not.toBe(first.session);
    expect(store.users.size).toBe(1);
    const me = await (await accounts.handle(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${again.session}` } })))!.json();
    expect(me.user).toMatchObject({ displayName: 'Tom la Fusée', nameConfirmed: true });
  });

  it("refuse un retour de Strava sans l'état émis pour ce navigateur", async () => {
    const { accounts, calls } = setup();
    const res = (await accounts.handle(new Request(`${ORIGIN}/api/auth/callback?state=forged&code=abc`, { headers: { cookie: 'mm_oauth=other' } })))!;
    expect(res.status).toBe(400);
    expect(calls).toEqual([]); // jamais d'échange de code
  });

  it("explique quand l'application Strava n'a plus de place", async () => {
    const { accounts } = setup({}, () => new Response('{"message":"Limit of connected athletes exceeded"}', { status: 403 }));
    const { cb, session } = await signIn(accounts);
    expect(cb.status).toBe(403);
    expect(await cb.text()).toContain('places sont prises');
    expect(session).toBeUndefined();
  });

  it('sans session, me ne donne aucun coureur et la salle ne reconnaît personne', async () => {
    const { accounts } = setup();
    const me = (await accounts.handle(new Request(`${ORIGIN}/api/auth/me`)))!;
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: null, methods: { strava: true, dev: false } });
    const forged = new Request(`${ORIGIN}/api/world/ws`, { headers: { cookie: `${SESSION_COOKIE}=${'a'.repeat(64)}` } });
    expect(await accounts.resolveUser(forged)).toBeUndefined();
  });

  it('la déconnexion efface la session', async () => {
    const { accounts } = setup();
    const { session } = await signIn(accounts);
    const cookie = `${SESSION_COOKIE}=${session}`;
    const out = (await accounts.handle(post('/api/auth/logout', {}, cookie)))!;
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await accounts.resolveUser(new Request(`${ORIGIN}/x`, { headers: { cookie } }))).toBeUndefined();
  });

  it("refuse les modifications sans l'en-tête anti-CSRF ou depuis un autre site", async () => {
    const { accounts } = setup();
    const { session } = await signIn(accounts);
    const cookie = `${SESSION_COOKIE}=${session}`;
    expect((await accounts.handle(post('/api/auth/profile', { displayName: 'X' }, cookie, {})))!.status).toBe(403);
    expect((await accounts.handle(post('/api/auth/profile', { displayName: 'X' }, cookie, { [CSRF_HEADER]: '1', origin: 'https://evil.example' })))!.status).toBe(403);
    expect((await accounts.handle(post('/api/auth/profile', { displayName: '' }, cookie)))!.status).toBe(400);
  });

  it('la connexion de développement est fermée par défaut', async () => {
    const { accounts } = setup();
    expect((await accounts.handle(post('/api/auth/dev-login', { name: 'Bot' })))!.status).toBe(404);
    expect(await accounts.resolveUser(new Request(`${ORIGIN}/api/world/ws?dev=Bot`))).toBeUndefined();
  });

  it('la connexion de développement ouvre une session par nom', async () => {
    const { accounts } = setup({ devLogin: true });
    const res = (await accounts.handle(post('/api/auth/dev-login', { name: 'Robot 1' })))!;
    expect(res.status).toBe(200);
    const cookie = `${SESSION_COOKIE}=${cookieValue(res, SESSION_COOKIE)}`;
    const a = await accounts.resolveUser(new Request(`${ORIGIN}/x`, { headers: { cookie } }));
    const b = await accounts.resolveUser(new Request(`${ORIGIN}/api/world/ws?dev=Robot%201`));
    expect(a).toMatchObject({ displayName: 'Robot 1', nameConfirmed: true });
    expect(b!.id).toBe(a!.id);
  });
});

describe('noms', () => {
  it('propose prénom et initiale, jamais le nom complet', () => {
    expect(suggestedName({ firstname: 'Tom', lastname: 'licha' })).toBe('Tom L.');
    expect(suggestedName({ firstname: 'Élodie' })).toBe('Élodie');
    expect(suggestedName({})).toBe('Coureur');
  });

  it('nettoie un nom saisi et refuse les noms vides ou trop longs', () => {
    expect(cleanName(' Tom​  L. \n')).toBe('Tom L.');
    expect(cleanName('a'.repeat(32))).toHaveLength(32);
    expect(cleanName('a'.repeat(33))).toBeUndefined();
    expect(cleanName('   ')).toBeUndefined();
    expect(cleanName(42)).toBeUndefined();
  });

  it('lit un cookie parmi d’autres', () => {
    const req = new Request(ORIGIN, { headers: { cookie: 'a=1; mm_session=xyz ; b=2' } });
    expect(readCookie(req, 'mm_session')).toBe('xyz');
    expect(readCookie(req, 'c')).toBeUndefined();
  });
});

describe('envoi à Strava sur le compte du coureur', () => {
  async function signedIn() {
    const uploads: string[] = [];
    const store = createMemoryAccountStore();
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.endsWith('/oauth/token')) return stravaTokens();
      if (u.endsWith('/uploads')) {
        uploads.push(new Headers(init?.headers).get('authorization') ?? '');
        return new Response(JSON.stringify({ id_str: '9', activity_id: 77, status: 'ready' }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const accounts = createAccounts({ store, clientId: '123', clientSecret: 'secret', now: () => NOW, fetch: f });
    const strava = createUserStrava(accounts, { clientId: '123', clientSecret: 'secret', now: () => NOW, fetch: f, sleep: async () => {} });
    const { session } = await signIn(accounts);
    return { strava, uploads, cookie: `${SESSION_COOKIE}=${session}` };
  }

  it("sans compte, rien n'est proposé : seul l'export FIT reste", async () => {
    const { strava } = await signedIn();
    const status = await (await strava(new Request(`${ORIGIN}/api/strava/status`)))!.json();
    expect(status).toMatchObject({ configured: false, connected: false });
    const up = (await strava(post('/api/strava/upload', {})))!;
    expect(up.status).toBe(401);
  });

  it('connecté, la sortie part avec les jetons du coureur', async () => {
    const { strava, uploads, cookie } = await signedIn();
    const status = await (await strava(new Request(`${ORIGIN}/api/strava/status`, { headers: { cookie } })))!.json();
    expect(status).toMatchObject({ configured: true, connected: true });
    const req = new Request(`${ORIGIN}/api/strava/upload?name=Sortie&externalId=x1`, {
      method: 'POST',
      headers: { cookie, origin: ORIGIN, [CSRF_HEADER]: '1' },
      body: new Uint8Array([1, 2, 3]),
    });
    const res = (await strava(req))!;
    expect(await res.json()).toMatchObject({ activityId: '77' });
    expect(uploads).toEqual(['Bearer acc']);
  });

  it("un accès Strava à renouveler passe par la connexion des comptes, dans une fenêtre qui se referme", async () => {
    const { strava, cookie } = await signedIn();
    const res = (await strava(post('/api/strava/login', {}, cookie)))!;
    expect(await res.json()).toEqual({ url: `${ORIGIN}/api/auth/login?popup=1` });
  });

  it('la connexion en fenêtre prévient la page et ouvre la session', async () => {
    const { accounts } = setup();
    const login = (await accounts.handle(new Request(`${ORIGIN}/api/auth/login?popup=1`)))!;
    const state = new URL(login.headers.get('location')!).searchParams.get('state')!;
    const oauth = cookieValue(login, 'mm_oauth')!;
    expect(oauth).toBe(`${state}.p`);
    const cb = (await accounts.handle(
      new Request(`${ORIGIN}/api/auth/callback?state=${state}&code=abc`, { headers: { cookie: `mm_oauth=${oauth}` } }),
    ))!;
    expect(cb.status).toBe(200);
    expect(await cb.text()).toContain("postMessage('strava-connected'");
    expect(cookieValue(cb, SESSION_COOKIE)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("connexion par l'app Strava (Android)", () => {
  it("?via=app envoie vers l'adresse mobile de Strava, que l'app intercepte", async () => {
    const { accounts } = setup();
    const app = (await accounts.handle(new Request(`${ORIGIN}/api/auth/login?via=app`)))!;
    expect(app.headers.get('location')).toMatch(/^https:\/\/www\.strava\.com\/oauth\/mobile\/authorize\?/);
    const web = (await accounts.handle(new Request(`${ORIGIN}/api/auth/login`)))!;
    expect(web.headers.get('location')).toMatch(/^https:\/\/www\.strava\.com\/oauth\/authorize\?/);
    // Jamais pour la fenêtre de renouvellement : l'app rendrait la main au navigateur, pas à elle.
    const popup = (await accounts.handle(new Request(`${ORIGIN}/api/auth/login?via=app&popup=1`)))!;
    expect(popup.headers.get('location')).toMatch(/\/oauth\/authorize\?/);
  });

  it('le retour dans un autre navigateur explique quoi faire', async () => {
    const { accounts } = setup();
    const res = (await accounts.handle(new Request(`${ORIGIN}/api/auth/callback?state=abc&code=x`)))!;
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('autre navigateur');
  });

  it("ne passe par l'app que sur Android, et repasse par le web après un essai resté sans suite", () => {
    const android = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36' };
    const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1' };
    const desktop = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131 Safari/537.36', platform: 'Linux' };
    const now = 1_000_000_000;
    expect(prefersStravaApp(android, undefined, now)).toBe(true);
    expect(prefersStravaApp({ userAgent: '', platform: 'Android' }, undefined, now)).toBe(true);
    expect(prefersStravaApp(iphone, undefined, now)).toBe(false);
    expect(prefersStravaApp(desktop, undefined, now)).toBe(false);
    expect(prefersStravaApp(android, now - 60_000, now)).toBe(false); // essai il y a une minute, toujours pas connecté
    expect(prefersStravaApp(android, now - APP_RETRY_MS - 1, now)).toBe(true);
  });
});

describe('coquille native : connexion dans une session d’authentification système', () => {
  async function nativeSignIn(accounts: ReturnType<typeof setup>['accounts'], query = 'code=abc') {
    const login = (await accounts.handle(new Request(`${ORIGIN}/api/auth/login?native=1`)))!;
    const state = new URL(login.headers.get('location')!).searchParams.get('state')!;
    const oauth = cookieValue(login, 'mm_oauth')!;
    expect(oauth).toBe(`${state}.n`);
    return (await accounts.handle(new Request(`${ORIGIN}/api/auth/callback?state=${state}&${query}`, { headers: { cookie: `mm_oauth=${oauth}` } })))!;
  }

  it('rend un ticket à l’app, sans session dans le navigateur système ; le ticket ouvre une session une seule fois', async () => {
    const { accounts } = setup();
    const cb = await nativeSignIn(accounts);
    const to = new URL(cb.headers.get('location')!);
    expect(`${to.protocol}//${to.host}`).toBe('moulinette://auth');
    expect(cookieValue(cb, SESSION_COOKIE)).toBeUndefined();
    const ticket = to.searchParams.get('ticket')!;
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);

    const res = (await accounts.handle(post('/api/auth/redeem', { ticket })))!;
    expect(res.status).toBe(200);
    const session = cookieValue(res, SESSION_COOKIE)!;
    expect(session).toMatch(/^[0-9a-f]{64}$/);
    expect(session).not.toBe(ticket);
    const me = await (await accounts.handle(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } })))!.json();
    expect(me.user).toBeTruthy();
    // Rejoué : refusé.
    expect((await accounts.handle(post('/api/auth/redeem', { ticket })))!.status).toBe(400);
  });

  it('refus chez Strava : l’app est prévenue', async () => {
    const { accounts } = setup();
    const cb = await nativeSignIn(accounts, 'error=access_denied');
    expect(cb.headers.get('location')).toBe('moulinette://auth?error=denied');
  });

  it('l’échange exige l’en-tête anti-CSRF et un ticket bien formé', async () => {
    const { accounts } = setup();
    expect((await accounts.handle(post('/api/auth/redeem', { ticket: 'a'.repeat(64) }, undefined, {})))!.status).toBe(403);
    expect((await accounts.handle(post('/api/auth/redeem', { ticket: 'pas un ticket' })))!.status).toBe(400);
    expect((await accounts.handle(post('/api/auth/redeem', { ticket: 'a'.repeat(64) })))!.status).toBe(400);
  });
});
