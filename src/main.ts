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
import { DEFAULT_RIDER } from './domain/sim/physics';
import { RideExport } from './app/ride-export';
import { browserExportPlatform, ExportButtons } from './ui/ride/export-buttons';
import { setupTelemetry } from './infra/telemetry/wiring';
import { COL_DES_ERABLES } from './domain/course/courses/col-des-erables';
import { Journey } from './domain/sim/journey';
import type { ConnectionState } from './infra/sensors/types';
import type { Workout } from './domain/workout/model';
import { profileShapes } from './domain/workout/profile';
import { parseWorkout } from './domain/workout/runner';
import { nextIntervalGate } from './domain/workout/gate';
import { DeviceRegistry } from './infra/sensors/device-registry';
import { browserStore } from './infra/storage/key-value-store';
import { PROTOCOL_LABEL, type ControlProtocol } from './infra/sensors/protocols/trainer-profiles';
import { formatDuration } from './ui/shared/duration';
import { setBlocked, setupBlockedHints, type BlockReason } from './ui/shared/blocked';
import { setupRouter } from './ui/shared/router';
import { normalizeFtp, normalizeMass } from './domain/sim/rider-limits';
import { GradeController } from './app/grade-controller';
import { RideSession } from './app/ride-session';
import { RideViewLoader } from './app/ride-view-loader';
import { WorkoutSession } from './app/workout-session';
import { DeviceManager } from './app/device-manager';
import { SensorReadings } from './app/sensor-readings';
import { SettingsStore } from './app/settings-store';
import { TrainerController } from './app/trainer-controller';
import { setupRiderProfile } from './ui/devices/rider-profile';
import { setupWheel } from './ui/shared/wheel-picker';
import { setupAppShell } from './ui/shared/app-shell';
import { setupWorkoutEditor } from './ui/editor/workout-editor';
import { RideHud } from './ui/ride/hud';
import { setupRideMenu } from './ui/ride/ride-menu';
import { setupRecap } from './ui/recap/recap';
import { summarize } from './ui/recap/recap-model';
import { createRadar } from './ui/ride/radar';
import portraitFallback from './assets/rider-portrait.jpg';
import { setupHomeBackground } from './ui/home/home-background';
import { HOME_SCENES } from './ui/home/home-scenes';
import { setupCoursePicker } from './ui/home/course-picker';
import { setupCourseMap } from './ui/home/course-map';
import { setupAccount } from './ui/account/account-chip';
import { WorldClient } from './infra/net/world-client';
import { crowdLine, RiderTags } from './ui/ride/rider-tags';
import { RidePanel } from './ui/ride/ride-panel';
import { controlModes } from './ui/ride/radar-model';
import { blocksToWorkout } from './domain/workout/blocks';
import { BlockLibrary } from './domain/workout/block-library';
import { WorkoutLibrary } from './domain/workout/library';
import { SAMPLE_WORKOUTS } from './domain/workout/samples';
import { createSyncClient, type SyncSource } from './infra/sync/client';
import { SyncJournal } from './infra/sync/journal';
import type { SyncItem, SyncSetting } from './infra/sync/protocol';
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

/** Raison « pas de trainer », avec le raccourci qui mène à l'écran des appareils. */
const needTrainer = (text: string): BlockReason => ({
  text,
  action: { label: 'Connecter le trainer', run: () => router.go('appareils') },
});
const noControl = (what: string): BlockReason => ({
  text: `${trainerCtl.name ?? 'Cet appareil'} mesure ta puissance mais ne pilote pas la résistance (pas de ${what}). Il faut un home trainer connecté pour ça.`,
  action: { label: 'Changer d’appareil', run: () => router.go('appareils') },
});

/** État affiché sur les cartes de l'écran Appareils. */
const stateLabel = (s: ConnectionState) =>
  s === 'connected' ? 'Connecté' : s === 'connecting' ? 'Connexion…' : s === 'error' ? 'Erreur de connexion' : 'Non connecté';
const stateEl = $('state');
const stateHrEl = $('state-hr');
const connectHr = $<HTMLButtonElement>('connect-hr');
const disconnectHr = $<HTMLButtonElement>('disconnect-hr');
const logEl = $('log');
const connectBle = $<HTMLButtonElement>('connect-ble');
const connectSim = $<HTMLButtonElement>('connect-sim');
const disconnectBtn = $<HTMLButtonElement>('disconnect');
const ergBtn = $<HTMLButtonElement>('erg-send');
const simBtn = $<HTMLButtonElement>('sim-send');
const ergInput = $<HTMLInputElement>('erg');
const gradeInput = $<HTMLInputElement>('grade');

const hub = new SensorHub();

