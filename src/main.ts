import { installNativeBluetooth } from './infra/sensors/ble/native-bluetooth';
import { isNativeShell, Moulinette } from './infra/native/shell';
import { createKeepAwake } from './ui/shared/keep-awake';
import { openDeviceChooser } from './ui/devices/device-chooser';
import { SensorHub } from './infra/sensors/hub';
import { SimulatedTrainer } from './infra/sensors/simulator';
import { WebBluetoothTrainer } from './infra/sensors/ble/web-bluetooth';
import { webBluetoothAvailable } from './infra/sensors/ble/gatt-device';
import { browserUa, noBluetoothHint, noBluetoothStatus } from './infra/sensors/ble/bluetooth-support';
// Vue 3D chargée à la demande (`buildView`) : three.js n'est pas dans le JS du lancement.
import { chooseQuality } from './render/core/quality';
import { setupGears } from './ui/ride/gears';
import { RideExport } from './app/ride-export';
import { browserExportPlatform, ExportButtons } from './ui/ride/export-buttons';
import { setupTelemetry } from './infra/telemetry/wiring';
import { COL_DES_ERABLES } from './domain/course/courses/col-des-erables';
import { Journey } from './domain/sim/journey';
import type { ConnectionState } from './infra/sensors/types';
import type { Workout } from './domain/workout/model';
import { parseWorkout } from './domain/workout/runner';
import { nextIntervalGate } from './domain/workout/gate';
import { DeviceRegistry } from './infra/sensors/device-registry';
import { browserStore } from './infra/storage/key-value-store';
import { PROTOCOL_LABEL } from './infra/sensors/protocols/trainer-profiles';
import { formatDuration } from './ui/shared/duration';
import { setupBlockedHints, type BlockReason } from './ui/shared/blocked';
import { setupRouter } from './ui/shared/router';
import { GradeController } from './app/grade-controller';
import { RideSession } from './app/ride-session';
import { RideViewLoader } from './app/ride-view-loader';
import { WorkoutSession } from './app/workout-session';
import { DeviceManager } from './app/device-manager';
import { ManualControl } from './app/manual-control';
import { RiderSettingsSync } from './app/rider-settings-sync';
import { WorkoutCatalog } from './app/workout-catalog';
import { SensorReadings } from './app/sensor-readings';
import { SettingsStore } from './app/settings-store';
import { TrainerController } from './app/trainer-controller';
import { setupRiderProfile } from './ui/devices/rider-profile';
import { setupWheel } from './ui/shared/wheel-picker';
import { setupAppShell } from './ui/shared/app-shell';
import { setupWorkoutEditor } from './ui/editor/workout-editor';
import { RideHud } from './ui/ride/hud';
import { RiderInputs } from './ui/ride/rider-inputs';
import { HomeView } from './ui/home/home-view';
import { RideControlsView } from './ui/ride/ride-controls-view';
import { WorkoutControlsView } from './ui/ride/workout-controls-view';
import { needTrainer as needTrainerReason, noControl as noControlReason } from './ui/ride/trainer-reasons';
import { DevicesView } from './ui/devices/devices-view';
import { LogView } from './ui/devices/log-view';
import { HudPresenter } from './ui/ride/hud-presenter';
import { RideLoadingView } from './ui/ride/ride-loading-view';
import { CrowdView } from './ui/ride/crowd-view';
import { setupRideMenu } from './ui/ride/ride-menu';
import { setupRecap } from './ui/recap/recap';
import { summarize } from './ui/recap/recap-model';
import { createRadar } from './ui/ride/radar';
import portraitFallback from './assets/rider-portrait.jpg';
import { setupHomeBackground } from './ui/home/home-background';
import { setupAccount } from './ui/account/account-chip';
import { WorldClient } from './infra/net/world-client';
import { RiderTags } from './ui/ride/rider-tags';
import { RidePanel } from './ui/ride/ride-panel';
import { BlockLibrary } from './domain/workout/block-library';
import { WorkoutLibrary } from './domain/workout/library';
import { SAMPLE_WORKOUTS } from './domain/workout/samples';
import { createSyncClient } from './infra/sync/client';
import { SyncJournal } from './infra/sync/journal';
import { blockSource, workoutSource } from './infra/sync/sources';
import { migrateLegacyKeys } from './infra/storage/legacy-storage';

// Données gardées sous l'ancien préfixe `zwift2.` : reprises sous `mamoulinette.` avant toute lecture.
try {
  migrateLegacyKeys(localStorage);
} catch {
  // stockage inaccessible : rien à reprendre
}

