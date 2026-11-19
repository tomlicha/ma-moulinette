import { AutoStart } from '../app/auto-start';
import { BlockLibrary } from '../domain/workout/block-library';
import { ManualControl } from '../app/manual-control';
import { WorkoutCatalog } from '../app/workout-catalog';
import { WorkoutControlsView } from '../ui/ride/workout-controls-view';
import { WorkoutLibrary } from '../domain/workout/library';
import { WorkoutSession } from '../app/workout-session';
import { formatDuration } from '../ui/shared/duration';
import { lazyWorkoutEditor } from '../ui/editor/lazy-editor';
import { nextIntervalGate } from '../domain/workout/gate';
import type { BlockReason } from '../ui/shared/blocked';
import type { Wiring } from './wiring';

export function composeWorkout(w: Wiring): void {
  w.refreshWorkoutButtons = refreshWorkoutButtons;
  w.refreshWorkoutChoices = refreshWorkoutChoices;
  w.chooseWorkout = chooseWorkout;
  w.ftpChanged = ftpChanged;

  const fmtTime = (s: number) => formatDuration(Math.floor(s));

  /** La séance structurée : la séance choisie, son déroulement et la consigne ERG qu'elle impose au trainer. */
  const workoutSession = new WorkoutSession({
    trainer: w.trainerCtl,
    ftpW: () => w.readFtp(),
    rideActive: () => w.rideSession.active,
    manualGradePct: () => w.rideControls.manualGradePct,
    log: w.log,
  });
  w.workoutSession = workoutSession;

  /** Démarrage au premier coup de pédale, sur l'écran Sortie (app/auto-start.ts). */
  const autoStart = new AutoStart({
    rideSession: w.rideSession,
    workoutSession,
    trainer: w.trainerCtl,
    rideScreenOpen: () => w.router.current() === 'sortie',
    workoutBlocked: () => workoutStartBlock() !== undefined,
    startWorkout: () => startWorkout(),
    startRide: () => w.startRide(),
    log: w.log,
  });
  w.autoStart = autoStart;

  /** Les commandes de la séance : liste de l'accueil, démarrage, pause, palier, intensité (workout-controls-view.ts). */
  const workoutControls = new WorkoutControlsView({
    choose: (value) => chooseWorkout(value),
    start: () => startWorkout(),
    startFromHome: () => {
      w.router.go('sortie');
      startWorkout();
    },
    togglePause: () => workoutSession.togglePause(),
    skip: () => workoutSession.skip(),
    stop: () => workoutSession.stop(),
    adjustIntensity: (delta) => workoutSession.adjustIntensity(delta),
  });
  w.workoutControls = workoutControls;

  /** ERG et pente demandés à la main, selon ce qui tourne (app/manual-control.ts). */
  const manual = new ManualControl({ trainer: w.trainerCtl, rideSession: w.rideSession, workoutSession, log: w.log });
  w.manual = manual;

  /** Appelé par l'écran Séances quand « Rouler » doit se remettre à jour (affecté une fois l'éditeur créé). */
  // Affecté plus bas, une fois l'éditeur créé : lu avant par des fonctions déjà déclarées.
  // eslint-disable-next-line prefer-const
  let refreshEditorRide: (() => void) | undefined;

  /** Ce qui empêche de démarrer une séance, hors le choix de la séance : séance déjà en cours, trainer absent ou sans ERG. */
  function workoutStartBlock(): string | BlockReason | undefined {
    const canErg = w.trainerCtl.canErg;
    return workoutSession.running
      ? 'La séance est déjà en cours.'
      : !w.trainerCtl.connected
        ? w.needTrainer('La séance pilote la résistance de ton home trainer : connecte-le d’abord.')
        : !canErg
          ? w.noControl('mode ERG')
          : undefined;
  }

  function refreshWorkoutButtons() {
    const { runner, workout } = workoutSession;
    const startReason = !workout && !runner ? 'Choisis d’abord une séance dans la liste.' : workoutStartBlock();
    workoutControls.render({ running: !!runner, paused: workoutSession.paused, startReason });
    refreshEditorRide?.();
  }

  /** Le profil de la séance choisie, sur l'accueil. */
  const renderProfile = () => workoutControls.showProfile(workoutSession.workout, w.readFtp());

  /** Les séances que l'on peut choisir : les nôtres et les modèles livrés. La liste de l'accueil les montre. */
  function refreshWorkoutChoices() {
    const { mine, samples } = catalog.choices();
    workoutControls.showChoices(mine, samples);
  }

  function chooseWorkout(value: string) {
    if (workoutSession.running) {
      w.log("séance en cours : l'arrêter avant d'en choisir une autre");
      return;
    }
    workoutControls.setChoice(value);
    const chosen = value ? catalog.resolve(value) : undefined;
    workoutSession.select(chosen);
    workoutControls.showWorkoutName(chosen);
    if (!chosen) {
      renderProfile();
      refreshWorkoutButtons();
      return;
    }
    autoStart.arm();
    for (const x of chosen.warnings) w.log(`séance : ${x}`);
    const total = chosen.steps.reduce((t, s) => t + s.durationS, 0);
    renderProfile();
    refreshWorkoutButtons();
    w.log(`séance choisie : ${chosen.name} (${chosen.steps.length} paliers, ${fmtTime(total)})`);
  }

  // L'état de la séance est affiché par le HUD (palier, profil, curseur, message) ; ici, seule la porte 3D du palier suivant.
  workoutSession.on('state', (s) => {
    // Porte du palier suivant, dans la scène 3D (docs/design/hud.md) : seulement en séance, sortie en cours.
    const live = w.rideSession.snapshot;
    const runner = workoutSession.runner;
    w.rideViews.view?.setGate(runner && s && live ? nextIntervalGate(s, runner.ftpW, live.speedKmh, workoutSession.paused) : undefined);
  });

  workoutSession.on('changed', refreshWorkoutButtons);

  workoutSession.on('intensity', (fraction) => workoutControls.showIntensity(fraction));

  workoutSession.on('started', (name) => w.exporter.onWorkoutStarted(name));

  workoutSession.on('stepped', (targetW, stepIndex) => w.exporter.onWorkoutState(targetW, stepIndex));

  workoutSession.on('completing', () => w.exporter.onWorkoutFinished());

   // l'export s'arrêtera à la fin du dernier palier (app/ride-export.ts)
  workoutSession.on('ended', ({ completed }) => {
    if (completed) w.offerRecap(completed);
  });

  function startWorkout() {
    if (!workoutSession.workout) return;
    autoStart.disarm();
    // La séance se roule sur le parcours : sans sortie en cours, le cycliste resterait immobile dans la vue.
    if (!w.rideSession.active && w.trainerCtl.connected) w.startRide();
    workoutSession.start();
  }

  /** La FTP a changé (ici ou sur un autre appareil) : séance en cours, profil et éditeur suivent. */
  function ftpChanged() {
    workoutSession.setFtp(w.readFtp());
    renderProfile();
    editor.refresh();
  }

  // --- Écrans, appareils connus et reconnexion au lancement ---

  const library = new WorkoutLibrary(w.prefs, undefined, w.syncJournal);
  w.library = library;

  const blockLibrary = new BlockLibrary(w.prefs, undefined, w.syncJournal);
  w.blockLibrary = blockLibrary;

  /** Les séances que l'on peut choisir pour rouler : les nôtres et les modèles (app/workout-catalog.ts). */
  const catalog = new WorkoutCatalog({ library, log: w.log });

  /** L'éditeur de la page Séances, chargé à la première arrivée sur l'écran (ui/editor/lazy-editor.ts). */
  const editor = lazyWorkoutEditor({
    library,
    blocks: blockLibrary,
    readFtp: w.readFtp,
    log: w.log,
    onLibraryChange: refreshWorkoutChoices,
    currentChoice: () => workoutControls.choice,
    // Pendant une séance, le choix reste celui de la séance en cours : on ne le change pas en parcourant la bibliothèque.
    onFocus: (key) => {
      if (!workoutSession.running) chooseWorkout(key);
    },
    onRide: (key) => {
      w.router.go('sortie');
      chooseWorkout(key);
      startWorkout();
    },
    rideBlock: workoutStartBlock,
  });
  w.editor = editor;

  refreshEditorRide = editor.refreshRide;

  refreshWorkoutChoices();
}
