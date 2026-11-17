/**
 * Pont Web Bluetooth → Bluetooth natif, pour la coquille Capacitor (iPad, iPhone).
 *
 * Safari et les WebView iOS n'ont pas `navigator.bluetooth`. Plutôt que de dupliquer les pilotes de trainer
 * (FTMS, Wahoo, Zwift, FE-C, cardio, reconnexion), ce module expose la partie de l'API Web Bluetooth qu'ils
 * utilisent, au-dessus du plugin `@capacitor-community/bluetooth-le`. `installNativeBluetooth()` ne fait rien
 * hors de la coquille native : dans Chrome, `navigator.bluetooth` reste le vrai.
 *
 * Écarts assumés avec Web Bluetooth :
 * - le sélecteur d'appareil est celui du plugin, qui n'accepte qu'un jeu de services (union des filtres) et un
 *   seul nom ou préfixe ; plusieurs filtres de nom sans service → pas de filtre, et `exclusionFilters` est ignoré ;
 * - `id` est l'identifiant CoreBluetooth, stable pour cette installation : `getDevices()` le retrouve sans clic.
 */
import { Capacitor } from '@capacitor/core';
import type { BleCharacteristicProperties, BleDevice, BleService } from '@capacitor-community/bluetooth-le';

type BleClientType = typeof import('@capacitor-community/bluetooth-le').BleClient;
/** Ce que le pont demande au plugin ; remplaçable dans les tests. */
export type BleBackend = Pick<
  BleClientType,
  | 'initialize' | 'requestDevice' | 'requestLEScan' | 'stopLEScan' | 'getDevices' | 'connect' | 'disconnect'
  | 'getServices' | 'read' | 'write' | 'writeWithoutResponse' | 'startNotifications' | 'stopNotifications'
>;

const BASE = '-0000-1000-8000-00805f9b34fb';

/** `0x1826` ou `'1826'` → UUID 128 bits en minuscules, comme `BluetoothUUID.canonicalUUID`. */
export function canonicalUUID(u: number | string): string {
  if (typeof u === 'number') return `${u.toString(16).padStart(8, '0')}${BASE}`;
  const s = u.toLowerCase();
  if (/^[0-9a-f]{4}$/.test(s)) return `0000${s}${BASE}`;
  if (/^[0-9a-f]{8}$/.test(s)) return `${s}${BASE}`;
  return s;
}

const same = (a: string, b: string) => canonicalUUID(a) === canonicalUUID(b);

class NativeCharacteristic extends EventTarget {
  value?: DataView;
  readonly uuid: string;
  readonly properties: BleCharacteristicProperties;

  constructor(private readonly io: BleBackend, private readonly deviceId: string, private readonly service: string, uuid: string, props: BleCharacteristicProperties) {
    super();
    this.uuid = canonicalUUID(uuid);
    this.properties = props;
  }

  async readValue(): Promise<DataView> {
    this.value = await this.io.read(this.deviceId, this.service, this.uuid);
    return this.value;
  }
  writeValueWithResponse(data: BufferSource) {
    return this.io.write(this.deviceId, this.service, this.uuid, view(data));
  }
  writeValueWithoutResponse(data: BufferSource) {
    return this.io.writeWithoutResponse(this.deviceId, this.service, this.uuid, view(data));
  }
  writeValue(data: BufferSource) {
    return this.properties.write ? this.writeValueWithResponse(data) : this.writeValueWithoutResponse(data);
  }
  async startNotifications(): Promise<this> {
    await this.io.startNotifications(this.deviceId, this.service, this.uuid, (v) => {
      this.value = v;
      this.dispatchEvent(new Event('characteristicvaluechanged'));
    });
    return this;
  }
  async stopNotifications(): Promise<this> {
    await this.io.stopNotifications(this.deviceId, this.service, this.uuid);
    return this;
  }
}

function view(data: BufferSource): DataView {
  return ArrayBuffer.isView(data) ? new DataView(data.buffer, data.byteOffset, data.byteLength) : new DataView(data);
}

const notFound = (what: string) => Object.assign(new Error(`${what} introuvable`), { name: 'NotFoundError' });

