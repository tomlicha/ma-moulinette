import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../shared/util/key-value-store';
import { SettingsStore } from './settings-store';

function memory(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const blocked: KeyValueStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceeded');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('SettingsStore', () => {
  it('garde les clés historiques : les appareils déjà installés en dépendent', () => {
    expect(SettingsStore.KEYS).toEqual({
      ftp: 'mamoulinette.ftp',
      mass: 'mamoulinette.mass',
      protocol: 'mamoulinette.trainerProtocol',
    });
  });

  it('relit la FTP et la masse gardées', () => {
    const s = new SettingsStore(memory({ 'mamoulinette.ftp': '245', 'mamoulinette.mass': '72' }));
    expect(s.ftpW()).toBe(245);
    expect(s.massKg()).toBe(72);
  });

  it('ignore une valeur absente, illisible ou hors bornes', () => {
    expect(new SettingsStore(memory()).ftpW()).toBeUndefined();
    expect(new SettingsStore(memory({ 'mamoulinette.ftp': 'abc' })).ftpW()).toBeUndefined();
    expect(new SettingsStore(memory({ 'mamoulinette.ftp': '20' })).ftpW()).toBeUndefined();
    expect(new SettingsStore(memory({ 'mamoulinette.mass': '10' })).massKg()).toBeUndefined();
    expect(new SettingsStore(memory({ 'mamoulinette.mass': '400' })).massKg()).toBeUndefined();
  });

  it('écrit un réglage, et l\'efface quand on lui donne `undefined`', () => {
    const store = memory();
    const s = new SettingsStore(store);
    s.save('ftp', 250);
    expect(store.data.get('mamoulinette.ftp')).toBe('250');
    expect(s.raw('ftp')).toBe('250');
    s.save('ftp', undefined);
    expect(store.data.has('mamoulinette.ftp')).toBe(false);
    expect(s.raw('ftp')).toBeNull();
  });

  it('ne retient que les protocoles connus', () => {
    expect(new SettingsStore(memory({ 'mamoulinette.trainerProtocol': 'zwift' })).trainerProtocol()).toBe('zwift');
    expect(new SettingsStore(memory({ 'mamoulinette.trainerProtocol': 'inconnu' })).trainerProtocol()).toBeUndefined();
    expect(new SettingsStore(memory()).trainerProtocol()).toBeUndefined();
  });

  it('écrit et efface le protocole de pilotage', () => {
    const store = memory();
    const s = new SettingsStore(store);
    s.saveTrainerProtocol('wahoo');
    expect(s.trainerProtocol()).toBe('wahoo');
    s.saveTrainerProtocol(undefined);
    expect(s.trainerProtocol()).toBeUndefined();
  });

  it('un stockage bloqué n\'est jamais une erreur', () => {
    const s = new SettingsStore(blocked);
    expect(() => s.save('ftp', 250)).not.toThrow();
    expect(() => s.saveTrainerProtocol('fec')).not.toThrow();
    expect(s.ftpW()).toBeUndefined();
    expect(s.massKg()).toBeUndefined();
    expect(s.raw('mass')).toBeNull();
    expect(s.trainerProtocol()).toBeUndefined();
  });
});
