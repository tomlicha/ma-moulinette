import './whatsnew.css';
import type { WhatsNewEntry } from '../../domain/whatsnew/entries';
import { ART, ICON_CLOSE } from './whats-new-art';
import { KIND_LABEL, countLabel, dayLabel, filterEntries, splitByRead, type Filter } from './whats-new-model';

/**
 * Le journal des nouveautés (N3, docs/design/nouveautes.md) : un panneau qui glisse depuis la droite, accessible de
 * l'accueil quand on veut. Le non-lu d'abord (puce orange), puis le déjà vu ; filtres Tout / Nouveau / Amélioré. Il affiche
 * et signale des intentions ; ce qu'il acquitte, c'est `WhatsNew`.
 */

export interface JournalActions {
  /** Tout le catalogue, la plus récente d'abord. */
  entries(): WhatsNewEntry[];
  /** Repère de lecture : les entrées plus récentes sont non lues. */
  readMark(): string | undefined;
  /** Date (ms) de la dernière visite sur cet appareil. */
  visitedAt(): number | undefined;
  /** « Tout marquer comme vu ». */
  onMarkAllRead(): void;
  /** Le journal se ferme : ce qu'on a vu est lu. */
  onClose(): void;
  /** « Essayer » : on va là où l'entrée mène. */
  onTry(entry: WhatsNewEntry): void;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tout' },
  { id: 'new', label: 'Nouveau' },
  { id: 'improved', label: 'Amélioré' },
];

// Gabarit statique : aucune donnée n'y est écrite, le contenu passe par textContent.
const TEMPLATE = `
<aside class="wnj-panel">
  <header class="wnj-head">
    <div class="wnj-titles">
      <h2 id="wnj-title" class="wnj-title">Nouveautés</h2>
      <p class="wnj-sub" data-w="sub"></p>
    </div>
    <div class="wnj-filters" role="group" aria-label="Filtrer par type" data-w="filters"></div>
    <button class="wnj-close" type="button" data-w="close" aria-label="Fermer">${ICON_CLOSE}</button>
  </header>
  <div class="wnj-scroll" data-w="scroll"></div>
</aside>`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function setupWhatsNewJournal(dialog: HTMLDialogElement, actions: JournalActions) {
  dialog.className = 'wnj';
  dialog.setAttribute('aria-labelledby', 'wnj-title');
  dialog.innerHTML = TEMPLATE;
  const w = <T extends HTMLElement = HTMLElement>(key: string) => dialog.querySelector<T>(`[data-w="${key}"]`)!;

  let filter: Filter = 'all';
  /** Pendant une fermeture « Essayer », `onClose` passe déjà par l'entrée : un seul appel suffit. */
  let tried: WhatsNewEntry | undefined;

  function entryNode(e: WhatsNewEntry, unread: boolean): HTMLElement {
    const art = el('article', `wnj-entry${unread ? '' : ' wnj-seen'}`);
    const date = dayLabel(e.id);
    const when = el('div', 'wnj-date');
    if (date) when.append(el('span', 'wnj-day', date.day), el('span', 'wnj-month', date.month));

    const body = el('div', 'wnj-body');
    const kind = el('p', `wnj-kind wnj-kind-${e.kind}`);
    if (unread) {
      const dot = el('span', 'wnj-dot');
      dot.setAttribute('aria-hidden', 'true');
      kind.append(dot);
    }
    kind.append(KIND_LABEL[e.kind]);
    if (unread) kind.append(el('span', 'wnj-sr', ', non lu'));
    body.append(kind, el('h3', 'wnj-name', e.title), el('p', 'wnj-text', e.text));
    if (e.target) {
      const b = el('button', 'wnj-try');
      b.type = 'button';
      b.textContent = `${e.target.label} →`;
      b.addEventListener('click', () => {
        tried = e;
        dialog.close();
      });
      body.append(b);
    }

    art.append(when, body);
    if (e.art) {
      const thumb = el('div', 'wnj-thumb');
      thumb.setAttribute('aria-hidden', 'true');
      thumb.innerHTML = ART[e.art];
      art.append(thumb);
    }
    return art;
  }

  function section(title: string, entries: WhatsNewEntry[], unread: boolean, withAction: boolean): HTMLElement {
    const sec = el('section', 'wnj-sec');
    const head = el('div', 'wnj-sec-head');
    head.append(el('h3', `wnj-kicker${unread ? ' wnj-kicker-new' : ''}`, title));
    if (withAction) {
      const b = el('button', 'wnj-markall', 'Tout marquer comme vu');
      b.type = 'button';
      b.addEventListener('click', () => {
        actions.onMarkAllRead();
        render();
      });
      head.append(b);
    }
    sec.append(head, ...entries.map((e) => entryNode(e, unread)));
    return sec;
  }

  function render(): void {
    const all = actions.entries();
    const { unread, seen } = splitByRead(filterEntries(all, filter), actions.readMark());
    const unreadTotal = splitByRead(all, actions.readMark()).unread.length;
    const since = actions.visitedAt();
    w('sub').textContent =
      unreadTotal > 0
        ? `${countLabel(unreadTotal)} depuis ta dernière visite${since ? `, le ${new Date(since).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` : ''}.`
        : 'Tu as tout lu.';

    w('filters').replaceChildren(
      ...FILTERS.map((f) => {
        const b = el('button', 'wnj-filter', f.label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(f.id === filter));
        b.addEventListener('click', () => {
          filter = f.id;
          render();
        });
        return b;
      }),
    );

    const parts: HTMLElement[] = [];
    if (unread.length) parts.push(section('Depuis ta dernière visite', unread, true, unreadTotal > 0));
    if (seen.length) parts.push(section('Déjà vu', seen, false, false));
    if (!parts.length) parts.push(el('p', 'wnj-empty', 'Rien dans cette catégorie.'));
    w('scroll').replaceChildren(...parts);
  }

  w('close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close(); // un toucher sur la partie assombrie
  });
  dialog.addEventListener('close', () => {
    const entry = tried;
    tried = undefined;
    actions.onClose();
    if (entry) actions.onTry(entry);
  });

  return {
    get isOpen() {
      return dialog.open;
    },
    open(): void {
      if (dialog.open) return;
      filter = 'all';
      render();
      w('scroll').scrollTop = 0;
      dialog.showModal();
      w('close').focus();
    },
    close(): void {
      if (dialog.open) dialog.close();
    },
  };
}

export type WhatsNewJournal = ReturnType<typeof setupWhatsNewJournal>;