const prefs = browserStore();
/** FTP, masse et protocole de pilotage gardés sur l'appareil. */
const settings = new SettingsStore(prefs);
/** Journal de synchronisation avec le compte : FTP, masse, séances et blocs y notent chaque modification (src/infra/sync/). */
const syncJournal = new SyncJournal(prefs);
const protocolSelect = $<HTMLSelectElement>('trainer-protocol');
/** Protocole de pilotage imposé depuis l'aide de l'écran Appareils ; vide = choix automatique selon le modèle. */
protocolSelect.value = settings.trainerProtocol() ?? '';
protocolSelect.addEventListener('change', () => {
  settings.saveTrainerProtocol((protocolSelect.value || undefined) as ControlProtocol | undefined);
  log(`protocole de pilotage : ${protocolSelect.value ? PROTOCOL_LABEL[protocolSelect.value as ControlProtocol] : 'automatique'}, appliqué à la prochaine connexion`);
});

function newBleTrainer(): WebBluetoothTrainer {
  const t = new WebBluetoothTrainer();
  t.forcedProtocol = (protocolSelect.value || undefined) as ControlProtocol | undefined;
  return t;
}

/** Dernières mesures des capteurs, tant qu'elles sont fraîches (au-delà de 3 s de silence, le cycliste est à l'arrêt). */
const readings = new SensorReadings();
const rideBtn = $<HTMLButtonElement>('ride-toggle');
const massInput = $<HTMLInputElement>('mass');
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
  const ts = new Date().toLocaleTimeString('fr-FR');
  logEl.textContent += `${ts}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
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

/** Menu de la sortie, rubrique Zwift Cog : qui applique le braquet, le trainer ou la pente corrigée. */
function renderCogMode() {
  $('cog-mode').textContent =
    !trainerCtl.connected
      ? ''
      : trainerCtl.capabilities?.virtualGears
        ? 'Braquet géré par le trainer (protocole Zwift).'
        : protocolSelect.value === 'zwift'
          ? 'Ce trainer ne répond pas au protocole Zwift : braquet simulé par la pente envoyée.'
          : 'Braquet simulé par la pente envoyée au trainer. Pour que le trainer le gère lui-même, choisis « Zwift » comme protocole de pilotage sur l’écran Appareils, puis reconnecte-le.';
}

function setState(s: ConnectionState, detail?: string) {
  renderCogMode();
  exporter.onTrainerState(s);
  stateEl.dataset.s = s;
  stateEl.textContent = stateLabel(s);
  stateEl.title = detail ?? '';
  const connected = s === 'connected';
  // Les boutons de connexion sont réglés par renderDevices, plus bas.
  setBlocked(disconnectBtn, connected ? undefined : 'Aucun trainer connecté.');
  setBlocked(
    ergBtn,
    !connected
      ? needTrainer('Connecte d’abord ton home trainer pour lui imposer une puissance.')
      : !trainerCtl.capabilities?.targetPower
        ? noControl('mode ERG')
        : undefined,
  );
  setBlocked(
    simBtn,
    !connected
      ? needTrainer('Connecte d’abord ton home trainer pour lui imposer une pente.')
      : !trainerCtl.capabilities?.simulation
        ? noControl('mode SIM')
        : rideSession.active
          ? 'Pendant la sortie virtuelle, la pente vient du parcours. Arrête la sortie pour régler la pente à la main.'
          : undefined,
  );
  // La puissance seule suffit à rouler : la pente n'est envoyée que si le trainer sait la simuler.
  const needPowerToRide = connected || rideSession.active ? undefined : needTrainer('La sortie avance avec la puissance de ton home trainer : connecte-le d’abord.');
  setBlocked(rideBtn, needPowerToRide);
  setBlocked(homeRideBtn, needPowerToRide);
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
    const c = dev.capabilities;
    const range = c.powerRange ? `, plage ${c.powerRange.min}–${c.powerRange.max} W` : '';
    const id = dev instanceof WebBluetoothTrainer ? dev.identity : undefined;
    if (id) telemetry.trainer({ profile: id.profile.id, brand: id.profile.brand, label: id.profile.label, ...id.info, protocol: id.protocol, services: id.services });
    const model = id ? `${id.profile.label}${id.info.firmware ? ` (firmware ${id.info.firmware})` : ''} · pilotage ${id.protocol ? PROTOCOL_LABEL[id.protocol] : 'aucun'} · ` : '';
    $('caps').textContent = `${model}ERG : ${c.targetPower ? 'oui' : 'non'} · SIM : ${c.simulation ? 'oui' : 'non'}${range}${id?.advice ? `. ${id.advice}` : ''}`;
  }
  renderDevices();
}

// Le trainer change d'état (connexion, perte, reconnexion automatique) : l'écran et la sortie suivent.
trainerCtl.on('state', (s, d) => setState(s, d));
trainerCtl.on('erg', (engaged) => {
  ergBtn.textContent = engaged ? "Désengager l'ERG" : "Engager l'ERG";
  ergBtn.classList.toggle('secondary', engaged);
});

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
  rideSession.start(Number(massInput.value) || DEFAULT_RIDER.massKg, coursePicker.selected());
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
  rideBtn.textContent = 'Arrêter la sortie';
  massInput.readOnly = true;
  massInput.title = 'La masse se règle avant de démarrer la sortie.';
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
  rideBtn.textContent = 'Démarrer la sortie';
  massInput.readOnly = false;
  massInput.title = '';
  log('sortie virtuelle arrêtée');
  setState(trainerCtl.state, trainerCtl.name);
});

rideBtn.addEventListener('click', () => {
  if (!rideSession.active) return startRide();
  stopRide();
  // Arrêt volontaire, hors séance : la sortie est figée et son récapitulatif s'affiche (docs/design/recap.md).
  if (workoutSession.running) return;
  exporter.onRideStopped();
  offerRecap();
});

connectHr.addEventListener('click', () => devices.connectHeartRate(devices.known('hr')?.name));
$('connect-hr-other').addEventListener('click', () => devices.connectHeartRate());
disconnectHr.addEventListener('click', () => devices.disconnectHeartRate());
connectBle.addEventListener('click', () => void devices.connectTrainer(devices.known('trainer')?.name));
$('connect-ble-other').addEventListener('click', () => void devices.connectTrainer());
connectSim.addEventListener('click', () => void trainerCtl.connect(new SimulatedTrainer()));
for (const role of ['trainer', 'hr'] as const) {
  $(`forget-${role}`).addEventListener('click', () => {
    const known = devices.known(role);
    if (!known || !confirm(`Oublier « ${known.name} » ? Il ne sera plus reconnecté au lancement.`)) return;
    devices.forget(role);
  });
}
disconnectBtn.addEventListener('click', () => trainerCtl.disconnect());
ergBtn.addEventListener('click', async () => {
  if (trainerCtl.ergActive) {
    trainerCtl.setErgActive(false);
    if (workoutSession.running) workoutSession.optOutErg();
    if (rideSession.active) {
      log("ERG désengagé : pente du parcours reprise");
    } else {
      // Hors sortie, le trainer ne quitte l'ERG qu'avec une consigne de pente.
      const g = Number(gradeInput.value);
      await trainerCtl.sendGradeAfterErg('ERG désengagé', g);
    }
    return;
  }
  // Pendant une séance, réengager rend la main à la séance, qui renvoie aussitôt sa consigne du moment.
  if (workoutSession.running) return workoutSession.reengageErg();
  const w = Number(ergInput.value);
  await trainerCtl.engageErg(w);
});
// Changer la cible pendant que l'ERG est engagé l'applique aussitôt.
ergInput.addEventListener('change', () => {
  if (!trainerCtl.ergActive || workoutSession.running) return; // en séance, c'est la séance qui fixe la consigne
  const w = Number(ergInput.value);
  void trainerCtl.retargetErg(w);
});
simBtn.addEventListener('click', async () => {
  const g = Number(gradeInput.value);
  await trainerCtl.setManualGrade(g); // le SIM remplace l'ERG
});
gradeInput.addEventListener('input', () => {
  $('grade-out').textContent = `${gradeInput.value} %`;
});
// --- Séance structurée ---

const woFtp = $<HTMLInputElement>('wo-ftp');
const woStart = $<HTMLButtonElement>('wo-start');
const woPause = $<HTMLButtonElement>('wo-pause');
const woSkip = $<HTMLButtonElement>('wo-skip');
const woStop = $<HTMLButtonElement>('wo-stop');
const woEasier = $<HTMLButtonElement>('wo-easier');
const woHarder = $<HTMLButtonElement>('wo-harder');
const rideQuick = $('ride-quick');
const rqPause = $<HTMLButtonElement>('rq-pause');
// La séance se choisit sur l'accueil (ou dans l'écran Séances) ; la sortie, elle, ne fait que la dérouler.
const homeShapes = $('home-wo-shapes');
const homeSelect = $<HTMLSelectElement>('home-wo-select');
const homeWoStart = $<HTMLButtonElement>('home-wo-start');
const homeRideBtn = $<HTMLButtonElement>('home-ride');
// Fond de l'accueil : trois scènes qui se relaient toutes les minutes.
// L'accueil montre le parcours retenu (nom, description, scène qui lui ressemble, sans rotation). On le choisit dans le menu
// que « Rouler » ouvre (`course-dialog`) : la carte de l'accueil n'a pas la place d'un sélecteur.
const COURSE_SCENE: Record<string, string> = { col: 'Col des Érables', rive: 'Rive du lac', 'arc-en-ciel': 'Route arc-en-ciel' };
const courseScenes = COL_DES_ERABLES.courses.map((c) => HOME_SCENES.find((s) => s.name === COURSE_SCENE[c.id]) ?? HOME_SCENES[0]!);
const homeBackground = setupHomeBackground($('home-scenes'), undefined, undefined, courseScenes, Infinity);
// Carte du parcours : miniature dans le menu, agrandie dans sa propre boîte. Créée avant le menu, qui l'appelle d'emblée.
const courseMap = setupCourseMap(COL_DES_ERABLES, {
  thumb: $<HTMLButtonElement>('course-map'),
  dialog: $<HTMLDialogElement>('map-dialog'),
  title: $('map-title'),
  description: $('map-desc'),
  plan: $('map-plan'),
  profile: $('map-profile'),
  close: $<HTMLButtonElement>('map-close'),
});
// Le HUD n'existe pas encore quand le menu se crée (il appelle `onSelect` d'emblée) : on ne le touche qu'ensuite.
let courseUiReady = false;
const coursePicker = setupCoursePicker({
  root: $('course-options'),
  network: COL_DES_ERABLES,
  store: prefs,
  storeKey: 'mamoulinette.course',
  onSelect: (course) => {
    $('home-title').textContent = course.name;
    $('home-desc').textContent = course.description;
    homeBackground.show(COL_DES_ERABLES.courses.indexOf(course));
    courseMap.show(course);
    if (!rideSession.active) {
      journey.setCourse(course.id);
      if (courseUiReady) hud.refreshRoute();
    }
  },
});
courseUiReady = true;
const courseDialog = $<HTMLDialogElement>('course-dialog');
$('course-cancel').addEventListener('click', () => courseDialog.close());
courseDialog.addEventListener('click', (e) => {
  if (e.target === courseDialog) courseDialog.close(); // un clic sur le fond ferme, comme Échap
});
$('course-go').addEventListener('click', () => {
  courseDialog.close();
  router.go('sortie');
  startRide();
});
// L'écran Séances a le même fond, sans titre ni description.
setupHomeBackground($('sea-scenes'));
// Et l'écran Appareils.
setupHomeBackground($('dev-scenes'));
const NO_WORKOUT = "Aucune séance choisie : choisis-en une sur l'accueil.";
const PROFILE_W = 1000;
const PROFILE_H = 120;

/** La séance structurée : la séance choisie, son déroulement et la consigne ERG qu'elle impose au trainer. */
const workoutSession = new WorkoutSession({
  trainer: trainerCtl,
  ftpW: () => readFtp(),
  rideActive: () => rideSession.active,
  manualGradePct: () => Number(gradeInput.value),
  log,
});

const savedFtp = settings.ftpW();
if (savedFtp !== undefined) woFtp.value = String(savedFtp);
const savedMass = settings.massKg();
if (savedMass !== undefined) massInput.value = String(savedMass);
const readFtp = () => normalizeFtp(Number(woFtp.value));
const readMass = () => normalizeMass(Number(massInput.value));

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

/** Intensité de la séance, affichée dans le menu et dans les commandes posées sur la vue. */
function showIntensity(fraction: number) {
  const text = `${Math.round(fraction * 100)} %`;
  $('wo-intensity').textContent = text;
  $('rq-intensity').textContent = text;
}

function refreshWorkoutButtons() {
  const { runner, workout } = workoutSession;
  const woPaused = workoutSession.paused;
  const startReason = !workout && !runner ? 'Choisis d’abord une séance dans la liste.' : workoutStartBlock();
  setBlocked(woStart, startReason);
  setBlocked(homeWoStart, startReason);
  refreshEditorRide?.();
  for (const b of [woPause, woSkip, woStop, woEasier, woHarder]) setBlocked(b, runner ? undefined : 'Démarre d’abord la séance.');
  woPause.textContent = woPaused ? 'Reprendre' : 'Pause';
  // Téléphone couché : les mêmes commandes, posées sur la vue (voir ui/ride/sortie.css).
  rideQuick.hidden = !runner;
  rqPause.setAttribute('aria-pressed', String(woPaused));
  rqPause.setAttribute('aria-label', woPaused ? 'Reprendre' : 'Pause');
  // Dans le menu de la sortie : « Démarrer » avant la séance, les commandes de déroulement pendant.
  woStart.hidden = !!runner;
  for (const b of [woPause, woSkip, woStop]) b.hidden = !runner;
  $('wo-intensity-row').hidden = !runner;
}

function renderProfile() {
  const workout = workoutSession.workout;
  homeShapes.replaceChildren();
  $('home-wo-meta').textContent = workout ? `${workout.name} · ${fmtTime(workout.steps.reduce((t, s) => t + s.durationS, 0))}` : 'Aucune séance choisie.';
  if (!workout) return;
  for (const s of profileShapes(workout, readFtp(), PROFILE_W, PROFILE_H)) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', s.d);
    path.setAttribute('class', s.zone);
    homeShapes.append(path);
  }
}

/** Valeur du sélecteur : `lib:<id>` pour une séance de l'utilisateur, `sample:<id>` pour un modèle. */
function workoutFromChoice(value: string): Workout | undefined {
  const [kind, id] = value.split(':');
  if (kind === 'lib') {
    const saved = library.get(id ?? '');
    return saved && blocksToWorkout(saved.name, saved.description, saved.blocks);
  }
  const sample = SAMPLE_WORKOUTS.find((s) => s.id === id);
  if (!sample) return undefined;
  try {
    return parseWorkout(sample.fileName, sample.text);
  } catch (e) {
    log(`séance illisible (${sample.fileName}) : ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

