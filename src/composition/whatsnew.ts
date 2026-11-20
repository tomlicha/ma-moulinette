import { WhatsNewMarks } from '../app/whats-new-marks';
import { setupNewsChip } from '../ui/whatsnew/whats-new-chip';
import { byId as $ } from '../ui/shared/dom';
import type { WhatsNewReady } from './whatsnew-ready';
import type { Wiring } from './wiring';

/** Attente de la première synchronisation avant de décider de la carte : au-delà, on décide avec ce que l'appareil sait. */
const SYNC_WAIT_MS = 3000;

/**
 * Les nouveautés depuis la dernière visite (docs/design/nouveautes.md). Ici, ce qui doit exister dès le lancement : les
 * repères de lecture, dont la source de synchronisation s'ajoute à celles du module `account` (qui doit donc passer avant),
 * et la pastille de l'accueil. Le catalogue, la carte et le journal sont chargés à la demande (`whatsnew-ready.ts`) :
 * après la première synchronisation, ou au toucher de la pastille. Le budget du lancement l'exige (tools/ci/bundle-budget.mjs).
 */
export function composeWhatsNew(w: Wiring): void {
  const marks = new WhatsNewMarks(w.prefs, w.syncJournal);
  w.syncSources.push(marks);

  const chip = setupNewsChip($<HTMLButtonElement>('home-news-chip'), () => void ready().then((r) => r.openJournal()));
  chip.setUnread(false);

  let late: Promise<WhatsNewReady> | undefined;
  const ready = () => (late ??= import('./whatsnew-ready').then((m) => m.composeWhatsNewReady(w, marks, chip)));

  // Après la première synchronisation (le compte a pu apporter des repères posés sur un autre appareil), ou son délai.
  const wait = new Promise<void>((resolve) => setTimeout(resolve, SYNC_WAIT_MS));
  void Promise.race([w.accountSettled, wait])
    .then(ready)
    .then((r) => r.arrive());
}
