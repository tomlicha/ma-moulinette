import type { CardActions, CardContext, WhatsNewCard } from './whats-new-card';
import type { JournalActions, WhatsNewJournal } from './whats-new-journal';

/**
 * La carte et le journal des nouveautés chargés à la demande : la carte ne s'ouvre qu'une fois après une mise à jour, le
 * journal sur un toucher. Leur code, leurs dessins et leur feuille de style ne pèsent pas sur le lancement (budget :
 * tools/ci/bundle-budget.mjs). Seule la pastille de l'accueil (`whats-new-chip.ts`) reste dans le lancement.
 */
export interface LazyWhatsNew {
  /** Ouvre la carte (la charge la première fois). */
  showCard(context: CardContext): void;
  /** Ouvre le journal (le charge la première fois). */
  openJournal(): void;
}

export function lazyWhatsNew(
  dialogs: { card: HTMLDialogElement; journal: HTMLDialogElement },
  actions: { card: CardActions; journal: JournalActions },
): LazyWhatsNew {
  let card: Promise<WhatsNewCard> | undefined;
  let journal: Promise<WhatsNewJournal> | undefined;
  const loadCard = () => (card ??= import('./whats-new-card').then((m) => m.setupWhatsNewCard(dialogs.card, actions.card)));
  const loadJournal = () => (journal ??= import('./whats-new-journal').then((m) => m.setupWhatsNewJournal(dialogs.journal, actions.journal)));
  return {
    showCard: (context) => void loadCard().then((c) => c.show(context)),
    openJournal: () => void loadJournal().then((j) => j.open()),
  };
}