function refreshWorkoutChoices() {
  const keep = homeSelect.value;
  const opt = (value: string, label: string) => Object.assign(document.createElement('option'), { value, textContent: label });
  const mine = document.createElement('optgroup');
  mine.label = 'Mes séances';
  mine.append(...library.list().map((w) => opt(`lib:${w.id}`, w.name)));
  const samples = document.createElement('optgroup');
  samples.label = 'Modèles';
  samples.append(...SAMPLE_WORKOUTS.map((s) => opt(`sample:${s.id}`, parseWorkout(s.fileName, s.text).name)));
  homeSelect.replaceChildren(opt('', '— choisir une séance —'), ...(mine.children.length ? [mine] : []), samples);
  homeSelect.value = [...homeSelect.options].some((o) => o.value === keep) ? keep : '';
}

function chooseWorkout(value: string) {
  if (workoutSession.running) {
    log("séance en cours : l'arrêter avant d'en choisir une autre");
    return;
  }
  homeSelect.value = value;
  const w = value ? workoutFromChoice(value) : undefined;
  workoutSession.select(w);
  if (!w) {
    $('wo-name').textContent = NO_WORKOUT;
    renderProfile();
    refreshWorkoutButtons();
    return;
  }
  armAutoStart();
  for (const x of w.warnings) log(`séance : ${x}`);
  const total = w.steps.reduce((t, s) => t + s.durationS, 0);
  $('wo-name').textContent = `${w.name} · ${fmtTime(total)}${w.description ? ` · ${w.description}` : ''}`;
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
workoutSession.on('intensity', showIntensity);
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

homeSelect.addEventListener('change', () => chooseWorkout(homeSelect.value));
homeWoStart.addEventListener('click', () => {
  router.go('sortie');
  startWorkout();
});
// « Rouler » : une sortie déjà en cours se reprend ; sinon on choisit le parcours, puis « Partir » lance la sortie.
homeRideBtn.addEventListener('click', () => {
  if (rideSession.active) {
    router.go('sortie');
    return;
  }
  courseDialog.showModal();
  $<HTMLButtonElement>('course-go').focus();
});
/** La FTP a changé (ici ou sur un autre appareil) : séance en cours, profil et éditeur suivent. */
function ftpChanged() {
  workoutSession.setFtp(readFtp());
  renderProfile();
  editor.refresh();
}
massInput.addEventListener('change', () => {
  settings.save('mass', readMass());
  syncJournal.record('setting', 'mass', readMass());
});
woFtp.addEventListener('change', () => {
  settings.save('ftp', readFtp());
  syncJournal.record('setting', 'ftp', readFtp());
  ftpChanged();
});
woStart.addEventListener('click', startWorkout);
// Commandes posées sur la vue : elles relaient celles du menu, qui portent les règles.
for (const [quick, target] of [
  [rqPause, woPause],
  [$<HTMLButtonElement>('rq-skip'), woSkip],
  [$<HTMLButtonElement>('rq-easier'), woEasier],
  [$<HTMLButtonElement>('rq-harder'), woHarder],
] as const) {
  quick.addEventListener('click', () => target.click());
}
woPause.addEventListener('click', () => workoutSession.togglePause());
woSkip.addEventListener('click', () => workoutSession.skip());
woStop.addEventListener('click', () => workoutSession.stop());
for (const [btn, delta] of [
  [woEasier, -0.05],
  [woHarder, 0.05],
] as const) {
  btn.addEventListener('click', () => workoutSession.adjustIntensity(delta));
}

// --- Écrans, appareils connus et reconnexion au lancement ---

const library = new WorkoutLibrary(prefs, undefined, syncJournal);
const blockLibrary = new BlockLibrary(prefs, undefined, syncJournal);
const editor = setupWorkoutEditor({
  library,
  blocks: blockLibrary,
  readFtp,
  log,
  onLibraryChange: refreshWorkoutChoices,
  currentChoice: () => homeSelect.value,
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
  massSource: massInput,
  ftpSource: woFtp,
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

function renderDevices() {
  const roleState = devices.states;
  const t = devices.known('trainer');
  const h = devices.known('hr');
  // Un appareil attendu (éteint) n'occupe pas le rôle : on peut toujours en choisir un autre.
  const waitingT = devices.trainerWaiting;
  const busyT = roleState.trainer === 'connected' || (roleState.trainer === 'connecting' && !waitingT);
  const busyH = roleState.hr === 'connected' || (roleState.hr === 'connecting' && !devices.heartRateWaiting);
  // Le nom de l'appareil branché prime (le trainer simulé n'est pas mémorisé) ; sinon le dernier appareil connu.
  $('trainer-known').textContent =
    roleState.trainer === 'connected' && trainerCtl.name ? trainerCtl.name : t ? `Connu : ${t.name}` : 'Aucun trainer connu.';
  $('hr-known').textContent =
    roleState.hr === 'connected' && devices.heartRate?.name ? devices.heartRate.name : h ? `Connu : ${h.name}` : 'Aucun capteur connu. Facultatif.';
  // Le nom de l'appareil est déjà affiché au-dessus des boutons : le libellé reste court pour que la rangée tienne sur une ligne.
  connectBle.textContent = t ? 'Reconnecter' : 'Rechercher un trainer';
  connectHr.textContent = h ? 'Reconnecter' : 'Rechercher un capteur';
  const bt = webBluetoothAvailable();
  const noBt = noBluetoothHint(browserUa());
  const trainerBusy =
    roleState.trainer === 'connected' ? 'Un trainer est déjà connecté : déconnecte-le d’abord pour en changer.' : 'Connexion du trainer en cours…';
  const hrBusy =
    roleState.hr === 'connected' ? 'Un capteur est déjà connecté : déconnecte-le d’abord pour en changer.' : 'Connexion du capteur en cours…';
  setBlocked(connectBle, !bt ? noBt : busyT ? trainerBusy : undefined);
  setBlocked(connectHr, !bt ? noBt : busyH ? hrBusy : undefined);
  setBlocked(connectSim, busyT ? trainerBusy : undefined);
  // Une rangée par appareil, limitée à ce qui est utile dans l'état courant : connecté, il ne reste que « Déconnecter ».
  const liveT = roleState.trainer === 'connected';
  const liveH = roleState.hr === 'connected';
  connectBle.hidden = liveT;
  connectSim.hidden = liveT;
  disconnectBtn.hidden = !liveT;
  connectHr.hidden = liveH;
  disconnectHr.hidden = !liveH;
  $<HTMLButtonElement>('connect-ble-other').hidden = !t || liveT;
  setBlocked($<HTMLButtonElement>('connect-ble-other'), !bt ? noBt : busyT ? trainerBusy : undefined);
  $<HTMLButtonElement>('connect-hr-other').hidden = !h || liveH;
  setBlocked($<HTMLButtonElement>('connect-hr-other'), !bt ? noBt : busyH ? hrBusy : undefined);
  $<HTMLButtonElement>('forget-trainer').hidden = !t || liveT;
  $<HTMLButtonElement>('forget-hr').hidden = !h || liveH;
  setBlocked(disconnectHr, roleState.hr === 'connected' ? undefined : 'Aucun capteur connecté.');
  setBlocked(
    $<HTMLButtonElement>('go-ride'),
    roleState.trainer === 'connected' ? undefined : 'Connecte d’abord ton home trainer, ou choisis « Continuer sans trainer » juste à côté.',
  );
  $('sortie-hint').hidden = roleState.trainer === 'connected';
  rideMenu.setAlert(roleState.trainer !== 'connected');
  $('card-trainer').dataset.s = roleState.trainer;
  $('card-hr').dataset.s = roleState.hr;
  // Nom réel : celui de l'appareil connecté ; sinon le dernier appareil mémorisé, que la reconnexion cherche.
  const radarDevices = {
    trainer: {
      state: roleState.trainer,
      name: (roleState.trainer === 'connected' ? trainerCtl.name : undefined) ?? t?.name,
      detail: roleState.trainer === 'connected' ? controlModes(trainerCtl.capabilities) : undefined,
    },
    hr: { state: roleState.hr, name: (roleState.hr === 'connected' ? devices.heartRate?.name : undefined) ?? h?.name },
  };
  for (const r of radars) r.update(radarDevices);
}

devices.on('changed', renderDevices);
devices.on('heartRateState', (s, d) => {
  stateHrEl.dataset.s = s;
  stateHrEl.textContent = stateLabel(s);
  stateHrEl.title = d ?? '';
});
/** Pendant la reconnexion du lancement : une fois les appareils connus reconnectés, on passe à la sortie sans attendre de clic. */
devices.on('launchSettled', () => {
  if (router.current() !== 'appareils') return;
  log("appareils connus reconnectés : passage à l'accueil");
  setTimeout(() => router.current() === 'appareils' && router.go('accueil'), 800);
});
devices.on('recall', (status) => {
  const note = $('recall-note');
  switch (status.kind) {
    case 'first-use':
      note.textContent = 'Première utilisation : connecte ton home trainer pour commencer. Il sera reconnu aux prochains lancements.';
      break;
    case 'unavailable':
      note.textContent = 'Ce navigateur ne permet pas de retrouver les appareils sans clic : un clic sur « Reconnecter » par appareil suffit.';
      break;
    case 'searching':
      note.textContent = 'Reconnexion automatique aux appareils connus…';
      break;
    case 'failed':
      note.textContent = 'Reconnexion automatique impossible : un clic sur « Reconnecter » par appareil suffit.';
      break;
    case 'permissions-lost':
      note.textContent = 'Les autorisations Bluetooth de ce site ont été effacées : un clic sur « Reconnecter » par appareil suffit.';
      break;
    case 'reconnecting':
      note.textContent = `Reconnexion automatique : ${status.names.join(', ')}. Allume-les si ce n'est pas déjà fait.`;
      break;
  }
});

$('go-ride').addEventListener('click', () => router.go('accueil'));

$('copy-log').addEventListener('click', () => void navigator.clipboard.writeText(logEl.textContent ?? ''));

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


if (webBluetoothAvailable()) {
  $('support').textContent = isNativeShell() ? 'Bluetooth disponible.' : 'Web Bluetooth disponible.';
} else {
  $('support').textContent = noBluetoothStatus(browserUa());
}

const params = new URLSearchParams(location.search);

// HUD posé sur la vue 3D (docs/design/hud.md). En qualité réduite, panneaux sans flou.
/** Profil de rendu : `?quality=high|low`, sinon `low` sur écran tactile (src/render/core/quality.ts). Le HUD le suit (sans flou en `low`). */
const quality = chooseQuality(params.get('quality'), matchMedia('(pointer: coarse)').matches);
const hud = new RideHud($('hud'), journey, { flat: quality === 'low' });
function renderHud() {
  if (router.current() !== 'sortie') return;
  const live = rideSession.snapshot; // la sortie en cours ; `undefined` hors sortie
  const runner = workoutSession.runner;
  const woState = workoutSession.state;
  hud.update({
    powerW: readings.averagePowerW(),
    heartRateBpm: readings.heartRateBpm(),
    cadenceRpm: readings.liveCadenceRpm(),
    // Pendant la sortie, la vitesse virtuelle (celle qui fait avancer la vue) ; sinon celle mesurée par le trainer.
    speedKmh: live ? live.speedKmh : readings.speedKmh(),
    ftpW: runner?.ftpW ?? readFtp(),
    ride: live ? { snapshot: live, climbM: rideSession.climbM } : undefined,
    workout: runner && woState ? { workout: runner.workout, state: woState, ftpW: runner.ftpW, intensity: runner.intensity } : undefined,
    message: runner ? woState?.message : undefined,
    control: trainerCtl.ergActive ? 'erg' : live && trainerCtl.capabilities?.simulation ? 'sim' : undefined,
    trainerConnected: devices.states.trainer === 'connected',
    heartRateConnected: devices.states.hr === 'connected',
    ...(live ? { junction: journey.pendingJunction(live.distanceM) } : {}),
  });
  // Encart : la carte suit le coureur ; elle passe seule au premier plan 250 m avant un carrefour (docs/design/sortie.md).
  const at = live ? live.distanceM : 0;
  ridePanel.update({
    distanceM: at,
    pending: live ? journey.pendingJunction(at) : undefined,
    // Sur la piste d'un vélodrome : la touche de sortie remplace le panneau « Carrefour » de chaque tour.
    trackExit: live && journey.onTrack(at) ? { armed: journey.trackExitArmed, inM: journey.trackExitInM(at) } : undefined,
  });
}
setInterval(renderHud, 250);
// Choix au carrefour : touche du HUD, ou flèches gauche et droite pour glisser la sélection d'une route à l'autre.
hud.onChoose = (i) => {
  if (journey.choose(i)) renderHud();
};
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || router.current() !== 'sortie' || document.querySelector('dialog[open]')) return;
  const t = e.target;
  if (t instanceof HTMLElement && t.closest('input, select, textarea, [contenteditable]')) return;
  const by = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  // Sur la piste : flèche droite, sortir à la prochaine porte ; flèche gauche, rester sur la piste.
  const live = rideSession.snapshot;
  if (by && live && journey.onTrack(live.distanceM)) {
    e.preventDefault();
    journey.setTrackExit(by > 0);
    renderHud();
    return;
  }
  const p = by && live ? journey.pendingJunction(live.distanceM) : undefined;
  if (!by || !p) return;
  e.preventDefault();
  if (journey.choose(Math.min(p.options.length - 1, Math.max(0, p.selected + by)))) renderHud();
});
/** Écran de chargement de la sortie (index.html, sortie.css) : visible tant que la vue 3D n'a pas dessiné sa première image. */
const rideLoading = $('ride-loading');
const rideLoadingBar = rideLoading.querySelector<HTMLElement>('.rl-bar')!;
const showRideProgress = (done: number, step: string) => {
  $('ride-loading-step').textContent = step;
  rideLoadingBar.style.setProperty('--p', String(done));
  rideLoadingBar.setAttribute('aria-valuenow', String(Math.round(done * 100)));
};
// `?relief=1` : relief réel ; `?relief=2` : plus marqué. Par défaut 1,6 : un 6 % se voit comme un 10 %.
const reliefParam = Number(params.get('relief'));
const relief = params.get('relief') && Number.isFinite(reliefParam) ? Math.min(3, Math.max(1, reliefParam)) : undefined;