// Dans la coquille iOS/Android, Web Bluetooth n'existe pas : le pont natif le fournit (sinon, sans effet).
installNativeBluetooth(openDeviceChooser);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
setupBlockedHints();

/** Raisons « pas de trainer » et « ce trainer ne pilote pas cela », avec le raccourci qui mène à l'écran des appareils. */
const needTrainer = (text: string): BlockReason => needTrainerReason(() => router.go('appareils'), text);
const noControl = (what: string): BlockReason => noControlReason(() => router.go('appareils'), trainerCtl.name, what);

const logView = new LogView();

const hub = new SensorHub();

const prefs = browserStore();
/** FTP, masse et protocole de pilotage gardés sur l'appareil. */
const settings = new SettingsStore(prefs);
/** Journal de synchronisation avec le compte : FTP, masse, séances et blocs y notent chaque modification (src/infra/sync/). */
const syncJournal = new SyncJournal(prefs);
function newBleTrainer(): WebBluetoothTrainer {
  const t = new WebBluetoothTrainer();
  t.forcedProtocol = devicesView.forcedProtocol;
  return t;
}

/** Dernières mesures des capteurs, tant qu'elles sont fraîches (au-delà de 3 s de silence, le cycliste est à l'arrêt). */
const readings = new SensorReadings();
/** Les champs de FTP et de masse du coureur (rider-inputs.ts). */
const riderInputs = new RiderInputs();
/** Pente envoyée au trainer (lissage, braquet virtuel, fréquence d'envoi) et état « ERG engagé » : la consigne de puissance prime sur la pente. */
const grade = new GradeController();
/** Le trainer branché : connexion, état, commandes ERG et pente. */
const trainerCtl = new TrainerController({ hub, grade, log });
// Le journal passe avant tout autre abonné : « trainer : connected » précède ce que les autres en déduisent.
trainerCtl.on('state', (s, d) => log(`trainer : ${s}${d ? ` (${d})` : ''}`));
/** Les appareils : trainer et ceinture cardio, ceux qu'on connaît déjà, et leur reconnexion au lancement. */
const devices = new DeviceManager({ hub, trainer: trainerCtl, registry: new DeviceRegistry(), log, createBleTrainer: newBleTrainer });
/** Le trajet de la page : la simulation, la vue 3D et le HUD le partagent ; il repart du village à chaque sortie. */
const journey = new Journey(COL_DES_ERABLES);
/** La sortie virtuelle : son cycle de vie et son pas de 100 ms. Le reste de la page s'abonne à ses événements. */
const rideSession = new RideSession({
  journey,
  readings,
  grade,
  trainer: trainerCtl,
  gearing: () => gears.state(),
  riders: () => world.riders(),
});
/** La vue 3D : construite en tâche de fond dès l'ouverture, refaite après une perte du GPU. L'affichage s'y abonne plus bas. */
const rideViews = new RideViewLoader({
  rideScreenOpen: () => router.current() === 'sortie',
  create: async ({ forceWebGL, background, onProgress }) => {
    const { RideView } = await import('./render/ride-view');
    return RideView.create(
      $<HTMLCanvasElement>('view'),
      journey,
      {
        onProgress,
        forceWebGL: forceWebGL || params.get('renderer') === 'webgl2',
        quality,
        ...(relief !== undefined ? { relief } : {}),
      },
      background,
    );
  },
});

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

function log(msg: string) {
  logView.append(msg);
  telemetry.record(msg);
}

// Envoie le journal au serveur de logs dès qu'une erreur survient (voir src/infra/telemetry/). `devices.states` n’est lu qu’à l’envoi,
// bien après l'évaluation du module.
const telemetry = setupTelemetry({
  log,
  context: () => {
    const dev = trainerCtl.device;
    return {
      trainer: dev?.name,
      trainerState: trainerCtl.state,
      capabilities: dev?.capabilities,
      trainerIdentity: dev instanceof WebBluetoothTrainer ? dev.identity : undefined,
      heartRateState: devices.states.hr,
      rideRunning: rideSession.active,
    };
  },
});

