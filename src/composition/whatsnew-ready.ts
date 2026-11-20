import { WhatsNew } from '../app/whats-new';
import type { WhatsNewMarks } from '../app/whats-new-marks';
import { WHATS_NEW, type WhatsNewEntry } from '../domain/whatsnew/entries';
import { SettingsStore } from '../app/settings-store';
import { lazyWhatsNew } from '../ui/whatsnew/lazy-whats-new';
import { byId as $ } from '../ui/shared/dom';
import type { Wiring } from './wiring';

/** Ce que `whatsnew.ts` demande à cette partie, chargée à la demande. */
export interface WhatsNewReady {
  openJournal(): void;
  /** La première synchronisation est passée (ou son délai) : pose les repères, note la visite, ouvre la carte s'il y a lieu. */
  arrive(): void;
}

/**
 * Le reste des nouveautés (docs/design/nouveautes.md) : le catalogue, ce que la carte présente et son ouverture. Chargé à
 * la demande par `whatsnew.ts` (après la première synchronisation, ou au toucher de la pastille) : le lancement ne porte
 * que les repères, qui doivent rejoindre la synchronisation d'emblée, et la pastille.
 */
export function composeWhatsNewReady(w: Wiring, marks: WhatsNewMarks, chip: { setUnread(unread: boolean): void }): WhatsNewReady {
  const whatsNew = new WhatsNew({
    marks,
    entries: WHATS_NEW,
    now: () => Date.now(),
    // L'appareil a déjà servi : des réglages, des appareils ou des séances sont gardés. Sans cela, une installation neuve et
    // un utilisateur qui a la fonction pour la première fois se ressembleraient.
    existingUser: () => [SettingsStore.KEYS.ftp, SettingsStore.KEYS.mass, 'mamoulinette.devices', 'mamoulinette.workouts', 'mamoulinette.course'].some((k) => w.prefs.getItem(k) !== null),
  });

  const go = (entry: WhatsNewEntry) => {
    if (entry.target) w.router.go(entry.target.view);
  };

  /** Date de la visite d'avant celle-ci : `noteVisit()` écrase celle de l'appareil dès le lancement, la carte et le journal parlent de la précédente. */
  let visitedAt: number | undefined;

  // La carte et le journal : chargés à la demande (ui/whatsnew/lazy-whats-new.ts).
  const views = lazyWhatsNew(
    { card: $<HTMLDialogElement>('whatsnew-card'), journal: $<HTMLDialogElement>('whatsnew-journal') },
    {
      journal: {
        entries: () => whatsNew.entries,
        readMark: () => whatsNew.readMark,
        visitedAt: () => visitedAt,
        onMarkAllRead: () => whatsNew.acknowledge(),
        onClose: () => whatsNew.acknowledge(),
        onTry: go,
      },
      card: {
        onDismiss: () => whatsNew.acknowledge(),
        onSeeAll: () => {
          whatsNew.announce(); // la carte ne se rouvrira pas ; la lecture suit à la fermeture du journal
          views.openJournal();
        },
        onTry: (entry) => {
          whatsNew.acknowledge();
          go(entry);
        },
      },
    },
  );

  whatsNew.on('changed', () => chip.setUnread(whatsNew.unread));

  // La carte s'ouvre à la première arrivée sur l'accueil, jamais pendant une sortie ni sur une autre boîte de dialogue.
  let arrived = false;
  let offered = false;

  function offer(): void {
    if (!arrived || offered) return;
    if (w.router.current() !== 'accueil' || w.rideSession.active || document.querySelector('dialog[open]')) return;
    offered = true;
    const selection = whatsNew.pending();
    if (selection) views.showCard({ selection, visitedAt, now: Date.now() });
  }
  addEventListener('hashchange', offer);
  w.rideSession.on('stopped', offer);

  return {
    openJournal: () => views.openJournal(),
    arrive() {
      if (arrived) return;
      whatsNew.start();
      visitedAt = whatsNew.visitedAt;
      whatsNew.noteVisit();
      arrived = true;
      offer();
    },
  };
}
