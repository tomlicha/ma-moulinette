import { DeviceManager } from '../app/device-manager';
import { DeviceRegistry } from '../infra/sensors/device-registry';
import { DevicesView } from '../ui/devices/devices-view';
import { PROTOCOL_LABEL } from '../infra/sensors/protocols/trainer-profiles';
import { SimulatedTrainer } from '../infra/sensors/simulator';
import { browserUa, noBluetoothHint, noBluetoothStatus } from '../infra/sensors/ble/bluetooth-support';
import { createRadar } from '../ui/ride/radar';
import { isNativeShell } from '../infra/native/shell';
import portraitFallback from '../assets/rider-portrait.jpg';
import { webBluetoothAvailable } from '../infra/sensors/ble/gatt-device';
import { byId as $ } from '../ui/shared/dom';
import type { Wiring } from './wiring';

export function composeDevices(w: Wiring): void {
  w.renderDevices = renderDevices;

  /** Les appareils : trainer et ceinture cardio, ceux qu'on connaît déjà, et leur reconnexion au lancement. */
  const devices = new DeviceManager({ hub: w.hub, trainer: w.trainerCtl, registry: new DeviceRegistry(), log: w.log, createBleTrainer: w.newBleTrainer });
  w.devices = devices;

  // Le médaillon du radar ouvre la fiche du coureur ; sur l'accueil, la tuile reste un simple lien vers les appareils.
  const radars = [
    createRadar($('radar-devices'), 'large', { onRider: w.riderProfile.open }),
    createRadar($('radar-home'), 'mini'),
  ];

  const riderAvatar = $<HTMLImageElement>('rider-avatar');

  riderAvatar.src = portraitFallback;

  void import('../render/riders/rider-portrait')
    .then((m) => m.riderPortrait())
    .then((url) => { riderAvatar.src = url; })
    .catch(() => {});

   // l'image de repli reste affichée

  /** Les cartes de l'écran Appareils (devices-view.ts) : elles demandent, composition/ relie aux contrôleurs. */
  const devicesView = new DevicesView(radars, {
    connectTrainer: (useKnown) => void devices.connectTrainer(useKnown ? devices.known('trainer')?.name : undefined),
    connectSimulator: () => void w.trainerCtl.connect(new SimulatedTrainer()),
    disconnectTrainer: () => w.trainerCtl.disconnect(),
    connectHeartRate: (useKnown) => devices.connectHeartRate(useKnown ? devices.known('hr')?.name : undefined),
    disconnectHeartRate: () => devices.disconnectHeartRate(),
    forget: (role) => devices.forget(role),
    goRide: () => w.router.go('accueil'),
    protocolChanged: (protocol) => {
      w.settings.saveTrainerProtocol(protocol);
      w.log(`protocole de pilotage : ${protocol ? PROTOCOL_LABEL[protocol] : 'automatique'}, appliqué à la prochaine connexion`);
    },
  });
  w.devicesView = devicesView;

  devicesView.setForcedProtocol(w.settings.trainerProtocol());

  function renderDevices() {
    const states = devices.states;
    devicesView.render({
      trainer: {
        state: states.trainer,
        name: w.trainerCtl.name,
        known: devices.known('trainer'),
        waiting: devices.trainerWaiting,
        capabilities: w.trainerCtl.capabilities,
      },
      hr: { state: states.hr, name: devices.heartRate?.name, known: devices.known('hr'), waiting: devices.heartRateWaiting },
      bluetooth: { available: webBluetoothAvailable(), hint: noBluetoothHint(browserUa()) },
    });
    w.rideMenu.setAlert(states.trainer !== 'connected');
  }

  devices.on('changed', renderDevices);

  devices.on('heartRateState', (s, d) => devicesView.showHeartRateState(s, d));

  /** Pendant la reconnexion du lancement : une fois les appareils connus reconnectés, on passe à la sortie sans attendre de clic. */
  devices.on('launchSettled', () => {
    if (w.router.current() !== 'appareils') return;
    w.log("appareils connus reconnectés : passage à l'accueil");
    setTimeout(() => w.router.current() === 'appareils' && w.router.go('accueil'), 800);
  });

  devices.on('recall', (status) => devicesView.showRecall(status));

  devicesView.showSupport(webBluetoothAvailable() ? (isNativeShell() ? 'Bluetooth disponible.' : 'Web Bluetooth disponible.') : noBluetoothStatus(browserUa()));
}
