import { describe, expect, it, vi } from 'vitest';
import { APP_RETRY_MS, type AccountState, type User } from '../infra/net/account';
import type { KeyValueStore } from '../shared/util/key-value-store';
import { AccountSession, type AccountApi } from './account-session';

const METHODS = { strava: true, dev: true };
const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 13)', platform: 'Android' };
const DESKTOP = { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Windows' };
const user = (over: Partial<User> = {}): User => ({ id: 'u1', displayName: 'Tom L.', nameConfirmed: true, ...over });

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function setup(over: { state?: AccountState; env?: typeof ANDROID; native?: boolean; now?: () => number; api?: Partial<AccountApi> } = {}) {
  const store = memory();
  const log: string[] = [];
  let server: AccountState = over.state ?? { kind: 'signed-out', methods: METHODS };
  const api: AccountApi = {
    fetchAccount: async () => server,
    saveDisplayName: async (n) => user({ displayName: n }),
    logout: async () => {
      server = { kind: 'signed-out', methods: METHODS };
    },
    devLogin: async (n) => {
      server = { kind: 'signed-in', user: user({ displayName: n, nameConfirmed: false }), methods: METHODS };
      return user({ displayName: n, nameConfirmed: false });
    },
    nativeStravaLogin: async () => true,
    ...over.api,
  };
  const session = new AccountSession({
    api,
    store,
    clock: over.now ?? (() => 1_000_000),
    env: () => over.env ?? DESKTOP,
    native: over.native ?? false,
    log: (m) => log.push(m),
  });
  const changed: AccountState[] = [];
  const first: User[] = [];
  session.on('changed', (s) => changed.push(s));
  session.on('firstSignIn', (u) => first.push(u));
  return { session, store, log, changed, first, setServer: (s: AccountState) => (server = s) };
}

describe('AccountSession : l’état', () => {
  it('part sans serveur de comptes', () => {
    expect(setup().session.state).toEqual({ kind: 'unavailable' });
  });

  it('refresh() relit l’état du serveur et le signale', async () => {
    const { session, changed } = setup();
    await session.refresh();
    expect(session.state.kind).toBe('signed-out');
    expect(changed).toHaveLength(1);
  });

  it('une première connexion sans nom validé le demande, une fois', async () => {
    const { session, first, setServer } = setup();
    await session.refresh();
    setServer({ kind: 'signed-in', user: user({ nameConfirmed: false }), methods: METHODS });
    await session.refresh();
    await session.refresh(); // déjà connecté : on ne redemande pas
    expect(first).toHaveLength(1);
    expect(first[0]!.nameConfirmed).toBe(false);
  });

  it('un compte au nom déjà validé ne demande rien', async () => {
    const { session, first, setServer } = setup();
    setServer({ kind: 'signed-in', user: user(), methods: METHODS });
    await session.refresh();
    expect(first).toEqual([]);
  });

  it('« changed » part avant « firstSignIn » : l’écran se dessine avant de demander', async () => {
    const { session, setServer } = setup();
    const order: string[] = [];
    session.on('changed', () => order.push('changed'));
    session.on('firstSignIn', () => order.push('firstSignIn'));
    setServer({ kind: 'signed-in', user: user({ nameConfirmed: false }), methods: METHODS });
    await session.refresh();
    expect(order).toEqual(['changed', 'firstSignIn']);
  });
});

describe('AccountSession : connexion Strava par le navigateur', () => {
  it('ordinateur : par la page web, sans rien garder', () => {
    const { session, store, log } = setup();
    expect(session.webLoginHref()).toBe('/api/auth/login');
    expect(store.data.size).toBe(0);
    expect(log).toEqual(['compte : connexion Strava par la page web de Strava']);
  });

  it('Android : par l’app Strava, l’essai est mémorisé', () => {
    const { session, store, log } = setup({ env: ANDROID, now: () => 5000 });
    expect(session.webLoginHref()).toBe('/api/auth/login?via=app');
    expect(store.data.get('mm.stravaAppTry')).toBe('5000');
    expect(log).toEqual(['compte : connexion Strava par l’app Strava']);
  });

  it('Android, essai récent sans session : repasse par la page web et oublie l’essai', () => {
    let now = 5000;
    const { session, store } = setup({ env: ANDROID, now: () => now });
    session.webLoginHref();
    now += APP_RETRY_MS - 1;
    expect(session.webLoginHref()).toBe('/api/auth/login');
    expect(store.data.has('mm.stravaAppTry')).toBe(false);
  });

  it('Android, essai ancien : par l’app de nouveau', () => {
    let now = 5000;
    const { session } = setup({ env: ANDROID, now: () => now });
    session.webLoginHref();
    now += APP_RETRY_MS + 1;
    expect(session.webLoginHref()).toBe('/api/auth/login?via=app');
  });

  it('une session ouverte efface l’essai mémorisé', async () => {
    const { session, store, setServer } = setup({ env: ANDROID });
    session.webLoginHref();
    expect(store.data.has('mm.stravaAppTry')).toBe(true);
    setServer({ kind: 'signed-in', user: user(), methods: METHODS });
    await session.refresh();
    expect(store.data.has('mm.stravaAppTry')).toBe(false);
  });

  it('un stockage bloqué n’empêche rien', () => {
    const blocked: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const api: AccountApi = {
      fetchAccount: async () => ({ kind: 'unavailable' }),
      saveDisplayName: async () => user(),
      logout: async () => {},
      devLogin: async () => user(),
      nativeStravaLogin: async () => false,
    };
    const session = new AccountSession({ api, store: blocked, env: () => ANDROID, native: false, log: () => {} });
    expect(() => session.webLoginHref()).not.toThrow();
  });
});

describe('AccountSession : coquille native', () => {
  it('le mode natif est signalé à l’écran', () => {
    expect(setup({ native: true }).session.nativeLogin).toBe(true);
    expect(setup().session.nativeLogin).toBe(false);
  });

  it('connexion réussie : journalisée, puis l’état est relu', async () => {
    const { session, log, setServer } = setup({ native: true });
    setServer({ kind: 'signed-in', user: user(), methods: METHODS });
    await session.loginNative();
    await vi.waitFor(() => expect(session.state.kind).toBe('signed-in'));
    expect(log).toEqual(['compte : connexion Strava par la session système', 'compte : connecté avec Strava']);
  });

  it('connexion annulée : rien n’est relu', async () => {
    const fetchAccount = vi.fn(async (): Promise<AccountState> => ({ kind: 'signed-out', methods: METHODS }));
    const { session, log } = setup({ native: true, api: { nativeStravaLogin: async () => false, fetchAccount } });
    await session.loginNative();
    expect(fetchAccount).not.toHaveBeenCalled();
    expect(log.at(-1)).toBe('compte : connexion Strava annulée');
  });

  it('échec : journalisé, sans exception', async () => {
    const { session, log } = setup({
      native: true,
      api: {
        nativeStravaLogin: async () => {
          throw new Error('réseau');
        },
      },
    });
    await expect(session.loginNative()).resolves.toBeUndefined();
    expect(log.at(-1)).toBe('compte : connexion Strava impossible (réseau)');
  });
});

describe('AccountSession : développement, nom, déconnexion', () => {
  it('connexion de développement : journalisée, puis l’état est relu (nom à valider)', async () => {
    const { session, log, first } = setup();
    await session.devLogin('Bloc test');
    await vi.waitFor(() => expect(session.state.kind).toBe('signed-in'));
    expect(log[0]).toBe('compte : connecté en développement (Bloc test)');
    expect(first).toHaveLength(1);
  });

  it('connexion de développement refusée : journalisée', async () => {
    const { session, log } = setup({
      api: {
        devLogin: async () => {
          throw new Error('HTTP 403');
        },
      },
    });
    await session.devLogin('x');
    expect(log).toEqual(['compte : connexion de développement refusée (HTTP 403)']);
    expect(session.state.kind).toBe('unavailable');
  });

  it('saveName() met l’utilisateur à jour sans redemander le nom', async () => {
    const { session, log, first, setServer } = setup();
    setServer({ kind: 'signed-in', user: user({ nameConfirmed: false }), methods: METHODS });
    await session.refresh();
    await session.saveName('Nouveau nom');
    const s = session.state;
    expect(s.kind === 'signed-in' && s.user.displayName).toBe('Nouveau nom');
    expect(first).toHaveLength(1); // seulement à la première connexion
    expect(log.at(-1)).toBe('compte : nom affiché « Nouveau nom »');
  });

  it('saveName() relance le refus du serveur, l’état ne bouge pas', async () => {
    const { session, changed, setServer } = setup({
      api: {
        saveDisplayName: async () => {
          throw new Error('invalid_name');
        },
      },
    });
    setServer({ kind: 'signed-in', user: user(), methods: METHODS });
    await session.refresh();
    changed.length = 0;
    await expect(session.saveName('')).rejects.toThrow('invalid_name');
    expect(changed).toEqual([]);
  });

  it('logout() journalise puis relit l’état', async () => {
    const { session, log, setServer } = setup();
    setServer({ kind: 'signed-in', user: user(), methods: METHODS });
    await session.refresh();
    await session.logout();
    expect(session.state.kind).toBe('signed-out');
    expect(log).toEqual(['compte : déconnecté']);
  });

  it('logout() qui échoue : journalisé, l’état est relu quand même', async () => {
    const { session, log, setServer } = setup({
      api: {
        logout: async () => {
          throw new Error('HTTP 500');
        },
      },
    });
    setServer({ kind: 'signed-in', user: user(), methods: METHODS });
    await session.refresh();
    await session.logout();
    expect(log).toEqual(['compte : déconnexion impossible (HTTP 500)']);
    expect(session.state.kind).toBe('signed-in');
  });
});
