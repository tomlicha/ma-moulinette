import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const render = vi.fn(async (size: number) => new Blob([`png ${size}`], { type: 'image/png' }));
vi.mock('./rider-portrait-render', () => ({ renderRiderPortrait: render }));

const { loadPortrait } = await import('./rider-portrait');

/** Cache API minimale en mémoire : `open`, `match`, `put`, `keys`, `delete`. */
function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (url: string) => store.get(url)?.clone(),
    put: async (url: string, res: Response) => void store.set(url, res),
    keys: async () => [...store.keys()].map((url) => ({ url })),
    delete: async (req: { url: string }) => store.delete(req.url),
  };
  return { store, api: { open: async () => cache } };
}

const text = async (blobUrl: string) => (await fetch(blobUrl)).text();

describe('portrait du coureur gardé dans le navigateur', () => {
  let caches: ReturnType<typeof fakeCaches>;
  beforeEach(() => {
    render.mockClear();
    caches = fakeCaches();
    vi.stubGlobal('caches', caches.api);
    vi.stubGlobal('location', new URL('https://moulinette.test/#accueil'));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rend le portrait une seule fois par version, puis le relit', async () => {
    expect(await text(await loadPortrait(512, 'v1'))).toBe('png 512');
    expect(await text(await loadPortrait(512, 'v1'))).toBe('png 512');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('refait le portrait quand la version change, et oublie l’ancien', async () => {
    await loadPortrait(512, 'v1');
    await loadPortrait(512, 'v2');
    expect(render).toHaveBeenCalledTimes(2);
    expect([...caches.store.keys()]).toEqual(['https://moulinette.test/__cache/rider-portrait-v2-512.png']);
  });

  it('sans version (développement), ne lit ni n’écrit le cache', async () => {
    await loadPortrait(512, undefined);
    await loadPortrait(512, undefined);
    expect(render).toHaveBeenCalledTimes(2);
    expect(caches.store.size).toBe(0);
  });

  it('sans Cache API, ou si elle échoue, rend le portrait quand même', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await text(await loadPortrait(256, 'v1'))).toBe('png 256');
    vi.stubGlobal('caches', { open: async () => { throw new Error('stockage refusé'); } });
    expect(await text(await loadPortrait(256, 'v1'))).toBe('png 256');
    expect(render).toHaveBeenCalledTimes(2);
  });
});
