import { webBluetoothAvailable } from '../infra/sensors/ble/gatt-device';
import { HeartRateMonitor } from '../infra/sensors/heart-rate-monitor';
import type { SensorHub } from '../infra/sensors/hub';
import { canRecallDevices, recallDevices, type DeviceRegistry, type DeviceRole, type KnownDevice } from '../infra/sensors/device-registry';
import type { ConnectionState, TrainerAdapter } from '../infra/sensors/types';
import { TypedEmitter } from '../shared/util/typed-emitter';
import type { TrainerController } from './trainer-controller';

/** Un appareil Bluetooth à retrouver : ce que le trainer Bluetooth et la ceinture cardio ont en commun. */
export interface BleDevice {
  readonly name: string;
  readonly deviceId: string | undefined;
  readonly waitingForDevice: boolean;
  connect(nameHint?: string): Promise<void>;
  connectDevice(device: BluetoothDevice, keepTrying?: boolean): Promise<void>;
  disconnect(): Promise<void>;
}

/** Le Bluetooth du navigateur, tel que le gestionnaire le consulte (remplaçable en test). */
export interface BluetoothAccess {
  available(): boolean;
  canRecall(): boolean;
  recall(known: KnownDevice[]): Promise<Map<DeviceRole, BluetoothDevice>>;
}

const realBluetooth: BluetoothAccess = { available: webBluetoothAvailable, canRecall: canRecallDevices, recall: recallDevices };

/** Où en est la reconnexion automatique du lancement : de quoi dire au coureur ce qui se passe. */
export type RecallStatus =
  | { kind: 'first-use' }
  | { kind: 'unavailable' }
  | { kind: 'searching' }
  | { kind: 'failed' }
  | { kind: 'permissions-lost' }
  | { kind: 'reconnecting'; names: string[] };

/** La part du `TrainerController` dont le gestionnaire a besoin. */
export type DeviceTrainer = Pick<TrainerController, 'on' | 'attach' | 'connect' | 'device' | 'name'>;

