import type { KeyValueStore } from '../../shared/util/key-value-store';

/** Préfixe des clés du navigateur avant le 17 novembre 2026 (ancien nom de code du projet). */
const LEGACY_PREFIX = 'zwift2.';
export const STORAGE_PREFIX = 'mamoulinette.';

/**
 * Reprend les données gardées sous l'ancien préfixe (FTP, masse, séances, blocs, appareils…) sous le nouveau, une fois.
 * Une clé déjà présente sous le nouveau nom n'est pas écrasée. À appeler avant toute lecture.
 */
export function migrateLegacyKeys(storage: KeyValueStore & { readonly length: number; key(i: number): string | null }): number {
  let moved = 0;
  try {
    const old: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(LEGACY_PREFIX)) old.push(k);
    }
    for (const k of old) {
      const target = STORAGE_PREFIX + k.slice(LEGACY_PREFIX.length);
      const v = storage.getItem(k);
      if (v !== null && storage.getItem(target) === null) {
        storage.setItem(target, v);
        moved++;
      }
      storage.removeItem(k);
    }
  } catch {
    // stockage indisponible ou plein : les anciennes clés restent, on réessaiera au prochain lancement
  }
  return moved;
}
