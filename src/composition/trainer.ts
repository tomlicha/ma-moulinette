import { GradeController } from '../app/grade-controller';
import { SensorReadings } from '../app/sensor-readings';
import { TrainerController } from '../app/trainer-controller';
import { WebBluetoothTrainer } from '../infra/sensors/ble/web-bluetooth';
import { needTrainer as needTrainerReason, noControl as noControlReason } from '../ui/ride/trainer-reasons';
import type { BlockReason } from '../ui/shared/blocked';
import type { ConnectionState } from '../infra/sensors/types';
import type { Wiring } from './wiring';

export function composeTrainer(w: Wiring): void {
  w.newBleTrainer = newBleTrainer;
  w.setState = setState;

  /** Raisons « pas de trainer » et « ce trainer ne pilote pas cela », avec le raccourci qui mène à l'écran des appareils. */
  const needTrainer = (text: string): BlockReason => needTrainerReason(() => w.router.go('appareils'), text);
  w.needTrainer = needTrainer;

  const noControl = (what: string): BlockReason => noControlReason(() => w.router.go('appareils'), trainerCtl.name, what);
  w.noControl = noControl;

  function newBleTrainer(): WebBluetoothTrainer {
    const t = new WebBluetoothTrainer();
    t.forcedProtocol = w.devicesView.forcedProtocol;
    return t;
  }

  /** Dernières mesures des capteurs, tant qu'elles sont fraîches (au-delà de 3 s de silence, le cycliste est à l'arrêt). */
  const readings = new SensorReadings();
  w.readings = readings;

  /** Pente envoyée au trainer (lissage, braquet virtuel, fréquence d'envoi) et état « ERG engagé » : la consigne de puissance prime sur la pente. */
  const grade = new GradeController();
  w.grade = grade;

  /** Le trainer branché : connexion, état, commandes ERG et pente. */
  const trainerCtl = new TrainerController({ hub: w.hub, grade, log: w.log });
  w.trainerCtl = trainerCtl;

  // Le journal passe avant tout autre abonné : « trainer : connected » précède ce que les autres en déduisent.
  trainerCtl.on('state', (s, d) => w.log(`trainer : ${s}${d ? ` (${d})` : ''}`));

  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

  function setState(s: ConnectionState, detail?: string) {
    w.exporter.onTrainerState(s);
    w.devicesView.showTrainerState(s, detail);
    const connected = s === 'connected';
    // Les boutons de connexion sont réglés par renderDevices, plus bas.
    const needPowerToRide = w.rideControls.render({
      trainerConnected: connected,
      trainerName: trainerCtl.name,
      capabilities: trainerCtl.capabilities,
      rideActive: w.rideSession.active,
      forcedProtocol: w.devicesView.forcedProtocol,
    });
    w.home.setRideBlock(needPowerToRide);
    w.refreshWorkoutButtons();
    if (s === 'connected') w.rideSession.resume();
    else {
      // Trainer perdu (écran en veille, montre qui prend le relais…) : la sortie est mise en pause, pas détruite, et
      // l'adaptateur retente la connexion tout seul (essais rapprochés, puis attente de son signal).
      w.rideSession.pause();
      trainerCtl.setErgActive(false);
    }
    const dev = trainerCtl.device;
    if (connected && dev) {
      const id = dev instanceof WebBluetoothTrainer ? dev.identity : undefined;
      if (id) w.telemetry.trainer({ profile: id.profile.id, brand: id.profile.brand, label: id.profile.label, ...id.info, protocol: id.protocol, services: id.services });
      w.devicesView.showCapabilities(dev.capabilities, id);
    }
    w.renderDevices();
  }

  // Le trainer change d'état (connexion, perte, reconnexion automatique) : l'écran et la sortie suivent.
  trainerCtl.on('state', (s, d) => setState(s, d));

  trainerCtl.on('erg', (engaged) => w.rideControls.showErgEngaged(engaged));

  w.hub.on('log', w.log);

  w.hub.on('raw', (src, data) => {
    // Les trames brutes servent à documenter chaque modèle de trainer ; on ne journalise pas tout le flux.
    if (src !== 'Indoor Bike Data' && src !== 'Heart Rate' && src !== 'Cycling Power' && src !== 'FE-C' && src !== 'Zwift Data') w.log(`${src} : ${hex(data)}`);
  });

  w.hub.on('measurement', (m) => {
    w.autoStart.onMeasurement(m);
    w.workoutSession.onMeasurement(m);
    readings.record(m);
  });
}
