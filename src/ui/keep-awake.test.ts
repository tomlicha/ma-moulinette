import { describe, expect, it, vi } from 'vitest';
import { createKeepAwake, type WakeEnv } from './keep-awake';

function fakeDoc() {
  const listeners: (() => void)[] = [];
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_t: string, f: () => void) => void listeners.push(f),
    show(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      listeners.forEach((f) => f());
    },
  };
  return doc;
}

function fakeWakeLock() {
  const live: { released: boolean; fire(): void }[] = [];
  return {
    live,
    request: vi.fn(async () => {
      let onRelease = () => {};
      const s = {
        released: false,
        release: async () => { s.released = true; onRelease(); },
        addEventListener: (_t: 'release', f: () => void) => void (onRelease = f),
        fire: () => { s.released = true; onRelease(); },
      };
      live.push(s);
      return s;
    }),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createKeepAwake', () => {
  it('coquille native : passe par le plugin', async () => {
    const native = { keepAwake: vi.fn(async () => {}) };
    const k = createKeepAwake({ native, document: fakeDoc() } as unknown as WakeEnv);
    await k.set(true);
    await k.set(true);
    await k.set(false);
    expect(native.keepAwake.mock.calls).toEqual([[{ on: true }], [{ on: false }]]);
  });

  it('navigateur : prend le verrou, le reprend au retour au premier plan, le rend à la demande', async () => {
    const doc = fakeDoc();
    const wl = fakeWakeLock();
    const k = createKeepAwake({ wakeLock: wl, document: doc } as unknown as WakeEnv);
    await k.set(true);
    expect(wl.request).toHaveBeenCalledTimes(1);
    // Page en arrière-plan : le navigateur relâche le verrou ; au retour, on le reprend.
    doc.visibilityState = 'hidden';
    wl.live[0]!.fire();
    doc.show('visible');
    await flush();
    expect(wl.request).toHaveBeenCalledTimes(2);
    await k.set(false);
    expect(wl.live[1]!.released).toBe(true);
    doc.show('hidden');
    doc.show('visible');
    await flush();
    expect(wl.request).toHaveBeenCalledTimes(2);
  });

  it('sans API : ne fait rien, sans erreur', async () => {
    const k = createKeepAwake({ document: fakeDoc() } as unknown as WakeEnv);
    await k.set(true);
    expect(k.wanted).toBe(true);
  });
});
