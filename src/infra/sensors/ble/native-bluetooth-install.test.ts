import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: true }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }));

import { installNativeBluetooth } from './native-bluetooth';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).BluetoothUUID;
});

describe('installNativeBluetooth', () => {
  it('dans la coquille native : fournit navigator.bluetooth et BluetoothUUID', () => {
    native.value = true;
    vi.stubGlobal('navigator', {});
    expect(installNativeBluetooth()).toBe(true);
    const nav = navigator as unknown as { bluetooth: { requestDevice: unknown; getDevices: unknown } };
    expect(typeof nav.bluetooth.requestDevice).toBe('function');
    expect(typeof nav.bluetooth.getDevices).toBe('function');
    const uuid = (globalThis as unknown as { BluetoothUUID: { getService(u: number): string } }).BluetoothUUID;
    expect(uuid.getService(0x1826)).toBe('00001826-0000-1000-8000-00805f9b34fb');
  });

  it('dans un navigateur : ne touche à rien', () => {
    native.value = false;
    vi.stubGlobal('navigator', {});
    expect(installNativeBluetooth()).toBe(false);
    expect('bluetooth' in navigator).toBe(false);
  });

  it('si Web Bluetooth existe déjà : le garde', () => {
    native.value = true;
    const real = {};
    vi.stubGlobal('navigator', { bluetooth: real });
    expect(installNativeBluetooth()).toBe(false);
    expect(navigator.bluetooth).toBe(real);
  });
});
