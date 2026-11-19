import type { KeyValueStore } from '../../shared/util/key-value-store';

/** Stockage du navigateur s'il est utilisable ; sinon une mémoire de session (navigation privée, stockage bloqué). */
export function browserStore(): KeyValueStore {
  try {
    const probe = '__mamoulinette_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
}
