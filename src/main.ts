import { installNativeBluetooth } from './sensors/native-bluetooth';
import { isNativeShell, Moulinette } from './native/shell';
import { createKeepAwake } from './ui/keep-awake';
import { openDeviceChooser } from './ui/device-chooser';
import { HeartRateMonitor } from './sensors/heart-rate-monitor';
import { SensorHub } from './sensors/hub';
import { SimulatedTrainer } from './sensors/simulator';
import { WebBluetoothTrainer } from './sensors/web-bluetooth';
import { webBluetoothAvailable } from './sensors/gatt-device';
import { browserUa, noBluetoothHint, noBluetoothStatus } from './sensors/bluetooth-support';
// Vue 3D chargée à la demande (`buildView`) : three.js n'est pas dans le JS du lancement.
import type { GpuLoss, RideView } from './render/ride-view';
import { Background } from './render/background';
import { chooseQuality } from './render/quality';
import { GradeSlew, GradeThrottle } from './sim/grade-throttle';
import { gearedGradePct, trainerModelFor } from './sim/virtual-gears';
import { setupGears } from './ui/gears';
import { DEFAULT_RIDER } from './sim/physics';
import { Ride } from './sim/ride';
import { setupExport } from './export/wiring';
import { setupTelemetry } from './telemetry/wiring';
import { COL_DES_ERABLES } from './sim/courses/col-des-erables';
import { Journey } from './sim/journey';
import type { ConnectionState, TrainerAdapter } from './sensors/types';
import { ErgFollower } from './workout/erg-follower';
import { STEP_LABEL, type Workout } from './workout/model';
import { profileShapes } from './workout/profile';
import { parseWorkout, WorkoutRunner, type WorkoutState } from './workout/runner';
import { nextIntervalGate } from './workout/gate';
import { browserStore, canRecallDevices, DeviceRegistry, recallDevices, type DeviceRole } from './sensors/device-registry';
import { ALL_PROTOCOLS, PROTOCOL_LABEL, type ControlProtocol } from './sensors/trainer-profiles';
import { formatDuration } from './ui/duration';
import { setBlocked, setupBlockedHints, type BlockReason } from './ui/blocked';
import { setupRouter } from './ui/router';
import { FTP_LIMITS, MASS_LIMITS, setupRiderProfile } from './ui/rider-profile';
import { setupWheel } from './ui/wheel-picker';
import { setupAppShell } from './ui/app-shell';
import { setupWorkoutEditor } from './ui/workout-editor';
import { RideHud } from './ui/hud';
import { setupRideMenu } from './ui/ride-menu';
import { setupRecap } from './ui/recap';
import { summarize } from './ui/recap-model';
import { createRadar } from './ui/radar';
import portraitFallback from './assets/rider-portrait.jpg';
import { setupHomeBackground } from './ui/home-background';
import { HOME_SCENES } from './ui/home-scenes';
import { setupCoursePicker } from './ui/course-picker';
import { setupCourseMap } from './ui/course-map';
import { setupAccount } from './ui/account-chip';
import { WorldClient } from './net/world-client';
import { crowdLine, RiderTags } from './ui/rider-tags';
import { RidePanel } from './ui/ride-panel';
import { draftFrom } from './sim/draft';
import { controlModes } from './ui/radar-model';
import { ClimbCounter, PowerAverage } from './ui/hud-model';
import type { RideSnapshot } from './sim/ride';
import { blocksToWorkout } from './workout/blocks';
import { BlockLibrary } from './workout/block-library';
import { WorkoutLibrary } from './workout/library';
import { SAMPLE_WORKOUTS } from './workout/samples';
import { createSyncClient, type SyncSource } from './sync/client';
import { SyncJournal } from './sync/journal';
import type { SyncItem, SyncSetting } from './sync/protocol';
import { blockSource, workoutSource } from './sync/sources';
import { migrateLegacyKeys } from './util/legacy-storage';

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
  text: `${trainer?.name ?? 'Cet appareil'} mesure ta puissance mais ne pilote pas la résistance (pas de ${what}). Il faut un home trainer connecté pour ça.`,
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
let trainer: TrainerAdapter | undefined;

/** Protocole de pilotage imposé depuis l'aide de l'écran Appareils ; vide = choix automatique selon le modèle. */
const PROTOCOL_KEY = 'mamoulinette.trainerProtocol';
const prefs = browserStore();
/** Journal de synchronisation avec le compte : FTP, masse, séances et blocs y notent chaque modification (src/sync/). */
const syncJournal = new SyncJournal(prefs);
const protocolSelect = $<HTMLSelectElement>('trainer-protocol');
const savedProtocol = prefs.getItem(PROTOCOL_KEY) as ControlProtocol | null;
protocolSelect.value = savedProtocol && ALL_PROTOCOLS.includes(savedProtocol) ? savedProtocol : '';
protocolSelect.addEventListener('change', () => {
  try {
    if (protocolSelect.value) prefs.setItem(PROTOCOL_KEY, protocolSelect.value);
    else prefs.removeItem(PROTOCOL_KEY);
  } catch {
    // stockage bloqué : le choix vaut pour cette session
  }
  log(`protocole de pilotage : ${protocolSelect.value ? PROTOCOL_LABEL[protocolSelect.value as ControlProtocol] : 'automatique'}, appliqué à la prochaine connexion`);
});

function newBleTrainer(): WebBluetoothTrainer {
  const t = new WebBluetoothTrainer();
  t.forcedProtocol = (protocolSelect.value || undefined) as ControlProtocol | undefined;
  return t;
}
let hrMonitor: HeartRateMonitor | undefined;

