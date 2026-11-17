import { describe, expect, it, vi } from 'vitest';
import type { BleService } from '@capacitor-community/bluetooth-le';
import { canonicalUUID, createNativeBluetooth, toPluginOptions, type BleBackend } from './native-bluetooth';
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