function setState(s: ConnectionState, detail?: string) {
  exporter.onTrainerState(s);
  devicesView.showTrainerState(s, detail);
  const connected = s === 'connected';
  // Les boutons de connexion sont réglés par renderDevices, plus bas.
  const needPowerToRide = rideControls.render({
    trainerConnected: connected,
    trainerName: trainerCtl.name,
    capabilities: trainerCtl.capabilities,
    rideActive: rideSession.active,
    forcedProtocol: devicesView.forcedProtocol,
  });
  home.setRideBlock(needPowerToRide);
  refreshWorkoutButtons();
  if (s === 'connected') rideSession.resume();
  else {
    // Trainer perdu (écran en veille, montre qui prend le relais…) : la sortie est mise en pause, pas détruite, et
    // l'adaptateur retente la connexion tout seul (essais rapprochés, puis attente de son signal).
    rideSession.pause();
    trainerCtl.setErgActive(false);
  }
  const dev = trainerCtl.device;
  if (connected && dev) {
    const id = dev instanceof WebBluetoothTrainer ? dev.identity : undefined;
    if (id) telemetry.trainer({ profile: id.profile.id, brand: id.profile.brand, label: id.profile.label, ...id.info, protocol: id.protocol, services: id.services });
    devicesView.showCapabilities(dev.capabilities, id);
  }
  renderDevices();
}

// Le trainer change d'état (connexion, perte, reconnexion automatique) : l'écran et la sortie suivent.
trainerCtl.on('state', (s, d) => setState(s, d));
trainerCtl.on('erg', (engaged) => rideControls.showErgEngaged(engaged));

hub.on('log', log);
hub.on('raw', (src, data) => {
  // Les trames brutes servent à documenter chaque modèle de trainer ; on ne journalise pas tout le flux.
  if (src !== 'Indoor Bike Data' && src !== 'Heart Rate' && src !== 'Cycling Power' && src !== 'FE-C' && src !== 'Zwift Data') log(`${src} : ${hex(data)}`);
});
/**
 * Démarrage au premier coup de pédale : sur l'écran Sortie, tant que rien n'a été lancé à la main, la première puissance
 * ou cadence reçue démarre la séance chargée (et la sortie qui la porte), ou la sortie libre s'il n'y en a pas.
 * Armé en arrivant sur l'écran ou en choisissant une séance ; désarmé dès qu'une sortie ou une séance démarre,
 * donc un arrêt volontaire n'est pas défait par le pédalage qui continue.
 */
let autoStart = false;
/** Ne s'arme que si rien ne tourne : revenir sur l'écran en pleine sortie ne doit pas lancer une séance. */
const armAutoStart = () => (autoStart = !rideSession.active && !workoutSession.running);
function maybeAutoStart(m: { powerW?: number; cadenceRpm?: number }) {
  if (!autoStart || workoutSession.running || router.current() !== 'sortie') return;
  if (!((m.powerW ?? 0) > 0 || (m.cadenceRpm ?? 0) > 0)) return;
  if (workoutSession.workout && !workoutStartBlock()) {
    log('premier coup de pédale : démarrage de la séance');
    startWorkout();
  } else if (!rideSession.active && trainerCtl.connected) {
    log('premier coup de pédale : démarrage de la sortie');
    startRide();
  }
}

hub.on('measurement', (m) => {
  maybeAutoStart(m);
  readings.record(m);
});

const fmtTime = (s: number) => formatDuration(Math.floor(s));

// Écran allumé tant qu'on est sur l'application, quel que soit l'écran : pendant une séance ERG, on ne touche pas l'écran.
const keepAwake = createKeepAwake({
  native: isNativeShell() ? Moulinette : undefined,
  wakeLock: (navigator as Navigator & { wakeLock?: Parameters<typeof createKeepAwake>[0]['wakeLock'] }).wakeLock,
  document,
  log: (m) => log(m),
});
void keepAwake.set(true);

function startRide() {
  autoStart = false;
  rideSession.start(riderInputs.rideMassKg, home.selectedCourseId());
}

function stopRide(resetTrainer = true) {
  rideSession.stop(resetTrainer);
}

/** Le cycliste à l'arrêt (sortie en pause ou terminée) : la vue et la salle le voient immobile à sa place. */
function showRiderStill(distanceM: number) {
  rideViews.view?.setState({ distanceM, speedKmh: 0, cadenceRpm: 0, powerW: 0, ftpW: 0 });
  world.update({ pos: journey.locate(distanceM), speedMs: 0, powerW: 0, cadenceRpm: 0, riding: false }, true);
}

rideSession.on('started', (massKg) => {
  rideControls.showRideActive(true);
  riderInputs.lockMass(true);
  setState(trainerCtl.state, trainerCtl.name);
  log(`sortie virtuelle démarrée (${massKg} kg)`);
});
rideSession.on('tick', ({ snapshot: s, powerW, cadenceRpm }) => {
  exporter.onRide(s);
  rideViews.view?.setState({ distanceM: s.distanceM, speedKmh: s.speedKmh, cadenceRpm, powerW, ftpW: readFtp() });
  world.update({ pos: journey.locate(s.distanceM), speedMs: s.speedKmh / 3.6, powerW, cadenceRpm, riding: true });
});
rideSession.on('paused', (distanceM) => {
  showRiderStill(distanceM);
  log('trainer perdu : sortie en pause, elle reprend à la reconnexion');
});
rideSession.on('resumed', () => log('trainer reconnecté : sortie reprise'));
rideSession.on('stopped', (distanceM) => {
  showRiderStill(distanceM);
  rideControls.showRideActive(false);
  riderInputs.lockMass(false);
  log('sortie virtuelle arrêtée');
  setState(trainerCtl.state, trainerCtl.name);
});