class NativeService {
  readonly uuid: string;
  private readonly chars = new Map<string, NativeCharacteristic>();
  constructor(private readonly io: BleBackend, private readonly deviceId: string, private readonly info: BleService) {
    this.uuid = canonicalUUID(info.uuid);
  }
  /** Même objet à chaque appel : les écouteurs de notification s'y accrochent et ne doivent pas se doubler. */
  private wrap(c: BleService['characteristics'][number]): NativeCharacteristic {
    const key = canonicalUUID(c.uuid);
    let n = this.chars.get(key);
    if (!n) this.chars.set(key, (n = new NativeCharacteristic(this.io, this.deviceId, this.uuid, c.uuid, c.properties)));
    return n;
  }
  async getCharacteristic(u: number | string): Promise<NativeCharacteristic> {
    const c = this.info.characteristics.find((x) => same(x.uuid, canonicalUUID(u)));
    if (!c) throw notFound(`Caractéristique ${canonicalUUID(u)}`);
    return this.wrap(c);
  }
  async getCharacteristics(): Promise<NativeCharacteristic[]> {
    return this.info.characteristics.map((c) => this.wrap(c));
  }
}

class NativeGatt {
  connected = false;
  private services = new Map<string, NativeService>();
  constructor(private readonly io: BleBackend, private readonly device: NativeDevice, private readonly timeoutMs = 20_000) {}

  async connect(): Promise<this> {
    // Les objets du service précédent sont jetés : une session GATT neuve redécouvre tout.
    this.services = new Map();
    await this.io.connect(this.device.id, () => this.lost(), { timeout: this.timeoutMs });
    const found = await this.io.getServices(this.device.id);
    for (const s of found) this.services.set(canonicalUUID(s.uuid), new NativeService(this.io, this.device.id, s));
    this.connected = true;
    return this;
  }
  disconnect(): void {
    this.connected = false;
    // Annule aussi un essai resté pendant ; le plugin ne signale pas toujours la coupure qu'on provoque soi-même.
    void this.io.disconnect(this.device.id).catch(() => {});
  }
  private lost() {
    if (!this.connected) return;
    this.connected = false;
    this.device.dispatchEvent(new Event('gattserverdisconnected'));
  }
  async getPrimaryService(u: number | string): Promise<NativeService> {
    const s = this.services.get(canonicalUUID(u));
    if (!s) throw notFound(`Service ${canonicalUUID(u)}`);
    return s;
  }
  async getPrimaryServices(): Promise<NativeService[]> {
    return [...this.services.values()];
  }
}

class NativeDevice extends EventTarget {
  readonly gatt: NativeGatt;
  constructor(private readonly io: BleBackend, readonly id: string, readonly name: string | undefined, connectTimeoutMs?: number) {
    super();
    this.gatt = new NativeGatt(io, this, connectTimeoutMs);
  }

  /** Annonces de l'appareil : un balayage filtré sur son identifiant, arrêté par le signal. */
  async watchAdvertisements(opts?: { signal?: AbortSignal }): Promise<void> {
    const stop = () => void this.io.stopLEScan().catch(() => {});
    opts?.signal?.addEventListener('abort', stop, { once: true });
    await this.io.requestLEScan({ allowDuplicates: false }, (r) => {
      if (r.device.deviceId === this.id) this.dispatchEvent(new Event('advertisementreceived'));
    });
    if (opts?.signal?.aborted) stop();
  }
}

/** Sous-ensemble de `RequestDeviceOptions` (union de types, peu pratique à lire) que le pont comprend. */
export interface RequestOptions {
  filters?: Filter[];
  optionalServices?: (number | string)[];
  acceptAllDevices?: boolean;
  exclusionFilters?: unknown;
}

type Filter = { services?: (number | string)[]; name?: string; namePrefix?: string };

