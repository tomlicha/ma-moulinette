import { describe, expect, it } from 'vitest';
import { cleanName, createAccounts, CSRF_HEADER, readCookie, SESSION_COOKIE, suggestedName, type AccountOptions } from './accounts';
import { createMemoryAccountStore } from './memory-store';

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

  it('sans session, me répond 401 et la salle ne reconnaît personne', async () => {
    const { accounts } = setup();
    expect((await accounts.handle(new Request(`${ORIGIN}/api/auth/me`)))!.status).toBe(401);
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