/** Démarrer la sortie, ou l'arrêter : un arrêt volontaire, hors séance, fige la sortie et ouvre son récapitulatif (docs/design/recap.md). */
function toggleRide() {
  if (!rideSession.active) return startRide();
  stopRide();
  if (workoutSession.running) return;
  exporter.onRideStopped();
  offerRecap();
}

// --- Séance structurée ---

// L'accueil : parcours retenu, menu du parcours, bouton « Rouler » (home-view.ts). Le HUD n'existe pas encore quand le menu
// se crée (il annonce le premier choix d'emblée) : on ne le touche qu'ensuite.
let courseUiReady = false;
const home = new HomeView(COL_DES_ERABLES, prefs, () => rideSession.active, {
  courseSelected: (course) => {
    if (rideSession.active) return;
    journey.setCourse(course.id);
    if (courseUiReady) hud.refreshRoute();
  },
  startRide: () => {
    router.go('sortie');
    startRide();
  },
  resumeRide: () => router.go('sortie'),
});
courseUiReady = true;
// L'écran Séances a le même fond, sans titre ni description.
setupHomeBackground($('sea-scenes'));
// Et l'écran Appareils.
setupHomeBackground($('dev-scenes'));

/** La séance structurée : la séance choisie, son déroulement et la consigne ERG qu'elle impose au trainer. */
const workoutSession = new WorkoutSession({
  trainer: trainerCtl,
  ftpW: () => readFtp(),
  rideActive: () => rideSession.active,
  manualGradePct: () => rideControls.manualGradePct,
  log,
});

/** Les commandes de la séance : liste de l'accueil, démarrage, pause, palier, intensité (workout-controls-view.ts). */
const workoutControls = new WorkoutControlsView({
  choose: (value) => chooseWorkout(value),
  start: () => startWorkout(),
  startFromHome: () => {
    router.go('sortie');
    startWorkout();
  },
  togglePause: () => workoutSession.togglePause(),
  skip: () => workoutSession.skip(),
  stop: () => workoutSession.stop(),
  adjustIntensity: (delta) => workoutSession.adjustIntensity(delta),
});

/** ERG et pente demandés à la main, selon ce qui tourne (app/manual-control.ts). */
const manual = new ManualControl({ trainer: trainerCtl, rideSession, workoutSession, log });
/** Les commandes de la sortie : démarrer, ERG, pente (ride-controls-view.ts). */
const rideControls = new RideControlsView(
  {
    toggleRide,
    toggleErg: (targetW, gradePct) => void manual.toggleErg(targetW, gradePct),
    retargetErg: (targetW) => manual.retargetErg(targetW),
    sendGrade: (gradePct) => void manual.setGrade(gradePct),
  },
  () => router.go('appareils'),
);

riderInputs.load({ ftpW: settings.ftpW(), massKg: settings.massKg() });
const readFtp = () => riderInputs.ftpW;
const readMass = () => riderInputs.massKg;

/** Appelé par l'écran Séances quand « Rouler » doit se remettre à jour (affecté une fois l'éditeur créé). */
// Affecté plus bas, une fois l'éditeur créé : lu avant par des fonctions déjà déclarées.
// eslint-disable-next-line prefer-const
let refreshEditorRide: (() => void) | undefined;

/** Ce qui empêche de démarrer une séance, hors le choix de la séance : séance déjà en cours, trainer absent ou sans ERG. */
function workoutStartBlock(): string | BlockReason | undefined {
  const canErg = trainerCtl.canErg;
  return workoutSession.running
    ? 'La séance est déjà en cours.'
    : !trainerCtl.connected
      ? needTrainer('La séance pilote la résistance de ton home trainer : connecte-le d’abord.')
      : !canErg
        ? noControl('mode ERG')
        : undefined;
}

function refreshWorkoutButtons() {
  const { runner, workout } = workoutSession;
  const startReason = !workout && !runner ? 'Choisis d’abord une séance dans la liste.' : workoutStartBlock();
  workoutControls.render({ running: !!runner, paused: workoutSession.paused, startReason });
  refreshEditorRide?.();
}

/** Le profil de la séance choisie, sur l'accueil. */
const renderProfile = () => workoutControls.showProfile(workoutSession.workout, readFtp());

