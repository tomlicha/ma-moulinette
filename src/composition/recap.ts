import { ExportButtons, browserExportPlatform } from '../ui/ride/export-buttons';
import { RideExport } from '../app/ride-export';
import { SAMPLE_WORKOUTS } from '../domain/workout/samples';
import { parseWorkout } from '../domain/workout/runner';
import { setupRecap } from '../ui/recap/recap';
import { summarize } from '../ui/recap/recap-model';
import { byId as $ } from '../ui/shared/dom';
import type { Workout } from '../domain/workout/model';
import type { Wiring } from './wiring';

export function composeRecap(w: Wiring): void {
  w.offerRecap = offerRecap;

  // Avant le routeur, qui applique l'écran courant dès sa création et ferme le récapitulatif hors de la Sortie.
  const recap = setupRecap($<HTMLDialogElement>('recap'), {
    send: (name) => exporter.sendToStrava(name),
    downloadFit: () => void exporter.downloadFit(),
    // Après un arrêt de la sortie, « Reprendre la sortie » la relance ; après une séance, elle n'a jamais cessé.
    // Un envoi programmé est déjà parti avec la sortie figée ; sinon, l'export suivant couvrira toute la sortie.
    onContinue: () => {
      exporter.releaseFrozen();
      if (!w.rideSession.active && w.trainerCtl.connected) w.startRide();
    },
    onFinish: () => {
      w.stopRide();
      w.router.go('accueil');
    },
  });
  w.recap = recap;

  /** L'export de la sortie : enregistrement, fichier FIT, envoi à Strava. */
  const exporter = new RideExport({ hub: w.hub, routeName: w.journey.name, log: w.log, platform: browserExportPlatform });
  w.exporter = exporter;

  // Arrêt puis 5 s de pédalage après la fin : le récapitulatif s'efface de lui-même (docs/design/recap.md).
  exporter.on('resumed', () => {
    if (!recap.open) return;
    w.log('pédalage repris : récapitulatif fermé');
    recap.dismissByPedaling();
  });

  new ExportButtons(exporter, $<HTMLButtonElement>('export-fit'), $<HTMLButtonElement>('export-strava'));

  exporter.start();

  /** Récapitulatif de fin de sortie : après une séance menée au bout, ou une sortie arrêtée à la main. */
  function offerRecap(done?: { workout: Workout; ftpW: number }) {
    const rec = exporter.current();
    if (!rec || w.router.current() !== 'sortie') return;
    const ftpW = done?.ftpW ?? w.readFtp();
    w.rideMenu.close();
    recap.show({
      summary: summarize(rec, { ftpW, ...(done ? { workout: done.workout } : {}) }),
      eyebrow: done ? 'Séance terminée' : 'Sortie terminée',
      title: done?.workout.name ?? w.journey.name,
      place: w.journey.name,
      startMs: rec.startMs,
      defaultName: exporter.defaultName(),
      strava: exporter.strava(),
      rideRunning: w.rideSession.active,
    });
    w.log(`récapitulatif : ${Math.round(rec.timerS)} s, Strava ${exporter.strava()}`);
  }

  // Aperçu du récapitulatif sans rouler, en développement seulement (voir ui/recap/recap-demo.ts) : ?recap, ?recap=libre…
  if (import.meta.env.DEV && w.params.has('recap')) {
    const sample = SAMPLE_WORKOUTS.find((s) => s.id === 'sweet-spot')!;
    void import('../ui/recap/recap-demo').then((m) => {
      w.router.go('sortie');
      m.showRecapDemo($('recap').parentElement!, w.params.get('recap') ?? '', parseWorkout(sample.fileName, sample.text), w.readFtp(), w.journey.name);
    });
  }
}
