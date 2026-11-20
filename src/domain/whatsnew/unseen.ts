import type { WhatsNewEntry } from './entries';
import { laterMark } from './later-mark';

/** N1 ne remonte pas plus loin que 60 jours, et montre 8 entrées au plus. N3 garde tout le catalogue. */
export const MAX_AGE_DAYS = 60;
export const MAX_ENTRIES = 8;

const DAY_MS = 86_400_000;

/** Ce que la carte présente : le héros, les autres, et leur nombre total. */
export interface Selection {
  /** Le héros : l'entrée en vedette la plus récente, à défaut la plus récente. */
  featured: WhatsNewEntry;
  /** Les autres, la plus récente d'abord. */
  rest: WhatsNewEntry[];
  /** Le héros compris. */
  total: number;
}

/** Instant (ms, UTC) du jour que dit l'id (`AAAA-MM-JJ-…`), ou `undefined` si l'id ne commence pas par une date. */
export function dateOfId(id: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:-|$)/.exec(id);
  if (!m) return undefined;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? undefined : t;
}

export { laterMark };

/** Id de l'entrée la plus récente du catalogue (le catalogue est trié, ancienne en premier). */
export function newestId(entries: readonly WhatsNewEntry[]): string | undefined {
  return entries.reduce<string | undefined>((best, e) => laterMark(best, e.id), undefined);
}

/** Entrées plus récentes que le repère, la plus récente d'abord. Sans repère : toutes. */
export function entriesAfter(entries: readonly WhatsNewEntry[], mark: string | undefined): WhatsNewEntry[] {
  return entries.filter((e) => mark === undefined || e.id > mark).sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Reste-t-il quelque chose de plus récent que le repère de lecture ? */
export function hasUnread(entries: readonly WhatsNewEntry[], read: string | undefined): boolean {
  return entriesAfter(entries, read).length > 0;
}

/**
 * Ce que la carte doit présenter : les entrées plus récentes que `announced`, d'au plus 60 jours, 8 au plus.
 * `undefined` : rien à montrer (la carte ne s'ouvre pas).
 */
export function selectForCard(entries: readonly WhatsNewEntry[], announced: string | undefined, now: number): Selection | undefined {
  const oldest = now - MAX_AGE_DAYS * DAY_MS;
  const pool = entriesAfter(entries, announced)
    .filter((e) => {
      const t = dateOfId(e.id);
      return t === undefined || t >= oldest;
    })
    .slice(0, MAX_ENTRIES);
  const [first] = pool;
  if (!first) return undefined;
  const featured = pool.find((e) => e.featured) ?? first;
  return { featured, rest: pool.filter((e) => e !== featured), total: pool.length };
}

/** Jours entiers écoulés entre deux instants (jamais négatif). */
export function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}
