import type { NetPosition } from '../domain/course/track';
import { COL_DES_ERABLES } from '../domain/course/courses/col-des-erables';
import { GearsView } from '../ui/ride/gears-view';
import { Journey } from '../domain/sim/journey';
import { RideControlsView } from '../ui/ride/ride-controls-view';
import { RideSession } from '../app/ride-session';
import { RideViewLoader } from '../app/ride-view-loader';
import { VirtualGearbox } from '../app/virtual-gearbox';
import { byId as $ } from '../ui/shared/dom';
import type { Wiring } from './wiring';

export function composeRide(w: Wiring): void {
  w.startRide = startRide;
  w.startRideBehind = startRideBehind;
  w.stopRide = stopRide;

  /** Le trajet de la page : la simulation, la vue 3D et le HUD le partagent ; il repart du village à chaque sortie. */
  const journey = new Journey(COL_DES_ERABLES);
  w.journey = journey;

  /** La sortie virtuelle : son cycle de vie et son pas de 100 ms. Le reste de la page s'abonne à ses événements. */
  const rideSession = new RideSession({
    journey,
    readings: w.readings,
    grade: w.grade,
    trainer: w.trainerCtl,
    gearing: () => gearbox.state(),
    riders: () => w.world.riders(),
    assist: () => w.follow.assist,
  });
  w.rideSession = rideSession;

  /** La vue 3D : construite en tâche de fond dès l'ouverture, refaite après une perte du GPU. L'affichage s'y abonne plus bas. */
  const rideViews = new RideViewLoader({
    rideScreenOpen: () => w.router.current() === 'sortie',
    create: async ({ forceWebGL, background, onProgress }) => {
      const { RideView } = await import('../render/ride-view');
      return RideView.create(
        $<HTMLCanvasElement>('view'),
        journey,
        {
          onProgress,
          forceWebGL: forceWebGL || w.params.get('renderer') === 'webgl2',
          quality: w.quality,
          dynamicResolution: w.params.get('resolution') !== 'fixed',
          ...(w.relief !== undefined ? { relief: w.relief } : {}),
        },
        background,
      );
    },
  });
  w.rideViews = rideViews;

  function startRide() {
    w.autoStart.disarm();
    rideSession.start(w.riderInputs.rideMassKg, w.home.selectedCourseId());
  }

  function startRideBehind(pos: NetPosition) {
    w.autoStart.disarm();
    rideSession.start(w.riderInputs.rideMassKg, w.home.selectedCourseId(), pos);
  }

  function stopRide(resetTrainer = true) {
    rideSession.stop(resetTrainer);
  }

  /** Le cycliste à l'arrêt (sortie en pause ou terminée) : la vue et la salle le voient immobile à sa place. */
  function showRiderStill(distanceM: number) {
    rideViews.view?.setState({ distanceM, speedKmh: 0, cadenceRpm: 0, powerW: 0, ftpW: 0 });
    w.world.update({ pos: journey.locate(distanceM), speedMs: 0, powerW: 0, cadenceRpm: 0, riding: false }, true);
  }

  rideSession.on('started', (massKg) => {
    rideControls.showRideActive(true);
    w.riderInputs.lockMass(true);
    w.setState(w.trainerCtl.state, w.trainerCtl.name);
    w.log(`sortie virtuelle démarrée (${massKg} kg)`);
  });

  rideSession.on('tick', ({ snapshot: s, powerW, cadenceRpm }) => {
    w.exporter.onRide(s);
    rideViews.view?.setState({ distanceM: s.distanceM, speedKmh: s.speedKmh, cadenceRpm, powerW, ftpW: w.readFtp() });
    w.world.update({ pos: journey.locate(s.distanceM), speedMs: s.speedKmh / 3.6, powerW, cadenceRpm, riding: true });
  });

  rideSession.on('paused', (distanceM) => {
    showRiderStill(distanceM);
    w.log('trainer perdu : sortie en pause, elle reprend à la reconnexion');
  });

  rideSession.on('resumed', () => w.log('trainer reconnecté : sortie reprise'));

  rideSession.on('stopped', (distanceM) => {
    showRiderStill(distanceM);
    rideControls.showRideActive(false);
    w.riderInputs.lockMass(false);
    w.log('sortie virtuelle arrêtée');
    w.setState(w.trainerCtl.state, w.trainerCtl.name);
  });

  /** Démarrer la sortie, ou l'arrêter : un arrêt volontaire, hors séance, fige la sortie et ouvre son récapitulatif (docs/design/recap.md). */
  function toggleRide() {
    if (!rideSession.active) return startRide();
    stopRide();
    if (w.workoutSession.running) return;
    w.exporter.onRideStopped();
    w.offerRecap();
  }

  /** Les commandes de la sortie : démarrer, ERG, pente (ride-controls-view.ts). */
  const rideControls = new RideControlsView(
    {
      toggleRide,
      toggleErg: (targetW, gradePct) => void w.manual.toggleErg(targetW, gradePct),
      retargetErg: (targetW) => w.manual.retargetErg(targetW),
      sendGrade: (gradePct) => void w.manual.setGrade(gradePct),
    },
    () => w.router.go('appareils'),
  );
  w.rideControls = rideControls;

  /** Les vitesses virtuelles du Zwift Cog : la règle et la mémoire dans app/virtual-gearbox.ts, les boutons et le clavier dans GearsView. */
  const gearbox = new VirtualGearbox(w.prefs);

  const gearsView = new GearsView(
    {
      toggle: $<HTMLInputElement>('cog-toggle'),
      ringRow: $('cog-ring-row'),
      ring: $<HTMLInputElement>('cog-ring'),
      shifter: $('ride-gears'),
      up: $<HTMLButtonElement>('gear-up'),
      down: $<HTMLButtonElement>('gear-down'),
      out: $('gear-out'),
    },
    {
      setEnabled: (enabled) => gearbox.setEnabled(enabled),
      setChainring: (teeth) => gearbox.setChainring(teeth),
      shift: (by) => gearbox.shift(by),
      keysActive: () => gearbox.state().enabled && w.router.current() === 'sortie' && !document.querySelector('dialog[open]'),
    },
  );

  gearbox.on('changed', (s, why) => {
    gearsView.render(s, gearbox.chainring);
    // Le changement doit se sentir tout de suite : la prochaine mise à jour de la sortie renvoie la pente sans attendre.
    w.grade.setVirtualGears(s.enabled);
    if (why === 'shift') w.log(`vitesse ${s.gear} (braquet ${s.virtualRatio.toFixed(2)})`);
    else w.log(s.enabled ? `Zwift Cog : vitesses virtuelles actives, braquet réel ${s.realRatio.toFixed(2)}` : 'Zwift Cog : vitesses virtuelles coupées');
  });

  gearsView.render(gearbox.state(), gearbox.chainring);

  if (gearbox.state().enabled) w.grade.setVirtualGears(true);
}
