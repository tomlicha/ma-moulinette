import type { OnlineActions, OnlinePanel } from './online-panel';

/**
 * Le panneau « Rouler avec d'autres » chargé à la demande : son code et sa feuille de style ne pèsent pas sur le lancement
 * (budget : tools/ci/bundle-budget.mjs). Seule la pastille de l'accueil (`online-chip.ts`) reste dans le lancement.
 */
export interface LazyOnline {
  /** Ouvre le panneau (le charge la première fois). */
  open(): void;
  /** Le panneau chargé, pour lui donner la liste ; `undefined` tant qu'il ne l'a pas été. */
  readonly panel: OnlinePanel | undefined;
  /** Appelle `fn` avec le panneau, tout de suite s'il est chargé, sinon dès qu'il l'est (sans le charger). */
  whenLoaded(fn: (panel: OnlinePanel) => void): void;
}

export function lazyOnline(
  dialog: HTMLDialogElement,
  actions: OnlineActions,
  env: { serverNow: () => number; courseName: (id: string) => string },
  /** Ce qu'il faut redire au panneau quand il vient d'être chargé (blocage, séance prévue, groupe). */
  prime: (panel: OnlinePanel) => void,
): LazyOnline {
  let loaded: OnlinePanel | undefined;
  let loading: Promise<OnlinePanel> | undefined;
  const load = () =>
    (loading ??= import('./online-panel').then((m) => {
      loaded = m.setupOnlinePanel(dialog, actions, env);
      prime(loaded);
      return loaded;
    }));
  return {
    open: () => void load().then((p) => p.open()),
    get panel() {
      return loaded;
    },
    whenLoaded: (fn) => {
      if (loaded) fn(loaded);
    },
  };
}