/** Les séances que l'on peut choisir : les nôtres et les modèles livrés. La liste de l'accueil les montre. */
function refreshWorkoutChoices() {
  const { mine, samples } = catalog.choices();
  workoutControls.showChoices(mine, samples);
}

function chooseWorkout(value: string) {
  if (workoutSession.running) {
    log("séance en cours : l'arrêter avant d'en choisir une autre");
    return;
  }
  workoutControls.setChoice(value);
  const w = value ? catalog.resolve(value) : undefined;
  workoutSession.select(w);
  workoutControls.showWorkoutName(w);
  if (!w) {
    renderProfile();
    refreshWorkoutButtons();
    return;
  }
  armAutoStart();
  for (const x of w.warnings) log(`séance : ${x}`);
  const total = w.steps.reduce((t, s) => t + s.durationS, 0);
  renderProfile();
  refreshWorkoutButtons();
  log(`séance choisie : ${w.name} (${w.steps.length} paliers, ${fmtTime(total)})`);
}

// L'état de la séance est affiché par le HUD (palier, profil, curseur, message) ; ici, seule la porte 3D du palier suivant.
workoutSession.on('state', (s) => {
  // Porte du palier suivant, dans la scène 3D (docs/design/hud.md) : seulement en séance, sortie en cours.
  const live = rideSession.snapshot;
  const runner = workoutSession.runner;
  rideViews.view?.setGate(runner && s && live ? nextIntervalGate(s, runner.ftpW, live.speedKmh, workoutSession.paused) : undefined);
});
workoutSession.on('changed', refreshWorkoutButtons);
workoutSession.on('intensity', (fraction) => workoutControls.showIntensity(fraction));
workoutSession.on('started', (name) => exporter.onWorkoutStarted(name));
workoutSession.on('stepped', (targetW, stepIndex) => exporter.onWorkoutState(targetW, stepIndex));
workoutSession.on('completing', () => exporter.onWorkoutFinished()); // l'export s'arrêtera à la fin du dernier palier (app/ride-export.ts)
workoutSession.on('ended', ({ completed }) => {
  if (completed) offerRecap(completed);
});

function startWorkout() {
  if (!workoutSession.workout) return;
  autoStart = false;
  // La séance se roule sur le parcours : sans sortie en cours, le cycliste resterait immobile dans la vue.
  if (!rideSession.active && trainerCtl.connected) startRide();
  workoutSession.start();
}

/** La FTP a changé (ici ou sur un autre appareil) : séance en cours, profil et éditeur suivent. */
function ftpChanged() {
  workoutSession.setFtp(readFtp());
  renderProfile();
  editor.refresh();
}
riderInputs.onMassChange(() => {
  settings.save('mass', readMass());
  syncJournal.record('setting', 'mass', readMass());
});
riderInputs.onFtpChange(() => {
  settings.save('ftp', readFtp());
  syncJournal.record('setting', 'ftp', readFtp());
  ftpChanged();
});

// --- Écrans, appareils connus et reconnexion au lancement ---

const library = new WorkoutLibrary(prefs, undefined, syncJournal);
const blockLibrary = new BlockLibrary(prefs, undefined, syncJournal);
/** Les séances que l'on peut choisir pour rouler : les nôtres et les modèles (app/workout-catalog.ts). */
const catalog = new WorkoutCatalog({ library, log });
const editor = setupWorkoutEditor({
  library,
  blocks: blockLibrary,
  readFtp,
  log,
  onLibraryChange: refreshWorkoutChoices,
  currentChoice: () => workoutControls.choice,
  // Pendant une séance, le choix reste celui de la séance en cours : on ne le change pas en parcourant la bibliothèque.
  onFocus: (key) => {
    if (!workoutSession.running) chooseWorkout(key);
  },
  onRide: (key) => {
    router.go('sortie');
    chooseWorkout(key);
    startWorkout();
  },
  rideBlock: workoutStartBlock,
});
refreshEditorRide = editor.refreshRide;
refreshWorkoutChoices();

setupAppShell();
const rideMenu = setupRideMenu({ prefs, opener: $<HTMLButtonElement>('ride-menu-open'), dialog: $<HTMLDialogElement>('ride-menu'), stats: $('view-stats') });
// Avant le routeur, qui applique l'écran courant dès sa création et ferme le récapitulatif hors de la Sortie.
const recap = setupRecap($<HTMLDialogElement>('recap'), {
  send: (name) => exporter.sendToStrava(name),
  downloadFit: () => void exporter.downloadFit(),
  // Après un arrêt de la sortie, « Reprendre la sortie » la relance ; après une séance, elle n'a jamais cessé.
  // Un envoi programmé est déjà parti avec la sortie figée ; sinon, l'export suivant couvrira toute la sortie.
  onContinue: () => {
    exporter.releaseFrozen();
    if (!rideSession.active && trainerCtl.connected) startRide();
  },
  onFinish: () => {
    stopRide();
    router.go('accueil');
  },
});