/** Au-delà de ce délai sans mesure de puissance, le cycliste est considéré à l'arrêt dans la simulation. */
const POWER_STALE_MS = 3000;
const rideBtn = $<HTMLButtonElement>('ride-toggle');
const massInput = $<HTMLInputElement>('mass');
/** Sans Cog : la pente du parcours, par pas de 0,5 %. Avec : la pente corrigée suit aussi la vitesse, d'où un pas plus fin. */
let throttle = new GradeThrottle();
const slew = new GradeSlew();
/** ERG engagé : la consigne de puissance prime, et l'envoi de la pente du parcours est suspendu pour ne pas la remplacer. */
let ergActive = false;
/** Le trajet de la page : la simulation, la vue 3D et le HUD le partagent ; il repart du village à chaque sortie. */
const journey = new Journey(COL_DES_ERABLES);
let ride: Ride | undefined;
let rideTimer: ReturnType<typeof setInterval> | undefined;
let lastTick = 0;
let lastPower = { w: 0, at: 0 };
let lastCadence = { rpm: 0, at: 0 };
let lastHr = { bpm: 0, at: 0 };
let lastSpeed = { kmh: 0, at: 0 };
/** Puissance moyenne sur 3 s et dénivelé positif, pour le HUD. */
const power3s = new PowerAverage();
const climb = new ClimbCounter();
let lastRide: RideSnapshot | undefined;
let lastWoState: WorkoutState | undefined;
let view: RideView | undefined;
/** Construction du monde 3D, en tâche de fond dès l'ouverture : elle ne presse que si l'on ouvre la sortie avant la fin. */
let viewBuild = new Background();
let currentState: ConnectionState = 'disconnected';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