rideViews.on('progress', showRideProgress);
rideViews.on('ready', (v) => {
  performance.mark('view-ready'); // relevé par tools/audit/startup.cjs
  void v.firstFrame.then(() => (rideLoading.hidden = true));
  v.setActive(router.current() === 'sortie');
  v.setOthers(() => world.riders());
  v.onTags = (tags) => riderTags.set(tags);
  v.onNearby = (n) => ridePanel.setNearby(n, rideSession.active ? rideSession.draft : 0);
  v.onStats = (s) => {
    $('view-stats').textContent =
      `${s.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · ${s.fps.toFixed(0)} i/s · ` +
      `p50 ${s.frameP50Ms.toFixed(1)} ms · p95 ${s.frameP95Ms.toFixed(1)} ms · ` +
      `${(s.triangles / 1000).toFixed(0)} k triangles · ${s.drawCalls} appels`;
  };
  log(`rendu 3D : ${v.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · qualité ${quality}${rideViews.losses ? ` · reprise n° ${rideViews.losses}` : ''}`);
});
rideViews.on('lost', (loss, attempt, max) => log(`rendu 3D : GPU perdu (${loss.api} : ${loss.message}), reprise ${attempt}/${max}`));
rideViews.on('retrying', () => {
  // Un canevas garde le contexte qu'il a perdu, et three.js ne recrée pas ses ressources : on repart d'un canevas neuf.
  const old = $<HTMLCanvasElement>('view');
  old.replaceWith(old.cloneNode(false) as HTMLCanvasElement);
  rideLoading.hidden = false;
  showRideProgress(0, 'Reprise de la vue 3D');
});
rideViews.on('unavailable', (e) => {
  $('view-stats').textContent = 'rendu 3D indisponible';
  rideLoading.hidden = false;
  rideLoading.dataset.state = 'error';
  $('ride-loading-title').textContent = 'Vue 3D indisponible';
  $('ride-loading-step').textContent = 'La sortie fonctionne sans elle : mesures, profil et séance restent affichés.';
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
const SETTING_FIELDS: Record<SyncSetting, HTMLInputElement> = { ftp: woFtp, mass: massInput };
const settingsSource: SyncSource = {
  kind: 'setting',
  all: () =>
    (Object.keys(SETTING_FIELDS) as SyncSetting[]).flatMap((id): SyncItem[] => {
      const raw = settings.raw(id);
      // Un réglage sans version (fait avant la synchronisation) cède devant celui du compte.
      return raw === null ? [] : [{ kind: 'setting', id, body: Number(raw), updatedAt: syncJournal.stamp('setting', id) ?? 0 }];
    }),
  apply(items) {
    for (const i of items) {
      const input = SETTING_FIELDS[i.id as SyncSetting];
      if (!input) continue;
      const v = typeof i.body === 'number' ? i.body : undefined;
      // Pendant une sortie, la masse de la sortie ne change pas (Ride l'a prise au départ) : seule la valeur gardée suit.
      input.value = String(v ?? input.defaultValue);
      settings.save(i.id as SyncSetting, v);
    }
    if (items.some((i) => i.id === 'ftp')) ftpChanged();
    riderProfile.refresh();
  },
  clear() {
    for (const [id, input] of Object.entries(SETTING_FIELDS) as [SyncSetting, HTMLInputElement][]) {
      input.value = input.defaultValue;
      settings.save(id, undefined);
    }
    ftpChanged();
    riderProfile.refresh();
  },
};
/** Séances changées depuis un autre appareil : l'éditeur et la liste de la sortie suivent, la séance choisie aussi. */
function workoutsChanged(ids: Set<string>) {
  editor.libraryChanged();
  const before = homeSelect.value;
  refreshWorkoutChoices();
  const changed = homeSelect.value !== before || (before.startsWith('lib:') && (ids.size === 0 || ids.has(before.slice(4))));
  if (changed && !workoutSession.running) chooseWorkout(homeSelect.value);
}
const sync = createSyncClient({
  journal: syncJournal,
  sources: [settingsSource, workoutSource(library, workoutsChanged), blockSource(blockLibrary, () => editor.libraryChanged())],
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
const riderTags = new RiderTags($('rider-tags'));
const ridePanel = new RidePanel($('near'), { journey, prefs });
ridePanel.onTrackExit = () => {
  journey.setTrackExit(!journey.trackExitArmed);
  renderHud();
};
const crowd = $('crowd');
/** Pastille de l'écran Sortie : visible seulement avec un compte connecté à la salle. */
function showCrowd() {
  const s = world.status;
  crowd.hidden = s === 'offline' || s === 'signed-out' || s === 'name-pending';
  crowd.dataset.state = s === 'online' ? 'on' : 'off';
  crowd.textContent = s === 'online' ? crowdLine(world.population) : s === 'connecting' ? 'Connexion…' : s === 'replaced' ? 'Connecté sur un autre appareil' : s === 'outdated' ? 'Mise à jour : recharger la page' : 'Connexion perdue, nouvel essai…';
  if (s !== 'online') {
    riderTags.clear();
    ridePanel.clearNearby();
  }
}
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
