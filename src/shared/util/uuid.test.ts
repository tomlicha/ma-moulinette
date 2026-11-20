import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('donne un UUID v4', () => {
    expect(newId()).toMatch(V4);
  });

  it('fonctionne sans crypto.randomUUID (contexte non sécurisé)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.map((_, i) => (i * 37 + 11) % 256) });
    const id = newId();
    expect(id).toMatch(V4);
    expect(newId()).toBe(id); // déterministe avec ce faux générateur : prouve que le repli est utilisé
  });
});