export interface DeviceManagerDeps {
  hub: SensorHub;
  trainer: DeviceTrainer;
  registry: DeviceRegistry;
  log: (message: string) => void;
  /** Un trainer Bluetooth neuf (le protocole de pilotage imposé par le coureur est appliqué par l'appelant). */
  createBleTrainer: () => TrainerAdapter & BleDevice;
  createHeartRateMonitor?: () => HeartRateMonitor & BleDevice;
  bluetooth?: BluetoothAccess;
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Les appareils du coureur : le trainer et la ceinture cardio, ceux qu'on connaît déjà, et leur reconnexion au lancement.
 *
 * Une seule responsabilité : savoir quels appareils sont connectés (par rôle), retenir ceux qui l'ont été et les
 * retrouver au lancement. Il ne dessine rien : il publie ce qui change (`changed`, `heartRateState`, `recall`,
 * `launchSettled`) et l'écran des appareils s'y abonne. Le trainer lui-même reste au `TrainerController`.
 */
export class DeviceManager extends TypedEmitter<{
  /** L'état d'un rôle ou la liste des appareils connus a changé : l'écran des appareils se redessine. */
  changed: [];
  heartRateState: [state: ConnectionState, detail: string | undefined];
  recall: [status: RecallStatus];
  /** Reconnexion du lancement terminée : le trainer est connecté et les autres appareils ont abouti (ou échoué). */
  launchSettled: [];
}> {
  private readonly roleStates: Record<DeviceRole, ConnectionState> = { trainer: 'disconnected', hr: 'disconnected' };
  private hr?: HeartRateMonitor & BleDevice;
  /** Appareils que l'application tente de retrouver seule au lancement ; vide une fois cette phase terminée. */
  private readonly launchPending = new Set<DeviceRole>();
  private readonly bluetooth: BluetoothAccess;

  constructor(private readonly deps: DeviceManagerDeps) {
    super();
    this.bluetooth = deps.bluetooth ?? realBluetooth;
    // Branché tout de suite : l'état du trainer est à jour avant que l'écran ne réagisse au même événement.
    deps.trainer.on('state', (state) => {
      this.roleStates.trainer = state;
      const dev = deps.trainer.device as Partial<BleDevice> | undefined;
      if (state === 'connected' && dev?.deviceId) deps.registry.remember('trainer', { id: dev.deviceId, name: dev.name ?? '' });
      this.emit('changed');
      this.maybeSettleLaunch();
    });
  }

  /** État de connexion de chaque rôle. */
  get states(): Readonly<Record<DeviceRole, ConnectionState>> {
    return this.roleStates;
  }

  /** La ceinture cardio branchée, s'il y en a une. */
  get heartRate(): (HeartRateMonitor & BleDevice) | undefined {
    return this.hr;
  }

  /** Le trainer Bluetooth attend son appareil (éteint) : il n'occupe pas le rôle, on peut en choisir un autre. */
  get trainerWaiting(): boolean {
    return !!(this.deps.trainer.device as Partial<BleDevice> | undefined)?.waitingForDevice;
  }

  get heartRateWaiting(): boolean {
    return !!this.hr?.waitingForDevice;
  }

  /** Appareil connu pour ce rôle. */
  known(role: DeviceRole): KnownDevice | undefined {
    return this.deps.registry.get(role);
  }

  /** Oublie l'appareil connu de ce rôle : il ne sera plus reconnecté au lancement. */
  forget(role: DeviceRole): void {
    const known = this.deps.registry.get(role);
    if (!known) return;
    this.deps.registry.forget(role);
    this.deps.log(`appareil oublié : ${known.name}`);
    this.emit('changed');
  }

  /** Cherche un trainer Bluetooth ; `nameHint` limite le sélecteur à l'appareil connu. */
  connectTrainer(nameHint?: string): Promise<void> {
    return this.deps.trainer.connect(this.deps.createBleTrainer(), nameHint);
  }

  /** Cherche une ceinture cardio ; `nameHint` limite le sélecteur à l'appareil connu. */
  connectHeartRate(nameHint?: string): void {
    this.newHeartRateMonitor()
      .connect(nameHint)
      .catch((e) => this.deps.log(`échec cardio : ${reason(e)}`));
  }

  disconnectHeartRate(): void {
    void this.hr?.disconnect();
  }

  /**
   * Retrouve les appareils connus sans clic (reconnexion du lancement). Le déroulement est publié sous forme de
   * `recall` ; quand le trainer et les autres appareils ont abouti, `launchSettled`.
   */
  async reconnectKnown(): Promise<void> {
    const { log } = this.deps;
    const known = this.deps.registry.list();
    this.emit('changed');
    if (!this.bluetooth.available()) return;
    if (!known.length) return this.emit('recall', { kind: 'first-use' });
    if (!this.bluetooth.canRecall()) {
      this.emit('recall', { kind: 'unavailable' });
      log('reconnexion automatique indisponible : navigator.bluetooth.getDevices() absent');
      return;
    }
    this.emit('recall', { kind: 'searching' });
    let found: Map<DeviceRole, BluetoothDevice>;
    try {
      found = await this.bluetooth.recall(known);
    } catch (e) {
      this.emit('recall', { kind: 'failed' });
      log(`getDevices() a échoué : ${reason(e)}`);
      return;
    }
    for (const k of known) {
      if (!found.has(k.role)) log(`${k.name} : autorisation du site perdue, à reconnecter d'un clic`);
    }
    if (!found.size) return this.emit('recall', { kind: 'permissions-lost' });
    for (const role of found.keys()) this.launchPending.add(role);
    const trainerDevice = found.get('trainer');
    if (trainerDevice) {
      const trainer = this.deps.createBleTrainer();
      this.deps.trainer.attach(trainer);
      void trainer.connectDevice(trainerDevice, true);
    }
    const hrDevice = found.get('hr');
    if (hrDevice) void this.newHeartRateMonitor().connectDevice(hrDevice, true);
    this.emit('recall', { kind: 'reconnecting', names: [...found.values()].map((d) => d.name ?? 'appareil') });
  }

  private newHeartRateMonitor(): HeartRateMonitor & BleDevice {
    const { hub, registry, log } = this.deps;
    const monitor = this.deps.createHeartRateMonitor?.() ?? (new HeartRateMonitor() as HeartRateMonitor & BleDevice);
    void this.hr?.disconnect(); // l'ancienne ceinture ne doit pas se reconnecter dans notre dos
    this.hr = monitor;
    hub.attachHeartRate(monitor);
    monitor.on('state', (state, detail) => {
      if (this.hr !== monitor) return; // ancienne ceinture, remplacée
      this.roleStates.hr = state;
      this.emit('heartRateState', state, detail);
      log(`cardio : ${state}${detail ? ` (${detail})` : ''}`);
      if (state === 'connected' && monitor.deviceId) registry.remember('hr', { id: monitor.deviceId, name: monitor.name });
      this.emit('changed');
      this.maybeSettleLaunch();
    });
    return monitor;
  }

  /**
   * Pendant la reconnexion du lancement : dès que le trainer est connecté et que les autres appareils connus ont
   * abouti (connectés ou en échec), on le dit une fois.
   */
  private maybeSettleLaunch(): void {
    if (!this.launchPending.size || this.roleStates.trainer !== 'connected') return;
    const settled = [...this.launchPending].every((r) => this.roleStates[r] === 'connected' || this.roleStates[r] === 'error');
    if (!settled) return;
    this.launchPending.clear();
    this.emit('launchSettled');
  }
}