const router = setupRouter((v) => {
  rideViews.view?.setActive(v === 'sortie');
  if (v === 'sortie') rideViews.hurry(); // la construction se presse, et démarre si le temps mort n'est pas encore venu
  else rideViews.calm(); // on a quitté la sortie avant la fin : la construction repasse derrière l'interface
  if (v !== 'sortie') {
    rideMenu.close();
    recap.close();
  }
  else armAutoStart();
  if (v === 'seances') editor.sync();
});

const gears = setupGears({
  prefs,
  toggle: $<HTMLInputElement>('cog-toggle'),
  ringRow: $('cog-ring-row'),
  ring: $<HTMLInputElement>('cog-ring'),
  shifter: $('ride-gears'),
  up: $<HTMLButtonElement>('gear-up'),
  down: $<HTMLButtonElement>('gear-down'),
  out: $('gear-out'),
  keysActive: () => router.current() === 'sortie' && !document.querySelector('dialog[open]'),
  onChange: (s, why) => {
    // Le changement doit se sentir tout de suite : la prochaine mise à jour de la sortie renvoie la pente sans attendre.
    grade.setVirtualGears(s.enabled);
    if (why === 'shift') log(`vitesse ${s.gear} (braquet ${s.virtualRatio.toFixed(2)})`);
    else log(s.enabled ? `Zwift Cog : vitesses virtuelles actives, braquet réel ${s.realRatio.toFixed(2)}` : 'Zwift Cog : vitesses virtuelles coupées');
  },
});
if (gears.state().enabled) grade.setVirtualGears(true);

/** Même radar sur l'écran Appareils (grand) et sur l'accueil (réduit) : rôle de l'appareil et nom réel dans chaque bulle. */
const riderProfile = setupRiderProfile({
  massSource: riderInputs.massInput,
  ftpSource: riderInputs.ftpInput,
  readFtp,
  readMass,
  summary: $('rider-summary'),
  dialog: $<HTMLDialogElement>('rider-dialog'),
  wheel: setupWheel($<HTMLDialogElement>('wheel-dialog')),
  openers: [$('rider-open')],
});
// Le médaillon du radar ouvre la fiche du coureur ; sur l'accueil, la tuile reste un simple lien vers les appareils.
const radars = [
  createRadar($('radar-devices'), 'large', { onRider: riderProfile.open }),
  createRadar($('radar-home'), 'mini'),
];
const riderAvatar = $<HTMLImageElement>('rider-avatar');
riderAvatar.src = portraitFallback;
void import('./render/riders/rider-portrait')
  .then((m) => m.riderPortrait())
  .then((url) => { riderAvatar.src = url; })
  .catch(() => {}); // l'image de repli reste affichée

/** Les cartes de l'écran Appareils (devices-view.ts) : elles demandent, main.ts relie aux contrôleurs. */
const devicesView = new DevicesView(radars, {
  connectTrainer: (useKnown) => void devices.connectTrainer(useKnown ? devices.known('trainer')?.name : undefined),
  connectSimulator: () => void trainerCtl.connect(new SimulatedTrainer()),
  disconnectTrainer: () => trainerCtl.disconnect(),
  connectHeartRate: (useKnown) => devices.connectHeartRate(useKnown ? devices.known('hr')?.name : undefined),
  disconnectHeartRate: () => devices.disconnectHeartRate(),
  forget: (role) => devices.forget(role),
  goRide: () => router.go('accueil'),
  protocolChanged: (protocol) => {
    settings.saveTrainerProtocol(protocol);
    log(`protocole de pilotage : ${protocol ? PROTOCOL_LABEL[protocol] : 'automatique'}, appliqué à la prochaine connexion`);
  },
});
devicesView.setForcedProtocol(settings.trainerProtocol());

function renderDevices() {
  const states = devices.states;
  devicesView.render({
    trainer: {
      state: states.trainer,
      name: trainerCtl.name,
      known: devices.known('trainer'),
      waiting: devices.trainerWaiting,
      capabilities: trainerCtl.capabilities,
    },
    hr: { state: states.hr, name: devices.heartRate?.name, known: devices.known('hr'), waiting: devices.heartRateWaiting },
    bluetooth: { available: webBluetoothAvailable(), hint: noBluetoothHint(browserUa()) },
  });
  rideMenu.setAlert(states.trainer !== 'connected');
}