function log(msg: string) {
  const ts = new Date().toLocaleTimeString('fr-FR');
  logEl.textContent += `${ts}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  telemetry.record(msg);
}

// Envoie le journal au serveur de logs dès qu'une erreur survient (voir src/telemetry/). `roleState` n'est lu qu'à l'envoi,
// bien après l'évaluation du module.
const telemetry = setupTelemetry({
  log,
  context: () => ({
    trainer: trainer?.name,
    trainerState: currentState,
    capabilities: trainer?.capabilities,
    trainerIdentity: trainer instanceof WebBluetoothTrainer ? trainer.identity : undefined,
    heartRateState: roleState.hr,
    rideRunning: !!ride,
  }),
});

/** Menu de la sortie, rubrique Zwift Cog : qui applique le braquet, le trainer ou la pente corrigée. */
function renderCogMode() {
  $('cog-mode').textContent =
    currentState !== 'connected'
      ? ''
      : trainer?.capabilities.virtualGears
        ? 'Braquet géré par le trainer (protocole Zwift).'
        : protocolSelect.value === 'zwift'
          ? 'Ce trainer ne répond pas au protocole Zwift : braquet simulé par la pente envoyée.'
          : 'Braquet simulé par la pente envoyée au trainer. Pour que le trainer le gère lui-même, choisis « Zwift » comme protocole de pilotage sur l’écran Appareils, puis reconnecte-le.';
}

function setState(s: ConnectionState, detail?: string) {
  currentState = s;
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
      : !trainer?.capabilities.targetPower
        ? noControl('mode ERG')
        : undefined,
  );
  setBlocked(
    simBtn,
    !connected
      ? needTrainer('Connecte d’abord ton home trainer pour lui imposer une pente.')
      : !trainer?.capabilities.simulation
        ? noControl('mode SIM')
        : ride
          ? 'Pendant la sortie virtuelle, la pente vient du parcours. Arrête la sortie pour régler la pente à la main.'
          : undefined,
  );
  // La puissance seule suffit à rouler : la pente n'est envoyée que si le trainer sait la simuler.
  const needPowerToRide = connected || ride ? undefined : needTrainer('La sortie avance avec la puissance de ton home trainer : connecte-le d’abord.');
  setBlocked(rideBtn, needPowerToRide);
  setBlocked(homeRideBtn, needPowerToRide);
  refreshWorkoutButtons();
  if (s === 'connected') resumeRide();
  else {
    // Trainer perdu (écran en veille, montre qui prend le relais…) : la sortie est mise en pause, pas détruite, et
    // l'adaptateur retente la connexion tout seul (essais rapprochés, puis attente de son signal).
    pauseRide();
    setErgActive(false);
  }
  if (connected && trainer) {
    const c = trainer.capabilities;
    const range = c.powerRange ? `, plage ${c.powerRange.min}–${c.powerRange.max} W` : '';
    const id = trainer instanceof WebBluetoothTrainer ? trainer.identity : undefined;
    if (id) telemetry.trainer({ profile: id.profile.id, brand: id.profile.brand, label: id.profile.label, ...id.info, protocol: id.protocol, services: id.services });
    const model = id ? `${id.profile.label}${id.info.firmware ? ` (firmware ${id.info.firmware})` : ''} · pilotage ${id.protocol ? PROTOCOL_LABEL[id.protocol] : 'aucun'} · ` : '';
    $('caps').textContent = `${model}ERG : ${c.targetPower ? 'oui' : 'non'} · SIM : ${c.simulation ? 'oui' : 'non'}${range}${id?.advice ? `. ${id.advice}` : ''}`;
  }
  roleState.trainer = s;
  renderDevices();
}

function attach(t: TrainerAdapter) {
  // L'adaptateur remplacé peut encore attendre son appareil : il ne doit pas s'y reconnecter dans notre dos.
  if (trainer && trainer !== t) void trainer.disconnect();
  trainer = t;
  hub.attachTrainer(t);
  t.on('state', (s, d) => {
    if (trainer !== t) return; // ancien adaptateur remplacé par un nouveau choix d'appareil
    setState(s, d);
    log(`trainer : ${s}${d ? ` (${d})` : ''}`);
    if (s === 'connected' && t instanceof WebBluetoothTrainer && t.deviceId) {
      registry.remember('trainer', { id: t.deviceId, name: t.name });
      renderDevices();
    }
    maybeLeaveDevices();
  });
}

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
const armAutoStart = () => (autoStart = !ride && !runner);
function maybeAutoStart(m: { powerW?: number; cadenceRpm?: number }) {
  if (!autoStart || runner || router.current() !== 'sortie') return;
  if (!((m.powerW ?? 0) > 0 || (m.cadenceRpm ?? 0) > 0)) return;
  if (workout && !workoutStartBlock()) {
    log('premier coup de pédale : démarrage de la séance');
    startWorkout();
  } else if (!ride && currentState === 'connected') {
    log('premier coup de pédale : démarrage de la sortie');
    startRide();
  }
}

hub.on('measurement', (m) => {
  maybeAutoStart(m);
  if (m.powerW !== undefined) lastPower = { w: m.powerW, at: performance.now() };
  if (m.cadenceRpm !== undefined) lastCadence = { rpm: m.cadenceRpm, at: performance.now() };
  if (m.powerW !== undefined) power3s.push(m.powerW, performance.now());
  if (m.heartRateBpm !== undefined) lastHr = { bpm: m.heartRateBpm, at: performance.now() };
  if (m.speedKmh !== undefined) lastSpeed = { kmh: m.speedKmh, at: performance.now() };
});

const fmtTime = (s: number) => formatDuration(Math.floor(s));

/** Les protocoles portent la pente au centième de pourcent. */
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Part de la traînée de l'air épargnée en ce moment par l'aspiration derrière un autre coureur (0 : seul). */
let currentDraft = 0;

/** Aspiration derrière les coureurs que la salle montre : recalculé à chaque pas, avec la position du coureur local. */
function updateDraft(distanceM: number) {
  const others = world.riders();
  if (!ride || others.length === 0) {
    currentDraft = 0;
    ride?.setDraft(0);
    return;
  }
  const me = journey.pointAt(distanceM);
  const leaders = others.map((r) => ({ x: r.point.x, z: r.point.z, heading: r.point.heading, speedMs: r.speedMs, riding: r.riding }));
  currentDraft = draftFrom({ x: me.x, z: me.z, heading: me.heading }, leaders).reduction;
  ride.setDraft(currentDraft);
}

function tickRide() {
  if (!ride) return;
  const now = performance.now();
  const power = now - lastPower.at > POWER_STALE_MS ? 0 : lastPower.w;
  updateDraft(lastRide?.distanceM ?? 0);
  const s = ride.advance((now - lastTick) / 1000, power);
  exporter.onRide(s);
  lastTick = now;
  lastRide = s;
  climb.add(s.altitudeM);
  view?.setState({
    distanceM: s.distanceM,
    speedKmh: s.speedKmh,
    cadenceRpm: now - lastCadence.at > POWER_STALE_MS ? 0 : lastCadence.rpm,
    powerW: power,
    ftpW: readFtp(),
  });
  world.update({
    pos: journey.locate(s.distanceM),
    speedMs: s.speedKmh / 3.6,
    powerW: power,
    cadenceRpm: now - lastCadence.at > POWER_STALE_MS ? 0 : lastCadence.rpm,
    riding: true,
  });

  // Zwift Cog. Protocole Zwift : le trainer reçoit la pente réelle et le braquet, et fait le calcul. Autres protocoles :
  // la pente envoyée est celle qui rend, avec le braquet réel, l'effort du braquet virtuel choisi.
  const g = gears.state();
  const native = g.enabled && !!trainer?.capabilities.virtualGears;
  const model = g.enabled && !native ? trainerModelFor(ride.rider) : undefined;
  const targetGrade = model
    ? round2(gearedGradePct({
        gradePct: s.gradePct,
        speedMs: s.speedKmh / 3.6,
        virtualRatio: g.virtualRatio,
        realRatio: g.realRatio,
        cadenceRpm: now - lastCadence.at > POWER_STALE_MS ? undefined : lastCadence.rpm,
        rider: ride.rider,
        trainer: model,
      }))
    : s.gradePct;
  const sentGrade = round2(slew.next(targetGrade, now));
  if (currentState === 'connected' && trainer?.capabilities.simulation && !ergActive && throttle.shouldSend(sentGrade, now)) {
    throttle.markSent(sentGrade, now);
    hub.setSimulation({ gradePct: sentGrade, massKg: ride.rider.massKg, ...model, ...(native ? { gearRatio: g.virtualRatio } : {}) }).catch((e) => {
      log(`pente non envoyée : ${e instanceof Error ? e.message : e}`);
      setTimeout(() => throttle.reset(), 2000); // nouvel essai, sans marteler le trainer
    });
  }
}

function setErgActive(on: boolean) {
  ergActive = on;
  ergBtn.textContent = on ? "Désengager l'ERG" : "Engager l'ERG";
  ergBtn.classList.toggle('secondary', on);
  if (!on) throttle.reset(); // en sortie, la prochaine mise à jour renvoie la pente du parcours
}

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
  const massKg = Number(massInput.value) || DEFAULT_RIDER.massKg;
  journey.setCourse(coursePicker.selected()); // la sortie repart du départ du parcours choisi, sans choix de carrefour en mémoire
  ride = new Ride(journey, { ...DEFAULT_RIDER, massKg });
  lastRide = ride.snapshot();
  climb.reset();
  throttle.reset();
  slew.reset();
  lastTick = performance.now();
  rideTimer = setInterval(tickRide, 100);
  rideBtn.textContent = 'Arrêter la sortie';
  massInput.readOnly = true;
  massInput.title = 'La masse se règle avant de démarrer la sortie.';
  setState(currentState, trainer?.name);
  log(`sortie virtuelle démarrée (${massKg} kg)`);
}

/** Sortie en pause faute de trainer : position et vitesse gardées, reprises à la reconnexion. */
let ridePaused = false;

function pauseRide() {
  if (!ride || ridePaused) return;
  ridePaused = true;
  clearInterval(rideTimer);
  view?.setState({ distanceM: ride.snapshot().distanceM, speedKmh: 0, cadenceRpm: 0, powerW: 0, ftpW: 0 });
  world.update({ pos: journey.locate(ride.snapshot().distanceM), speedMs: 0, powerW: 0, cadenceRpm: 0, riding: false }, true);
  log('trainer perdu : sortie en pause, elle reprend à la reconnexion');
}

function resumeRide() {
  if (!ride || !ridePaused) return;
  ridePaused = false;
  slew.reset();
  throttle.reset(); // le trainer reconnecté repart de zéro : on lui renvoie la pente
  lastTick = performance.now();
  rideTimer = setInterval(tickRide, 100);
  log('trainer reconnecté : sortie reprise');
}

function stopRide(resetTrainer = true) {
  if (!ride) return;
  clearInterval(rideTimer);
  ridePaused = false;
  setErgActive(false);
  view?.setState({ distanceM: ride.snapshot().distanceM, speedKmh: 0, cadenceRpm: 0, powerW: 0, ftpW: 0 });
  world.update({ pos: journey.locate(ride.snapshot().distanceM), speedMs: 0, powerW: 0, cadenceRpm: 0, riding: false }, true);
  ride = undefined;
  rideBtn.textContent = 'Démarrer la sortie';
  massInput.readOnly = false;
  massInput.title = '';
  log('sortie virtuelle arrêtée');
  if (resetTrainer && currentState === 'connected') void hub.setSimulation({ gradePct: 0 }).catch(() => {});
  setState(currentState, trainer?.name);
}

rideBtn.addEventListener('click', () => {
  if (!ride) return startRide();
  stopRide();
  // Arrêt volontaire, hors séance : la sortie est figée et son récapitulatif s'affiche (docs/design/recap.md).
  if (runner) return;
  exporter.onRideStopped();
  offerRecap();
});

async function start(t: TrainerAdapter, nameHint?: string) {
  attach(t);
  try {
    await t.connect(nameHint);
  } catch (e) {
    log(`échec de connexion : ${e instanceof Error ? e.message : e}`);
  }
}

async function send(label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    log(`${label} envoyé`);
    return true;
  } catch (e) {
    log(`${label} refusé : ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

function newHeartRateMonitor(): HeartRateMonitor {
  const m = new HeartRateMonitor();
  void hrMonitor?.disconnect(); // voir attach()
  hrMonitor = m;
  hub.attachHeartRate(m);
  m.on('state', (s, d) => {
    if (hrMonitor !== m) return;
    roleState.hr = s;
    stateHrEl.dataset.s = s;
    stateHrEl.textContent = stateLabel(s);
    stateHrEl.title = d ?? '';
    log(`cardio : ${s}${d ? ` (${d})` : ''}`);
    if (s === 'connected' && m.deviceId) registry.remember('hr', { id: m.deviceId, name: m.name });
    renderDevices();
    maybeLeaveDevices();
  });
  return m;
}

const connectHrWith = (hint?: string) =>
  void newHeartRateMonitor()
    .connect(hint)
    .catch((e) => log(`échec cardio : ${e instanceof Error ? e.message : e}`));

connectHr.addEventListener('click', () => connectHrWith(registry.get('hr')?.name));
$('connect-hr-other').addEventListener('click', () => connectHrWith());
disconnectHr.addEventListener('click', () => void hrMonitor?.disconnect());
connectBle.addEventListener('click', () => void start(newBleTrainer(), registry.get('trainer')?.name));
$('connect-ble-other').addEventListener('click', () => void start(newBleTrainer()));
connectSim.addEventListener('click', () => void start(new SimulatedTrainer()));
for (const role of ['trainer', 'hr'] as const) {
  $(`forget-${role}`).addEventListener('click', () => {
    const known = registry.get(role);
    if (!known || !confirm(`Oublier « ${known.name} » ? Il ne sera plus reconnecté au lancement.`)) return;
    registry.forget(role);
    log(`appareil oublié : ${known.name}`);
    renderDevices();
  });
}
disconnectBtn.addEventListener('click', () => void trainer?.disconnect());
ergBtn.addEventListener('click', async () => {
  if (ergActive) {
    setErgActive(false);
    if (runner) {
      woErgOptOut = true;
      log('ERG désengagé : la séance continue sans imposer de consigne');
    }
    if (ride) {
      log("ERG désengagé : pente du parcours reprise");
    } else {
      // Hors sortie, le trainer ne quitte l'ERG qu'avec une consigne de pente.
      const g = Number(gradeInput.value);
      await send(`ERG désengagé, SIM ${g} %`, () => hub.setSimulation({ gradePct: g }));
    }
    return;
  }
  // Pendant une séance, réengager rend la main à la séance, qui renvoie aussitôt sa consigne du moment.
  if (runner) {
    woErgOptOut = false;
    follower.reset();
    log('ERG réengagé : la séance reprend sa consigne');
    return tickWorkout();
  }
  const w = Number(ergInput.value);
  if (await send(`ERG ${w} W`, () => hub.setTargetPower(w))) setErgActive(true);
});
// Changer la cible pendant que l'ERG est engagé l'applique aussitôt.
ergInput.addEventListener('change', () => {
  if (!ergActive || runner) return; // en séance, c'est la séance qui fixe la consigne
  const w = Number(ergInput.value);
  void send(`ERG ${w} W`, () => hub.setTargetPower(w));
});
simBtn.addEventListener('click', async () => {
  const g = Number(gradeInput.value);
  if (await send(`SIM ${g} %`, () => hub.setSimulation({ gradePct: g }))) setErgActive(false); // le SIM remplace l'ERG
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
    if (!ride) {
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
const FTP_KEY = 'mamoulinette.ftp';
const MASS_KEY = 'mamoulinette.mass';

const follower = new ErgFollower();
let workout: Workout | undefined;
let runner: WorkoutRunner | undefined;
let woTimer: ReturnType<typeof setInterval> | undefined;
let woPaused = false;
let woLastTick = 0;
/** L'ERG a été désengagé à la main pendant la séance : elle continue sans imposer de consigne jusqu'au réengagement. */
let woErgOptOut = false;
let woSending = false;
/** Après un envoi raté, on attend avant de réessayer pour ne pas marteler le trainer. */
let woHoldUntil = 0;

try {
  const saved = Number(prefs.getItem(FTP_KEY));
  if (saved >= FTP_LIMITS.min) woFtp.value = String(saved);
  const savedMass = Number(prefs.getItem(MASS_KEY));
  if (savedMass >= MASS_LIMITS.min && savedMass <= MASS_LIMITS.max) massInput.value = String(savedMass);
} catch {
  // stockage indisponible (navigation privée) : on garde la valeur par défaut
}
const readFtp = () => (Number(woFtp.value) >= 50 ? Number(woFtp.value) : 200);
const readMass = () => (Number(massInput.value) >= MASS_LIMITS.min ? Number(massInput.value) : DEFAULT_RIDER.massKg);

/** Appelé par l'écran Séances quand « Rouler » doit se remettre à jour (affecté une fois l'éditeur créé). */
// Affecté plus bas, une fois l'éditeur créé : lu avant par des fonctions déjà déclarées.
// eslint-disable-next-line prefer-const
let refreshEditorRide: (() => void) | undefined;

/** Ce qui empêche de démarrer une séance, hors le choix de la séance : séance déjà en cours, trainer absent ou sans ERG. */
function workoutStartBlock(): string | BlockReason | undefined {
  const canErg = currentState === 'connected' && !!trainer?.capabilities.targetPower;
  return runner
    ? 'La séance est déjà en cours.'
    : currentState !== 'connected'
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
  const startReason = !workout && !runner ? 'Choisis d’abord une séance dans la liste.' : workoutStartBlock();
  setBlocked(woStart, startReason);
  setBlocked(homeWoStart, startReason);
  refreshEditorRide?.();
  for (const b of [woPause, woSkip, woStop, woEasier, woHarder]) setBlocked(b, runner ? undefined : 'Démarre d’abord la séance.');
  woPause.textContent = woPaused ? 'Reprendre' : 'Pause';
  // Téléphone couché : les mêmes commandes, posées sur la vue (voir ui/sortie.css).
  rideQuick.hidden = !runner;
  rqPause.setAttribute('aria-pressed', String(woPaused));
  rqPause.setAttribute('aria-label', woPaused ? 'Reprendre' : 'Pause');
  // Dans le menu de la sortie : « Démarrer » avant la séance, les commandes de déroulement pendant.
  woStart.hidden = !!runner;
  for (const b of [woPause, woSkip, woStop]) b.hidden = !runner;
  $('wo-intensity-row').hidden = !runner;
}

function renderProfile() {
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
  if (runner) {
    log("séance en cours : l'arrêter avant d'en choisir une autre");
    return;
  }
  homeSelect.value = value;
  const w = value ? workoutFromChoice(value) : undefined;
  if (!w) {
    workout = undefined;
    $('wo-name').textContent = NO_WORKOUT;
    renderProfile();
    renderWorkout(undefined);
    refreshWorkoutButtons();
    return;
  }
  workout = w;
  armAutoStart();
  for (const x of workout.warnings) log(`séance : ${x}`);
  const total = workout.steps.reduce((t, s) => t + s.durationS, 0);
  $('wo-name').textContent = `${workout.name} · ${fmtTime(total)}${workout.description ? ` · ${workout.description}` : ''}`;
  renderProfile();
  renderWorkout(undefined);
  refreshWorkoutButtons();
  log(`séance choisie : ${workout.name} (${workout.steps.length} paliers, ${fmtTime(total)})`);
}

/** L'état de la séance est affiché par le HUD (palier, profil, curseur, message) : on ne fait que le garder pour lui. */
function renderWorkout(s: WorkoutState | undefined) {
  lastWoState = s;
  // Porte du palier suivant, dans la scène 3D (docs/design/hud.md) : seulement en séance, sortie en cours.
  view?.setGate(runner && s && ride && lastRide ? nextIntervalGate(s, runner.ftpW, lastRide.speedKmh, woPaused) : undefined);
}

/** Relâche l'ERG pris par la séance : hors sortie virtuelle, le trainer ne le quitte qu'avec une consigne de pente. */
function releaseErg(reason: string) {
  if (!ergActive) return;
  setErgActive(false);
  if (ride || currentState !== 'connected') return log(reason);
  const g = Number(gradeInput.value);
  void send(`${reason}, SIM ${g} %`, () => hub.setSimulation({ gradePct: g }));
}

function tickWorkout() {
  if (!runner) return;
  const now = performance.now();
  const dt = (now - woLastTick) / 1000;
  woLastTick = now;
  // Sans trainer connecté, le temps de séance s'arrête : on ne compte pas un palier que personne ne pédale.
  const running = !woPaused && currentState === 'connected';
  const s = running ? runner.advance(dt) : runner.state();
  renderWorkout(s);
  if (s.done) {
    const done = { workout: runner.workout, ftpW: runner.ftpW };
    exporter.onWorkoutFinished(); // l'export s'arrêtera à la fin du dernier palier (export/wiring.ts)
    finishWorkout('séance terminée');
    return offerRecap(done);
  }
  // Consigne et palier notés dans l'enregistrement : le récapitulatif en tire la courbe et les blocs tenus.
  if (running) exporter.onWorkoutState(s.targetW, s.stepIndex);
  if (!running || woErgOptOut || woSending || now < woHoldUntil) return;

  if (s.targetW === undefined) {
    follower.reset();
    return releaseErg(`palier ${STEP_LABEL[s.step.kind].toLowerCase()} : ERG relâché`);
  }
  if (!ergActive) follower.reset(); // ERG relâché ailleurs (fin de sortie, reconnexion) : on le reprend aussitôt
  const w = follower.next(s, now);
  if (w === undefined) return;
  woSending = true;
  hub
    .setTargetPower(w)
    .then(() => {
      if (!ergActive) {
        setErgActive(true);
        log(`séance : ERG engagé à ${w} W`);
      }
    })
    .catch((e) => {
      log(`séance : consigne ${w} W non envoyée (${e instanceof Error ? e.message : e})`);
      follower.reset();
      woHoldUntil = performance.now() + 2000;
    })
    .finally(() => (woSending = false));
}

function startWorkout() {
  if (!workout) return;
  autoStart = false;
  // La séance se roule sur le parcours : sans sortie en cours, le cycliste resterait immobile dans la vue.
  if (!ride && currentState === 'connected') startRide();
  runner = new WorkoutRunner(workout, readFtp());
  woPaused = false;
  woErgOptOut = false;
  woHoldUntil = 0;
  follower.reset();
  woLastTick = performance.now();
  woTimer = setInterval(tickWorkout, 250);
  showIntensity(1);
  refreshWorkoutButtons();
  log(`séance démarrée : ${workout.name}, FTP ${runner.ftpW} W`);
  exporter.onWorkoutStarted(workout.name);
  tickWorkout();
}

function finishWorkout(reason: string) {
  if (!runner) return;
  clearInterval(woTimer);
  runner = undefined;
  woPaused = false;
  woErgOptOut = false;
  if (ergActive) releaseErg(reason);
  else log(reason);
  renderWorkout(undefined);
  refreshWorkoutButtons();
}

homeSelect.addEventListener('change', () => chooseWorkout(homeSelect.value));
homeWoStart.addEventListener('click', () => {
  router.go('sortie');
  startWorkout();
});
// « Rouler » : une sortie déjà en cours se reprend ; sinon on choisit le parcours, puis « Partir » lance la sortie.
homeRideBtn.addEventListener('click', () => {
  if (ride) {
    router.go('sortie');
    return;
  }
  courseDialog.showModal();
  $<HTMLButtonElement>('course-go').focus();
});
/** Garde le réglage sur l'appareil (`undefined` : revient à la valeur par défaut). */
function storeSetting(key: string, v: number | undefined) {
  try {
    if (v === undefined) prefs.removeItem(key);
    else prefs.setItem(key, String(v));
  } catch {
    // préférence non mémorisée, sans conséquence
  }
}
/** La FTP a changé (ici ou sur un autre appareil) : séance en cours, profil et éditeur suivent. */
function ftpChanged() {
  if (runner) runner.ftpW = readFtp();
  renderProfile();
  editor.refresh();
}
massInput.addEventListener('change', () => {
  storeSetting(MASS_KEY, readMass());
  syncJournal.record('setting', 'mass', readMass());
});
woFtp.addEventListener('change', () => {
  storeSetting(FTP_KEY, readFtp());
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
woPause.addEventListener('click', () => {
  woPaused = !woPaused;
  follower.reset();
  log(woPaused ? 'séance en pause' : 'séance reprise');
  refreshWorkoutButtons();
});
woSkip.addEventListener('click', () => {
  if (!runner) return;
  const s = runner.skip();
  follower.reset();
  log(`séance : palier suivant (${STEP_LABEL[s.step.kind]})`);
  tickWorkout();
});
woStop.addEventListener('click', () => finishWorkout('séance arrêtée'));
for (const [btn, delta] of [
  [woEasier, -0.05],
  [woHarder, 0.05],
] as const) {
  btn.addEventListener('click', () => {
    if (!runner) return;
    runner.intensity = Math.min(1.5, Math.max(0.5, Math.round((runner.intensity + delta) * 100) / 100));
    showIntensity(runner.intensity);
    follower.reset();
  });
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
    if (!runner) chooseWorkout(key);
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
    if (!ride && currentState === 'connected') startRide();
  },
  onFinish: () => {
    stopRide();
    router.go('accueil');
  },
});

const router = setupRouter((v) => {
  view?.setActive(v === 'sortie');
  if (v === 'sortie') {
    viewBuild.hurry();
    startViewBuild(); // si le temps mort n'est pas encore venu
  } else viewBuild.calm(); // on a quitté la sortie avant la fin : la construction repasse derrière l'interface
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
    throttle = s.enabled ? new GradeThrottle(0.2, 500) : new GradeThrottle();
    if (why === 'shift') log(`vitesse ${s.gear} (braquet ${s.virtualRatio.toFixed(2)})`);
    else log(s.enabled ? `Zwift Cog : vitesses virtuelles actives, braquet réel ${s.realRatio.toFixed(2)}` : 'Zwift Cog : vitesses virtuelles coupées');
  },
});
if (gears.state().enabled) throttle = new GradeThrottle(0.2, 500);

const registry = new DeviceRegistry();
const roleState: Record<DeviceRole, ConnectionState> = { trainer: 'disconnected', hr: 'disconnected' };
/** Appareils que l'application tente de retrouver seule au lancement ; vide une fois cette phase terminée. */
const launchPending = new Set<DeviceRole>();
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
void import('./render/rider-portrait')
  .then((m) => m.riderPortrait())
  .then((url) => { riderAvatar.src = url; })
  .catch(() => {}); // l'image de repli reste affichée

function renderDevices() {
  const t = registry.get('trainer');
  const h = registry.get('hr');
  // Un appareil attendu (éteint) n'occupe pas le rôle : on peut toujours en choisir un autre.
  const waitingT = trainer instanceof WebBluetoothTrainer && trainer.waitingForDevice;
  const busyT = roleState.trainer === 'connected' || (roleState.trainer === 'connecting' && !waitingT);
  const busyH = roleState.hr === 'connected' || (roleState.hr === 'connecting' && !hrMonitor?.waitingForDevice);
  // Le nom de l'appareil branché prime (le trainer simulé n'est pas mémorisé) ; sinon le dernier appareil connu.
  $('trainer-known').textContent =
    roleState.trainer === 'connected' && trainer?.name ? trainer.name : t ? `Connu : ${t.name}` : 'Aucun trainer connu.';
  $('hr-known').textContent =
    roleState.hr === 'connected' && hrMonitor?.name ? hrMonitor.name : h ? `Connu : ${h.name}` : 'Aucun capteur connu. Facultatif.';
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
      name: (roleState.trainer === 'connected' ? trainer?.name : undefined) ?? t?.name,
      detail: roleState.trainer === 'connected' ? controlModes(trainer?.capabilities) : undefined,
    },
    hr: { state: roleState.hr, name: (roleState.hr === 'connected' ? hrMonitor?.name : undefined) ?? h?.name },
  };
  for (const r of radars) r.update(radarDevices);
}

/**
 * Pendant la reconnexion du lancement : dès que le trainer est connecté et que les autres appareils connus
 * ont abouti (connectés ou en échec), on passe à la sortie sans attendre de clic.
 */
function maybeLeaveDevices() {
  if (!launchPending.size || roleState.trainer !== 'connected') return;
  const settled = [...launchPending].every((r) => roleState[r] === 'connected' || roleState[r] === 'error');
  if (!settled) return;
  launchPending.clear();
  if (router.current() !== 'appareils') return;
  log("appareils connus reconnectés : passage à l'accueil");
  setTimeout(() => router.current() === 'appareils' && router.go('accueil'), 800);
}

async function reconnectKnownDevices() {
  const known = registry.list();
  const note = $('recall-note');
  renderDevices();
  if (!webBluetoothAvailable()) return;
  if (!known.length) {
    note.textContent = 'Première utilisation : connecte ton home trainer pour commencer. Il sera reconnu aux prochains lancements.';
    return;
  }
  if (!canRecallDevices()) {
    note.textContent = 'Ce navigateur ne permet pas de retrouver les appareils sans clic : un clic sur « Reconnecter » par appareil suffit.';
    log('reconnexion automatique indisponible : navigator.bluetooth.getDevices() absent');
    return;
  }
  note.textContent = 'Reconnexion automatique aux appareils connus…';
  let found: Map<DeviceRole, BluetoothDevice>;
  try {
    found = await recallDevices(known);
  } catch (e) {
    note.textContent = 'Reconnexion automatique impossible : un clic sur « Reconnecter » par appareil suffit.';
    log(`getDevices() a échoué : ${e instanceof Error ? e.message : e}`);
    return;
  }
  for (const k of known) {
    if (!found.has(k.role)) log(`${k.name} : autorisation du site perdue, à reconnecter d'un clic`);
  }
  if (!found.size) {
    note.textContent = 'Les autorisations Bluetooth de ce site ont été effacées : un clic sur « Reconnecter » par appareil suffit.';
    return;
  }
  for (const role of found.keys()) launchPending.add(role);
  const td = found.get('trainer');
  if (td) {
    const t = newBleTrainer();
    attach(t);
    void t.connectDevice(td, true);
  }
  const hd = found.get('hr');
  if (hd) void newHeartRateMonitor().connectDevice(hd, true);
  note.textContent = `Reconnexion automatique : ${[...found.values()].map((d) => d.name ?? 'appareil').join(', ')}. Allume-les si ce n'est pas déjà fait.`;
}

$('go-ride').addEventListener('click', () => router.go('accueil'));

$('copy-log').addEventListener('click', () => void navigator.clipboard.writeText(logEl.textContent ?? ''));

const exporter = setupExport({
  hub,
  button: $<HTMLButtonElement>('export-fit'),
  stravaButton: $<HTMLButtonElement>('export-strava'),
  routeName: journey.name,
  log,
  // Arrêt puis 5 s de pédalage après la fin : le récapitulatif s'efface de lui-même (docs/design/recap.md).
  onResumed: () => {
    if (!recap.open) return;
    log('pédalage repris : récapitulatif fermé');
    recap.dismissByPedaling();
  },
});

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
    rideRunning: !!ride,
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
/** Profil de rendu : `?quality=high|low`, sinon `low` sur écran tactile (src/render/quality.ts). Le HUD le suit (sans flou en `low`). */
const quality = chooseQuality(params.get('quality'), matchMedia('(pointer: coarse)').matches);
const hud = new RideHud($('hud'), journey, { flat: quality === 'low' });
const fresh = (at: number) => performance.now() - at <= POWER_STALE_MS;
function renderHud() {
  if (router.current() !== 'sortie') return;
  hud.update({
    powerW: power3s.value(performance.now()),
    heartRateBpm: fresh(lastHr.at) ? lastHr.bpm : undefined,
    cadenceRpm: fresh(lastCadence.at) ? lastCadence.rpm : undefined,
    // Pendant la sortie, la vitesse virtuelle (celle qui fait avancer la vue) ; sinon celle mesurée par le trainer.
    speedKmh: ride && lastRide ? lastRide.speedKmh : fresh(lastSpeed.at) ? lastSpeed.kmh : undefined,
    ftpW: runner?.ftpW ?? readFtp(),
    ride: ride && lastRide ? { snapshot: lastRide, climbM: climb.total } : undefined,
    workout: runner && lastWoState ? { workout: runner.workout, state: lastWoState, ftpW: runner.ftpW, intensity: runner.intensity } : undefined,
    message: runner ? lastWoState?.message : undefined,
    control: ergActive ? 'erg' : ride && trainer?.capabilities.simulation ? 'sim' : undefined,
    trainerConnected: roleState.trainer === 'connected',
    heartRateConnected: roleState.hr === 'connected',
    ...(ride && lastRide ? { junction: journey.pendingJunction(lastRide.distanceM) } : {}),
  });
  // Encart : la carte suit le coureur ; elle passe seule au premier plan 250 m avant un carrefour (docs/design/sortie.md).
  const at = ride && lastRide ? lastRide.distanceM : 0;
  ridePanel.update({
    distanceM: at,
    pending: ride && lastRide ? journey.pendingJunction(at) : undefined,
    // Sur la piste d'un vélodrome : la touche de sortie remplace le panneau « Carrefour » de chaque tour.
    trackExit: ride && lastRide && journey.onTrack(at) ? { armed: journey.trackExitArmed, inM: journey.trackExitInM(at) } : undefined,
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
  if (by && ride && lastRide && journey.onTrack(lastRide.distanceM)) {
    e.preventDefault();
    journey.setTrackExit(by > 0);
    renderHud();
    return;
  }
  const p = by && ride && lastRide ? journey.pendingJunction(lastRide.distanceM) : undefined;
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
/** Pertes du GPU déjà subies : la deuxième fait passer en WebGL2, au-delà de `MAX_GPU_LOSSES` on renonce à la vue. */
let gpuLosses = 0;
const MAX_GPU_LOSSES = 3;

/**
 * Construit la vue 3D (en tâche de fond : `viewBuild`) et l'installe. Après une perte du GPU, on recommence sur un
 * canevas neuf : un canevas garde le contexte qu'il a perdu, et three.js ne recrée pas ses ressources.
 */
async function buildView() {
  const { RideView } = await import('./render/ride-view');
  const v = await RideView.create($<HTMLCanvasElement>('view'), journey, {
    onProgress: showRideProgress,
    forceWebGL: params.get('renderer') === 'webgl2' || gpuLosses >= 2,
    quality,
    ...(relief !== undefined ? { relief } : {}),
  }, viewBuild);
  performance.mark('view-ready'); // relevé par tools/audit/startup.cjs
  view = v;
  void v.firstFrame.then(() => (rideLoading.hidden = true));
  v.setActive(router.current() === 'sortie');
  v.onLost = onGpuLost;
  v.setOthers(() => world.riders());
  v.onTags = (tags) => riderTags.set(tags);
  v.onNearby = (n) => ridePanel.setNearby(n, ride ? currentDraft : 0);
  v.onStats = (s) => {
    $('view-stats').textContent =
      `${s.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · ${s.fps.toFixed(0)} i/s · ` +
      `p50 ${s.frameP50Ms.toFixed(1)} ms · p95 ${s.frameP95Ms.toFixed(1)} ms · ` +
      `${(s.triangles / 1000).toFixed(0)} k triangles · ${s.drawCalls} appels`;
  };
  log(`rendu 3D : ${v.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · qualité ${quality}${gpuLosses ? ` · reprise n° ${gpuLosses}` : ''}`);
}

function onGpuLost(loss: GpuLoss) {
  gpuLosses++;
  log(`rendu 3D : GPU perdu (${loss.api} : ${loss.message}), reprise ${gpuLosses}/${MAX_GPU_LOSSES}`);
  view?.dispose();
  view = undefined;
  if (gpuLosses > MAX_GPU_LOSSES) return viewUnavailable(new Error('GPU perdu trop souvent'));
  const old = $<HTMLCanvasElement>('view');
  const fresh = old.cloneNode(false) as HTMLCanvasElement;
  old.replaceWith(fresh);
  rideLoading.hidden = false;
  showRideProgress(0, 'Reprise de la vue 3D');
  viewBuild = new Background();
  if (router.current() === 'sortie') viewBuild.hurry();
  viewBuildState = 'none';
  startViewBuild();
}

function viewUnavailable(e: unknown) {
  $('view-stats').textContent = 'rendu 3D indisponible';
  rideLoading.hidden = false;
  rideLoading.dataset.state = 'error';
  $('ride-loading-title').textContent = 'Vue 3D indisponible';
  $('ride-loading-step').textContent = 'La sortie fonctionne sans elle : mesures, profil et séance restent affichés.';
  log(`rendu 3D indisponible : ${e instanceof Error ? e.message : e}`);
}

/** `none` : rien de lancé (ou vue perdue, à refaire) ; ensuite une seule construction, jusqu'à la vue ou l'échec. */
let viewBuildState: 'none' | 'building' | 'done' = 'none';
/** Lance la construction : au premier temps mort après l'affichage, ou à l'ouverture de la sortie si elle vient avant. */
function startViewBuild() {
  if (viewBuildState !== 'none') return;
  viewBuildState = 'building';
  buildView().then(
    () => (viewBuildState = 'done'),
    (e: unknown) => {
      viewBuildState = 'done';
      // GPU perdu pendant la construction : même reprise qu'après.
      if (e instanceof Error && e.name === 'GpuLostError') onGpuLost((e as Error & { loss: GpuLoss }).loss);
      else viewUnavailable(e);
    },
  );
}
// three.js (~1 Mio) n'est demandé qu'après le premier affichage, pendant un temps mort : l'accueil répond tout de suite.
if (typeof requestIdleCallback === 'function') requestIdleCallback(startViewBuild, { timeout: 2000 });
else setTimeout(startViewBuild, 300);

// Service worker (build de production seulement) : relancement instantané et hors ligne. Il est généré au build avec la
// liste des fichiers de la version (tools/offline/). En développement, il servirait des fichiers périmés.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e: unknown) => log(`hors ligne indisponible : ${e instanceof Error ? e.message : e}`));
  });
}

// Aperçu du récapitulatif sans rouler, en développement seulement (voir ui/recap-demo.ts) : ?recap, ?recap=libre…
if (import.meta.env.DEV && params.has('recap')) {
  const sample = SAMPLE_WORKOUTS.find((s) => s.id === 'sweet-spot')!;
  void import('./ui/recap-demo').then((m) => {
    router.go('sortie');
    m.showRecapDemo($('recap').parentElement!, params.get('recap') ?? '', parseWorkout(sample.fileName, sample.text), readFtp(), journey.name);
  });
}

// Données du coureur synchronisées avec son compte : FTP, masse, séances, « Mes blocs » (docs/design/compte.md).
const SETTING_FIELDS: Record<SyncSetting, { input: HTMLInputElement; key: string }> = {
  ftp: { input: woFtp, key: FTP_KEY },
  mass: { input: massInput, key: MASS_KEY },
};
const settingsSource: SyncSource = {
  kind: 'setting',
  all: () =>
    (Object.keys(SETTING_FIELDS) as SyncSetting[]).flatMap((id): SyncItem[] => {
      const raw = prefs.getItem(SETTING_FIELDS[id].key);
      // Un réglage sans version (fait avant la synchronisation) cède devant celui du compte.
      return raw === null ? [] : [{ kind: 'setting', id, body: Number(raw), updatedAt: syncJournal.stamp('setting', id) ?? 0 }];
    }),
  apply(items) {
    for (const i of items) {
      const f = SETTING_FIELDS[i.id as SyncSetting];
      if (!f) continue;
      const v = typeof i.body === 'number' ? i.body : undefined;
      // Pendant une sortie, la masse de la sortie ne change pas (Ride l'a prise au départ) : seule la valeur gardée suit.
      f.input.value = String(v ?? f.input.defaultValue);
      storeSetting(f.key, v);
    }
    if (items.some((i) => i.id === 'ftp')) ftpChanged();
    riderProfile.refresh();
  },
  clear() {
    for (const f of Object.values(SETTING_FIELDS)) {
      f.input.value = f.input.defaultValue;
      storeSetting(f.key, undefined);
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
  if (changed && !runner) chooseWorkout(homeSelect.value);
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
  if (document.visibilityState === 'visible' && trainer instanceof WebBluetoothTrainer) trainer.retryNow();
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
setState(currentState); // chaque bouton reçoit dès le départ sa raison d'être indisponible
void reconnectKnownDevices();