/** Traduit les filtres Web Bluetooth vers les options (plus pauvres) du plugin. */
export function toPluginOptions(o: RequestOptions) {
  const filters = o.filters ?? [];
  const services = [...new Set(filters.flatMap((f) => (f.services ?? []).map(canonicalUUID)))];
  const names = filters.filter((f) => f.name !== undefined || f.namePrefix !== undefined);
  const out: { services?: string[]; name?: string; namePrefix?: string; optionalServices?: string[] } = {};
  if (services.length) out.services = services;
  // Un seul filtre de nom, et aucun service pour le concurrencer : le plugin sait le faire.
  else if (names.length === 1 && names[0]) {
    if (names[0].name !== undefined) out.name = names[0].name;
    else out.namePrefix = names[0].namePrefix;
  }
  const optional = (o.optionalServices ?? []).map(canonicalUUID);
  if (optional.length) out.optionalServices = optional;
  return out;
}

export class NativeBluetooth {
  private ready?: Promise<void>;
  private readonly known = new Map<string, NativeDevice>();

  constructor(private readonly io: () => Promise<BleBackend>, private readonly connectTimeoutMs?: number) {}

  private async backend(): Promise<BleBackend> {
    const io = await this.io();
    this.ready ??= io.initialize({ androidNeverForLocation: true }).catch((e) => {
      this.ready = undefined; // refus d'autorisation : redemandé au prochain essai
      throw e;
    });
    await this.ready;
    return io;
  }

  private device(io: BleBackend, d: BleDevice): NativeDevice {
    let n = this.known.get(d.deviceId);
    if (!n) this.known.set(d.deviceId, (n = new NativeDevice(io, d.deviceId, d.name, this.connectTimeoutMs)));
    return n;
  }

  async requestDevice(o: RequestOptions = {}): Promise<NativeDevice> {
    const io = await this.backend();
    try {
      return this.device(io, await io.requestDevice(toPluginOptions(o)));
    } catch (e) {
      // Le plugin signale la fermeture du sélecteur par un message « cancelled » : même convention que Chrome.
      if (e instanceof Error && /cancel/i.test(e.message)) throw Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' });
      throw e;
    }
  }

  /** Appareils déjà vus par cette installation, retrouvés par CoreBluetooth sans balayage ni clic. */
  async getDevices(): Promise<NativeDevice[]> {
    const io = await this.backend();
    const ids = readIds();
    const found = ids.length ? await io.getDevices(ids) : [];
    return found.map((d) => this.device(io, d));
  }

  /** Mémorise un appareil choisi, pour que `getDevices()` le rende au prochain lancement. */
  remember(id: string) {
    const ids = readIds();
    if (!ids.includes(id)) writeIds([...ids, id]);
  }
}

const IDS_KEY = 'moulinette.native-ble-ids';
function readIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(IDS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeIds(ids: string[]) {
  try {
    localStorage.setItem(IDS_KEY, JSON.stringify(ids));
  } catch {
    // stockage bloqué : l'appareil sera redemandé au prochain lancement
  }
}

/** Fabrique du pont, avec mémorisation automatique des appareils choisis. */
export function createNativeBluetooth(io: () => Promise<BleBackend>, connectTimeoutMs?: number): NativeBluetooth {
  const bt = new NativeBluetooth(io, connectTimeoutMs);
  const request = bt.requestDevice.bind(bt);
  bt.requestDevice = async (o) => {
    const d = await request(o);
    bt.remember(d.id);
    return d;
  };
  return bt;
}

/**
 * À appeler avant tout accès à `navigator.bluetooth`. Hors coquille native, ou si le navigateur a déjà
 * Web Bluetooth, ne change rien. Rend `true` si le pont a été installé.
 */
export function installNativeBluetooth(): boolean {
  if (!Capacitor.isNativePlatform() || 'bluetooth' in navigator) return false;
  const bt = createNativeBluetooth(async () => (await import('@capacitor-community/bluetooth-le')).BleClient);
  Object.defineProperty(navigator, 'bluetooth', { value: bt, configurable: true });
  (globalThis as Record<string, unknown>).BluetoothUUID ??= {
    canonicalUUID,
    getService: canonicalUUID,
    getCharacteristic: canonicalUUID,
    getDescriptor: canonicalUUID,
  };
  return true;
}