devices.on('changed', renderDevices);
devices.on('heartRateState', (s, d) => devicesView.showHeartRateState(s, d));
/** Pendant la reconnexion du lancement : une fois les appareils connus reconnectés, on passe à la sortie sans attendre de clic. */
devices.on('launchSettled', () => {
  if (router.current() !== 'appareils') return;
  log("appareils connus reconnectés : passage à l'accueil");
  setTimeout(() => router.current() === 'appareils' && router.go('accueil'), 800);
});
devices.on('recall', (status) => devicesView.showRecall(status));

/** L'export de la sortie : enregistrement, fichier FIT, envoi à Strava. */
const exporter = new RideExport({ hub, routeName: journey.name, log, platform: browserExportPlatform });
// Arrêt puis 5 s de pédalage après la fin : le récapitulatif s'efface de lui-même (docs/design/recap.md).
exporter.on('resumed', () => {
  if (!recap.open) return;
  log('pédalage repris : récapitulatif fermé');
  recap.dismissByPedaling();
});
new ExportButtons(exporter, $<HTMLButtonElement>('export-fit'), $<HTMLButtonElement>('export-strava'));
exporter.start();

/** En dessous, pas de récapitulatif : un démarrage pour rien ou un essai. */
const RECAP_MIN_S = 60;

/** Récapitulatif de fin de sortie : après une séance menée au bout, ou une sortie arrêtée à la main. */
function offerRecap(done?: { workout: Workout; ftpW: number }) {
  const rec = exporter.current();
  if (!rec || rec.timerS < RECAP_MIN_S || router.current() !== 'sortie') return;
  const ftpW = done?.ftpW ?? readFtp();
  rideMenu.close();
  recap.show({
    summary: summarize(rec, { ftpW, ...(done ? { workout: done.workout } : {}) }),
    eyebrow: done ? 'Séance terminée' : 'Sortie terminée',
    title: done?.workout.name ?? journey.name,
    place: journey.name,
    startMs: rec.startMs,
    defaultName: exporter.defaultName(),
    strava: exporter.strava(),
    rideRunning: rideSession.active,
  });
  log(`récapitulatif : ${Math.round(rec.timerS)} s, Strava ${exporter.strava()}`);
}


devicesView.showSupport(webBluetoothAvailable() ? (isNativeShell() ? 'Bluetooth disponible.' : 'Web Bluetooth disponible.') : noBluetoothStatus(browserUa()));

const params = new URLSearchParams(location.search);

// HUD posé sur la vue 3D (docs/design/hud.md). En qualité réduite, panneaux sans flou.
/** Profil de rendu : `?quality=high|low`, sinon `low` sur écran tactile (src/render/core/quality.ts). Le HUD le suit (sans flou en `low`). */
const quality = chooseQuality(params.get('quality'), matchMedia('(pointer: coarse)').matches);
const hud = new RideHud($('hud'), journey, { flat: quality === 'low' });
const riderTags = new RiderTags($('rider-tags'));
const ridePanel = new RidePanel($('near'), { journey, prefs });
// Ce que le HUD et l'encart affichent à chaque instant, et les choix du coureur sur la route (hud-presenter.ts).
new HudPresenter({
  hud,
  ridePanel,
  journey,
  readings,
  trainer: trainerCtl,
  devices,
  rideSession,
  workoutSession,
  readFtp,
  rideScreenOpen: () => router.current() === 'sortie',
});
/** Écran de chargement de la sortie (index.html, sortie.css) : visible tant que la vue 3D n'a pas dessiné sa première image. */
const rideLoading = new RideLoadingView();
// `?relief=1` : relief réel ; `?relief=2` : plus marqué. Par défaut 1,6 : un 6 % se voit comme un 10 %.
const reliefParam = Number(params.get('relief'));
const relief = params.get('relief') && Number.isFinite(reliefParam) ? Math.min(3, Math.max(1, reliefParam)) : undefined;

