import type { EntryKind, WhatsNewEntry } from '../../domain/whatsnew/entries';
import { dateOfId, daysBetween } from '../../domain/whatsnew/unseen';

/** Calculs purs des écrans de nouveautés (pas de DOM, testés). */

const MONTHS = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];

export type Filter = 'all' | EntryKind;

export const KIND_LABEL: Record<EntryKind, string> = { new: 'Nouveau', improved: 'Amélioré' };

/** Jour et mois abrégé que dit l'id (« 20 », « NOV. »), ou `undefined` si l'id n'a pas de date. */
export function dayLabel(id: string): { day: string; month: string } | undefined {
  const t = dateOfId(id);
  if (t === undefined) return undefined;
  const d = new Date(t);
  return { day: String(d.getUTCDate()), month: MONTHS[d.getUTCMonth()] ?? '' };
}

/** « il y a 9 jours » : le temps écoulé depuis la dernière visite, au plus juste en mots. */
export function sinceLabel(visitedAt: number, now: number): string {
  const days = daysBetween(visitedAt, now);
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 14) return `il y a ${days} jours`;
  if (days < 60) return `il y a ${Math.floor(days / 7)} semaines`;
  return `il y a ${Math.floor(days / 30)} mois`;
}

export const countLabel = (n: number): string => (n === 1 ? '1 nouveauté' : `${n} nouveautés`);

export function filterEntries(entries: readonly WhatsNewEntry[], filter: Filter): WhatsNewEntry[] {
  return filter === 'all' ? [...entries] : entries.filter((e) => e.kind === filter);
}

/** Le journal : le non-lu (plus récent que le repère de lecture) puis le déjà vu. L'ordre reçu est gardé. */
export function splitByRead(entries: readonly WhatsNewEntry[], read: string | undefined): { unread: WhatsNewEntry[]; seen: WhatsNewEntry[] } {
  const unread = entries.filter((e) => read === undefined || e.id > read);
  return { unread, seen: entries.filter((e) => !unread.includes(e)) };
}
