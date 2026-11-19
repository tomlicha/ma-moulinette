import type { Workout } from '../../domain/workout/model';
import { profileShapes } from '../../domain/workout/profile';
import { formatDuration } from '../shared/duration';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Les petits outils d'écran partagés par les morceaux de l'éditeur de séance. */

export const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

export function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Donne un fichier texte au coureur. */
export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Nom de fichier sûr à partir d'un titre. */
export const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seance';

/** Texte sans accents ni majuscules, pour la recherche. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const pct = (fraction: number) => Math.round(fraction * 100);

export const fmtLong = (s: number) =>
  s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : formatDuration(s);

export const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, dialog[open]');

/** Bibliothèque et navigation ont leurs propres touches : les flèches et Suppr n'y touchent pas aux blocs. */
export const isElsewhere = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('.sea-lib, .home-top, .ed-shelf');

/** Aperçu du profil d'une séance (mêmes couleurs de zones que l'éditeur). */
export function miniProfile(w: Workout, ftpW: number, cls = 'lib-mini') {
  const root = svg('svg', { class: cls, viewBox: '0 0 100 40', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  for (const s of profileShapes(w, ftpW, 100, 40)) root.append(svg('path', { d: s.d, class: s.zone }));
  return root;
}