rideViews.on('progress', (done, step) => rideLoading.progress(done, step));
rideViews.on('ready', (v) => {
  performance.mark('view-ready'); // relevé par tools/audit/startup.cjs
  void v.firstFrame.then(() => rideLoading.hide());
  v.setActive(router.current() === 'sortie');
  v.setOthers(() => world.riders());
  v.onTags = (tags) => riderTags.set(tags);
  v.onNearby = (n) => ridePanel.setNearby(n, rideSession.active ? rideSession.draft : 0);
  v.onStats = (s) => rideLoading.showStats(s);
  log(`rendu 3D : ${v.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · qualité ${quality}${rideViews.losses ? ` · reprise n° ${rideViews.losses}` : ''}`);
});
rideViews.on('lost', (loss, attempt, max) => log(`rendu 3D : GPU perdu (${loss.api} : ${loss.message}), reprise ${attempt}/${max}`));
rideViews.on('retrying', () => rideLoading.retry());
rideViews.on('unavailable', (e) => {
  rideLoading.unavailable();
  log(`rendu 3D indisponible : ${e instanceof Error ? e.message : e}`);
});
// three.js (~1 Mio) n'est demandé qu'après le premier affichage, pendant un temps mort : l'accueil répond tout de suite.
const startViewBuild = () => rideViews.start();
if (typeof requestIdleCallback === 'function') requestIdleCallback(startViewBuild, { timeout: 2000 });
else setTimeout(startViewBuild, 300);

// Service worker (build de production seulement) : relancement instantané et hors ligne. Il est généré au build avec la
// liste des fichiers de la version (tools/offline/). En développement, il servirait des fichiers périmés.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e: unknown) => log(`hors ligne indisponible : ${e instanceof Error ? e.message : e}`));
  });
}

// Aperçu du récapitulatif sans rouler, en développement seulement (voir ui/recap/recap-demo.ts) : ?recap, ?recap=libre…
if (import.meta.env.DEV && params.has('recap')) {
  const sample = SAMPLE_WORKOUTS.find((s) => s.id === 'sweet-spot')!;
  void import('./ui/recap/recap-demo').then((m) => {
    router.go('sortie');
    m.showRecapDemo($('recap').parentElement!, params.get('recap') ?? '', parseWorkout(sample.fileName, sample.text), readFtp(), journey.name);
  });
}

// Données du coureur synchronisées avec son compte : FTP, masse, séances, « Mes blocs » (docs/design/compte.md).
const riderSettingsSync = new RiderSettingsSync({
  settings,
  journal: syncJournal,
  inputs: riderInputs,
  ftpChanged,
  refreshProfile: () => riderProfile.refresh(),
});
/** Séances changées depuis un autre appareil : l'éditeur et la liste de la sortie suivent, la séance choisie aussi. */
function workoutsChanged(ids: Set<string>) {
  editor.libraryChanged();
  const before = workoutControls.choice;
  refreshWorkoutChoices();
  const changed = workoutControls.choice !== before || (before.startsWith('lib:') && (ids.size === 0 || ids.has(before.slice(4))));
  if (changed && !workoutSession.running) chooseWorkout(workoutControls.choice);
}
const sync = createSyncClient({
  journal: syncJournal,
  sources: [riderSettingsSync, workoutSource(library, workoutsChanged), blockSource(blockLibrary, () => editor.libraryChanged())],
  log,
});
// Retour sur la page, retour du réseau, et toutes les deux minutes tant qu'elle est visible : les autres appareils ont pu changer quelque chose.
document.addEventListener('visibilitychange', () => {
  void sync.now();
  // Retour au premier plan avec un trainer perdu : la reconnexion est retentée sans attendre son prochain signal.
  const dev = trainerCtl.device;
  if (document.visibilityState === 'visible' && dev instanceof WebBluetoothTrainer) dev.retryNow();
});
addEventListener('online', () => void sync.now());
setInterval(() => {
  if (document.visibilityState === 'visible') void sync.now();
}, 120_000);

// Compte (connexion Strava, facultative) et salle temps réel : sans compte, on roule seul et l'export FIT reste là.
const world = new WorldClient(journey.network);
const account = setupAccount({
  hosts: [...document.querySelectorAll<HTMLElement>('.home-top')],
  log,
  onChange: (s) => {
    if (s.kind === 'signed-in' && s.user.nameConfirmed) world.connect();
    else world.disconnect();
    void sync.setUser(s.kind === 'signed-in' ? s.user : undefined);
  },
});
/** Pastille de l'écran Sortie : visible seulement avec un compte connecté à la salle. */
const crowdView = new CrowdView(riderTags, ridePanel);
const showCrowd = () => crowdView.render(world.status, world.population);
world.onStatus = (s) => {
  account.setWorld(s, world.population);
  showCrowd();
  log(`multijoueur : ${s}`);
};
world.onRoster = (event, name) => log(`multijoueur : ${name} ${event === 'join' ? 'arrive' : 'part'}`);
setInterval(() => {
  account.setWorld(world.status, world.population);
  showCrowd();
}, 1000);

// En dernier : tout l'état de la page est initialisé avant la première connexion.
setState(trainerCtl.state); // chaque bouton reçoit dès le départ sa raison d'être indisponible
void devices.reconnectKnown();
