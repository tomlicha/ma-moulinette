import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { precacheManifest, serviceWorkerSource } from './service-worker';

function publicDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'public-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

const BUNDLE = {
  'index.html': '<html>v1</html>',
  'assets/index-abc.js': 'code',
  'assets/index-abc.js.map': '{}',
  'assets/barlow-latin-500-normal-x.woff2': 'f',
  'assets/barlow-latin-500-normal-y.woff': 'f',
  'assets/bike-123.glb': 'glb',
};

describe('precacheManifest', () => {
  const pub = publicDir({ 'favicon.svg': '<svg/>', 'strava/logo.svg': '<svg/>', _headers: 'x', 'robots.txt': 'x', 'og-image.jpg': 'x' });

  it('liste la page, les fichiers du paquet et ceux de public/, sans cartes de sources ni polices .woff', () => {
    const { urls } = precacheManifest(BUNDLE, pub);
    expect(urls).toEqual(['/', '/assets/barlow-latin-500-normal-x.woff2', '/assets/bike-123.glb', '/assets/index-abc.js', '/favicon.svg', '/strava/logo.svg']);
  });

  it('change de version quand index.html ou un fichier de public/ change, pas sinon', () => {
    const v1 = precacheManifest(BUNDLE, pub).version;
    expect(precacheManifest({ ...BUNDLE }, pub).version).toBe(v1);
    expect(precacheManifest({ ...BUNDLE, 'index.html': '<html>v2</html>' }, pub).version).not.toBe(v1);
    expect(precacheManifest(BUNDLE, publicDir({ 'favicon.svg': '<svg>2</svg>', 'strava/logo.svg': '<svg/>' })).version).not.toBe(v1);
  });
});

/** Exécute sw.js dans un faux contexte de service worker : caches en mémoire, réseau simulé. */
function runWorker(precache: string[], version = 'v2') {
  const stores = new Map<string, Map<string, string>>();
  const network: string[] = [];
  const keyOf = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, 'https://app.test').pathname;
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      addAll: async (urls: string[]) => urls.forEach((u) => store.set(keyOf(u), `réseau ${keyOf(u)}`)),
      match: async (r: string | { url: string }) => store.get(keyOf(r)),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    location: { origin: 'https://app.test' },
    clients: { claim: async () => {} },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
  };
  const fetch = async (r: { url: string }) => (network.push(keyOf(r)), `réseau ${keyOf(r)}`);
  new Function('self', 'caches', 'fetch', serviceWorkerSource(version, precache))(self, caches, fetch);

  async function lifecycle(type: 'install' | 'activate') {
    let done: Promise<unknown> = Promise.resolve();
    listeners[type]!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }
  /** Réponse du service worker, ou `undefined` s'il laisse passer la requête au réseau. */
  async function request(url: string, init: { method?: string; mode?: string } = {}) {
    let answer: Promise<unknown> | undefined;
    listeners.fetch!({ request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }, respondWith: (p: Promise<unknown>) => (answer = p) });
    return answer && (await answer);
  }
  return { stores, network, lifecycle, request };
}

describe('sw.js', () => {
  it('précache tout à l’installation, puis sert la page et les fichiers depuis le cache, sans réseau', async () => {
    const w = runWorker(['/', '/assets/index-abc.js']);
    await w.lifecycle('install');
    expect([...w.stores.get('ma-moulinette-app-v2')!.keys()]).toEqual(['/', '/assets/index-abc.js']);
    expect(await w.request('https://app.test/?renderer=webgl2#sortie', { mode: 'navigate' })).toBe('réseau /');
    expect(await w.request('https://app.test/seances', { mode: 'navigate' })).toBe('réseau /');
    expect(await w.request('https://app.test/assets/index-abc.js')).toBe('réseau /assets/index-abc.js');
    expect(w.network).toEqual([]);
  });

  it('va au réseau pour un fichier hors précache', async () => {
    const w = runWorker(['/']);
    await w.lifecycle('install');
    expect(await w.request('https://app.test/assets/autre.js')).toBe('réseau /assets/autre.js');
    expect(w.network).toEqual(['/assets/autre.js']);
  });

  it('ne touche ni à /api/, ni aux autres sites, ni à ce qui n’est pas GET', async () => {
    const w = runWorker(['/']);
    await w.lifecycle('install');
    expect(await w.request('https://app.test/api/auth/me')).toBeUndefined();
    expect(await w.request('https://app.test/api/logs/ingest', { method: 'POST' })).toBeUndefined();
    expect(await w.request('https://www.strava.com/oauth/authorize', { mode: 'navigate' })).toBeUndefined();
    expect(await w.request('https://app.test/assets/index-abc.js', { method: 'POST' })).toBeUndefined();
  });

  it('à l’activation, supprime les versions précédentes mais garde le portrait du coureur', async () => {
    const w = runWorker(['/']);
    w.stores.set('ma-moulinette-app-v1', new Map());
    w.stores.set('ma-moulinette-portrait', new Map());
    await w.lifecycle('install');
    await w.lifecycle('activate');
    expect([...w.stores.keys()].sort()).toEqual(['ma-moulinette-app-v2', 'ma-moulinette-portrait']);
  });
});
