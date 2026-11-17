import { describe, expect, it, vi } from 'vitest';
import type { BleService } from '@capacitor-community/bluetooth-le';
import { canonicalUUID, createNativeBluetooth, matchesRequest, toAdvert, toPluginOptions, type BleBackend, type Candidate, type Chooser } from './native-bluetooth';
import { HeartRateMonitor } from './heart-rate-monitor';
import { SERVICE, CHAR } from './uuids';
import type { Measurement } from './types';

const props = (p: Partial<Record<string, boolean>> = {}) =>
  ({ broadcast: false, read: false, writeWithoutResponse: false, write: false, notify: false, indicate: false, authenticatedSignedWrites: false, ...p }) as never;

function fakeBackend() {
  const services: BleService[] = [
    { uuid: canonicalUUID(SERVICE.heartRate), characteristics: [{ uuid: canonicalUUID(CHAR.heartRateMeasurement), properties: props({ notify: true }), descriptors: [] }] },
  ];
  let notify: ((v: DataView) => void) | undefined;
  let onDisconnect: ((id: string) => void) | undefined;
  const io = {
    initialize: vi.fn(async () => {}),
    requestDevice: vi.fn(async () => ({ deviceId: 'IOS-UUID-1', name: 'HRM Pro' })),
    requestLEScan: vi.fn(async () => {}),
    stopLEScan: vi.fn(async () => {}),
    getDevices: vi.fn(async (ids: string[]) => ids.map((deviceId) => ({ deviceId, name: 'HRM Pro' }))),
    connect: vi.fn(async (_id: string, cb?: (id: string) => void) => void (onDisconnect = cb)),
    disconnect: vi.fn(async () => {}),
    getServices: vi.fn(async () => services),
    read: vi.fn(), write: vi.fn(), writeWithoutResponse: vi.fn(),
    startNotifications: vi.fn(async (_d: string, _s: string, _c: string, cb: (v: DataView) => void) => void (notify = cb)),
    stopNotifications: vi.fn(async () => {}),
  };
  return { io: io as unknown as BleBackend & typeof io, push: (...b: number[]) => notify?.(new DataView(Uint8Array.from(b).buffer)), drop: () => onDisconnect?.('IOS-UUID-1') };
}

describe('UUID', () => {
  it('canonicalise les UUID courts', () => {
    expect(canonicalUUID(0x180d)).toBe('0000180d-0000-1000-8000-00805f9b34fb');
    expect(canonicalUUID('180D')).toBe('0000180d-0000-1000-8000-00805f9b34fb');
  });
});

describe('toPluginOptions', () => {
  it('fait l’union des services de tous les filtres', () => {
    const o = toPluginOptions({ filters: [{ services: [0x1826] }, { services: [0x1818] }, { namePrefix: 'KICKR' }], optionalServices: [0x180a] });
    expect(o.services).toEqual([canonicalUUID(0x1826), canonicalUUID(0x1818)]);
    expect(o.optionalServices).toEqual([canonicalUUID(0x180a)]);
  });
  it('garde un filtre de nom unique', () => {
    expect(toPluginOptions({ filters: [{ name: 'KICKR 1234' }] })).toEqual({ name: 'KICKR 1234' });
  });
  it('ne filtre pas sur plusieurs noms sans service', () => {
    expect(toPluginOptions({ filters: [{ namePrefix: 'A' }, { namePrefix: 'B' }] })).toEqual({});
  });
});

