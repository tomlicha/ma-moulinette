import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './whatsnew.css';
import type { WhatsNewEntry } from '../../domain/whatsnew/entries';
import type { Selection } from '../../domain/whatsnew/unseen';
import { ART, ICON, ICON_ARROW, ICON_CLOSE } from './whats-new-art';
import { KIND_LABEL, countLabel, sinceLabel } from './whats-new-model';

/**
 * La carte des nouveautés (N1, docs/design/nouveautes.md) : une boîte de dialogue qui s'ouvre une fois après une mise à
 * jour, posée sur l'accueil flouté. Le héros, trois lignes « Et aussi », « Tout voir » et « C'est parti ». Elle affiche et
 * signale des intentions ; quoi marquer comme vu, c'est `WhatsNew`.
 */

export interface CardActions {
  /** Fermée par « C'est parti », la croix, Échap ou un toucher à côté : tout est acquitté. */
  onDismiss(): void;
  /** « Tout voir » : la carte se ferme, le journal s'ouvre. */
  onSeeAll(): void;
  /** « Essayer » : la carte se ferme (tout est acquitté) puis on va là où l'entrée mène. */
  onTry(entry: WhatsNewEntry): void;
}

export interface CardContext {
  selection: Selection;
  /** Date (ms) de la dernière visite sur cet appareil, si elle est connue. */
  visitedAt?: number;
  now: number;
}

/** Combien de lignes « Et aussi » : la carte reste courte, le reste est dans le journal. */
const ALSO_MAX = 3;

// Gabarit statique : aucune donnée n'y est écrite, le contenu passe par textContent.
const TEMPLATE = `
<div class="wn-card">
  <header class="wn-head">
    <p class="wn-eyebrow">Nouveautés<span class="wn-since" data-w="since"></span></p>
    <h2 id="wn-card-title" class="wn-title">Depuis ta dernière visite</h2>
    <p class="wn-sub" data-w="sub"></p>
    <button class="wn-close" type="button" data-w="close" aria-label="Fermer">${ICON_CLOSE}</button>
  </header>
  <div class="wn-art" data-w="art"><span class="wn-badge" data-w="badge"></span></div>
  <section class="wn-hero" aria-labelledby="wn-hero-title">
    <h3 id="wn-hero-title" class="wn-hero-title" data-w="heroTitle"></h3>
    <p class="wn-hero-text" data-w="heroText"></p>
    <button class="wn-try" type="button" data-w="try"><span data-w="tryLabel"></span>${ICON_ARROW}</button>
  </section>
  <section class="wn-also" data-w="also" aria-labelledby="wn-also-title">
    <h3 id="wn-also-title" class="wn-kicker">Et aussi</h3>
    <ul data-w="alsoList"></ul>
  </section>
  <footer class="wn-foot">
    <button class="wn-all" type="button" data-w="all"><span data-w="allLabel"></span>${ICON_ARROW}</button>
    <button class="wn-go" type="button" data-w="go">C'est parti</button>
  </footer>
</div>`;

export function setupWhatsNewCard(dialog: HTMLDialogElement, actions: CardActions) {
  dialog.className = 'wn';
  dialog.setAttribute('aria-labelledby', 'wn-card-title');
  dialog.innerHTML = TEMPLATE;
  const w = <T extends HTMLElement = HTMLElement>(key: string) => dialog.querySelector<T>(`[data-w="${key}"]`)!;

  /** Ce que la carte fait à sa fermeture : une seule issue, la première gestuelle (sinon : acquitter). */
  let outcome: (() => void) | undefined;
  let hero: WhatsNewEntry | undefined;

  const close = (then: () => void) => {
    outcome = then;
    dialog.close();
  };

  w('close').addEventListener('click', () => close(actions.onDismiss));
  w('go').addEventListener('click', () => close(actions.onDismiss));
  w('all').addEventListener('click', () => close(actions.onSeeAll));
  w('try').addEventListener('click', () => {
    const entry = hero;
    if (entry) close(() => actions.onTry(entry));
  });
  // Un toucher sur le fond (le dialogue couvre toute la page, la carte est dedans).
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(actions.onDismiss);
  });
  dialog.addEventListener('close', () => {
    const then = outcome ?? actions.onDismiss; // Échap
    outcome = undefined;
    then();
  });

  return {
    get isOpen() {
      return dialog.open;
    },

    show({ selection, visitedAt, now }: CardContext): void {
      if (dialog.open) return;
      hero = selection.featured;
      const since = visitedAt === undefined ? '' : sinceLabel(visitedAt, now);
      w('sub').textContent = [since && `Dernière visite : ${since}`, countLabel(selection.total)].filter(Boolean).join(' · ');
      w('since').textContent = since ? ` · ${since}` : '';

      // Sans illustration, la grande icône de l'entrée tient la place.
      w('art').querySelectorAll(':scope > svg, :scope > .wn-art-ico').forEach((s) => s.remove());
      if (hero.art) w('art').insertAdjacentHTML('afterbegin', ART[hero.art]);
      else w('art').insertAdjacentHTML('afterbegin', `<span class="wn-art-ico">${ICON[hero.icon]}</span>`);
      w('art').dataset.empty = hero.art ? 'false' : 'true';
      w('badge').textContent = KIND_LABEL[hero.kind];
      w('heroTitle').textContent = hero.title;
      w('heroText').textContent = hero.text;
      w('try').hidden = !hero.target;
      w('tryLabel').textContent = hero.target?.label ?? '';

      const also = selection.rest.slice(0, ALSO_MAX);
      w('also').hidden = also.length === 0;
      w('alsoList').replaceChildren(
        ...also.map((e) => {
          const li = document.createElement('li');
          const ico = document.createElement('span');
          ico.className = 'wn-ico';
          ico.innerHTML = ICON[e.icon];
          const txt = document.createElement('span');
          txt.className = 'wn-also-txt';
          const b = document.createElement('b');
          b.textContent = e.title;
          const sm = document.createElement('span');
          sm.className = 'wn-also-sub';
          sm.textContent = e.text;
          txt.append(b, sm);
          li.append(ico, txt);
          return li;
        }),
      );
      // « Tout voir (8) » : le total, héros compris ; sans autre entrée, le journal garde son intérêt (l'historique).
      w('allLabel').textContent = `Tout voir (${selection.total})`;
      outcome = undefined;
      dialog.showModal();
      w('go').focus();
    },

    close(): void {
      if (dialog.open) close(actions.onDismiss);
    },
  };
}

export type WhatsNewCard = ReturnType<typeof setupWhatsNewCard>;