describe('pont Web Bluetooth natif, avec le vrai pilote cardio', () => {
  it('se connecte, reçoit les notifications et se reconnecte après une coupure', async () => {
    const { io, push, drop } = fakeBackend();
    const bt = createNativeBluetooth(async () => io);
    vi.stubGlobal('navigator', { bluetooth: bt });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    const hr = new HeartRateMonitor();
    hr.reconnectDelaysMs = [0];
    const got: Measurement[] = [];
    hr.on('measurement', (m) => got.push(m));
    const states: string[] = [];
    hr.on('state', (s) => states.push(s));

    await hr.connect();
    expect(io.initialize).toHaveBeenCalledTimes(1);
    expect(states).toContain('connected');
    expect(hr.deviceId).toBe('IOS-UUID-1');

    push(0x00, 72); // flags 8 bits, 72 bpm
    expect(got.at(-1)?.heartRateBpm).toBe(72);

    drop();
    await vi.waitFor(() => expect(io.connect).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(states.filter((s) => s === 'connected')).toHaveLength(2));
    push(0x00, 80);
    expect(got.at(-1)?.heartRateBpm).toBe(80);
    expect(got.filter((m) => m.heartRateBpm === 80)).toHaveLength(1); // pas d'écouteur doublé
    vi.unstubAllGlobals();
  });

  it('traduit la fermeture du sélecteur en NotFoundError', async () => {
    const { io } = fakeBackend();
    io.requestDevice.mockRejectedValueOnce(new Error('requestDevice cancelled'));
    const bt = createNativeBluetooth(async () => io);
    await expect(bt.requestDevice({})).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

/** Balayage comme celui du plugin : un seul écouteur, remplacé par chaque `requestLEScan`, coupé par `stopLEScan`. */
function pluginScan() {
  let listener: ((r: unknown) => void) | null = null;
  const options: { allowDuplicates?: boolean }[] = [];
  const io = {
    initialize: vi.fn(async () => {}),
    getDevices: vi.fn(async (ids: string[]) => ids.map((deviceId) => ({ deviceId, name: deviceId }))),
    requestLEScan: vi.fn(async (o: { allowDuplicates?: boolean }, cb: (r: unknown) => void) => {
      options.push(o);
      listener = cb;
    }),
    stopLEScan: vi.fn(async () => void (listener = null)),
    requestDevice: vi.fn(),
  };
  const advertise = (deviceId: string, extra: Record<string, unknown> = {}) => listener?.({ device: { deviceId }, ...extra });
  return { io: io as unknown as BleBackend & typeof io, advertise, scanning: () => listener !== null, options };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('balayage partagé', () => {
  it('deux appareils attendent leur signal en même temps : chacun est réveillé', async () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(['TRAINER', 'HRM']), setItem: () => {} });
    const { io, advertise, scanning } = pluginScan();
    const bt = createNativeBluetooth(async () => io);
    const [trainer, hrm] = await bt.getDevices();
    const seen: string[] = [];
    trainer!.addEventListener('advertisementreceived', () => seen.push('trainer'));
    hrm!.addEventListener('advertisementreceived', () => seen.push('hrm'));
    const stopTrainer = new AbortController();
    const stopHrm = new AbortController();
    await trainer!.watchAdvertisements({ signal: stopTrainer.signal });
    await hrm!.watchAdvertisements({ signal: stopHrm.signal });
    // Chaque nouvel abonné relance le balayage, pour que les appareils déjà vus se signalent de nouveau.
    expect(io.requestLEScan).toHaveBeenCalledTimes(2);

    advertise('TRAINER');
    expect(seen).toEqual(['trainer']);
    // La ceinture se reconnecte et arrête sa surveillance : celle du trainer continue.
    stopHrm.abort();
    await tick();
    expect(scanning()).toBe(true);
    advertise('TRAINER');
    expect(seen).toEqual(['trainer', 'trainer']);
    stopTrainer.abort();
    await tick();
    expect(io.stopLEScan).toHaveBeenCalledTimes(1);
    expect(scanning()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('sélecteur de l’application', () => {
  const trainerRequest = {
    filters: [{ services: [0x1826] }, { services: [0x1818] }, { namePrefix: 'DIRETO' }],
    exclusionFilters: [{ namePrefix: 'KICKR CLIMB' }],
  };

  it('trie avec les règles de Chrome : services, préfixe de nom seul, exclusions', () => {
    const a = (name: string | undefined, services: string[] = []) => ({ id: name ?? '?', name, services: services.map(canonicalUUID) });
    expect(matchesRequest(a('KICKR 81B5', ['1818']), trainerRequest)).toBe(true);
    expect(matchesRequest(a('DIRETO XR', []), trainerRequest)).toBe(true); // aucun service annoncé : retenu par son nom
    expect(matchesRequest(a('KICKR CLIMB', ['1826']), trainerRequest)).toBe(false); // exclu
    expect(matchesRequest(a('Montre', ['180d']), trainerRequest)).toBe(false);
    expect(matchesRequest(a(undefined, []), trainerRequest)).toBe(false);
    expect(matchesRequest(a('X', ['180d', '180a']), { filters: [{ services: [0x180d] }] })).toBe(true);
    expect(matchesRequest(a('X', []), { acceptAllDevices: true })).toBe(true);
  });

  it('lit les services des annonces, données de service comprises', () => {
    expect(toAdvert({ device: { deviceId: 'A', name: 'cache' }, localName: 'KICKR', rssi: -60, uuids: ['1818'], serviceData: { '00001826-0000-1000-8000-00805f9b34fb': {} } })).toEqual({
      id: 'A', name: 'KICKR', rssi: -60, services: [canonicalUUID(0x1818), canonicalUUID(0x1826)],
    });
  });

  it('propose les appareils au fil des annonces, les plus proches d’abord, et rend celui qu’on choisit', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    const { io, advertise, scanning, options } = pluginScan();
    let lists: Candidate[][] = [];
    let pick!: (id: string | undefined) => void;
    const chooser: Chooser = (found) => {
      found.subscribe((l) => lists.push(l));
      return new Promise((r) => (pick = r));
    };
    const bt = createNativeBluetooth(async () => io, undefined, chooser);
    const pending = bt.requestDevice(trainerRequest);
    await vi.waitFor(() => expect(io.requestLEScan).toHaveBeenCalled());
    expect(options[0]).toEqual({ allowDuplicates: true });
    advertise('A', { localName: 'DIRETO XR', rssi: -80 });
    advertise('B', { rssi: -40, uuids: ['1826'] }); // proposé…
    advertise('B', { localName: 'KICKR CLIMB', rssi: -40 }); // …puis exclu quand son nom arrive
    advertise('C', { rssi: -50, uuids: ['1818'] }); // nom encore inconnu
    advertise('C', { localName: 'KICKR 81B5', rssi: -50 }); // il arrive avec la réponse au balayage
    expect(lists.at(-1)).toEqual([
      { id: 'C', name: 'KICKR 81B5', rssi: -50 },
      { id: 'A', name: 'DIRETO XR', rssi: -80 },
    ]);
    pick('C');
    const d = await pending;
    expect(d.id).toBe('C');
    expect(d.name).toBe('KICKR 81B5');
    await tick();
    expect(scanning()).toBe(false);
    lists = [];
    vi.unstubAllGlobals();
  });

  it('annuler le sélecteur rend NotFoundError et arrête le balayage', async () => {
    const { io, scanning } = pluginScan();
    const bt = createNativeBluetooth(async () => io, undefined, async () => undefined);
    await expect(bt.requestDevice(trainerRequest)).rejects.toMatchObject({ name: 'NotFoundError' });
    await tick();
    expect(scanning()).toBe(false);
  });
});
