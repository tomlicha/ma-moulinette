import { describe, expect, it, vi } from 'vitest';
import type { SyncItem } from '../infra/sync/protocol';
import type { KeyValueStore } from '../shared/util/key-value-store';
import { RiderSettingsSync } from './rider-settings-sync';
import { SettingsStore } from './settings-store';

function setup(initial: Record<string, string> = {}, stamps: Record<string, number> = {}) {
  const data = new Map(Object.entries(initial));
  const store: KeyValueStore = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  const settings = new SettingsStore(store);
  const inputs = { setValue: vi.fn() };
  const ftpChanged = vi.fn();
  const refreshProfile = vi.fn();
  const sync = new RiderSettingsSync({
    settings,
    journal: { stamp: (_kind, id) => stamps[id] },
    inputs,
    ftpChanged,
    refreshProfile,
  });
  return { sync, settings, inputs, ftpChanged, refreshProfile, data };
}

const item = (id: 'ftp' | 'mass', body: unknown): SyncItem => ({ kind: 'setting', id, body, updatedAt: 1 });

describe('RiderSettingsSync', () => {
  it('est la synchronisation des réglages', () => {
    expect(setup().sync.kind).toBe('setting');
  });

  describe('ce que l\'appareil sait', () => {
    it('rien tant que rien n\'a été réglé', () => {
      expect(setup().sync.all()).toEqual([]);
    });

    it('la FTP et la masse réglées, avec leur version', () => {
      const { sync } = setup({ 'mamoulinette.ftp': '240', 'mamoulinette.mass': '72' }, { ftp: 1000, mass: 2000 });
      expect(sync.all()).toEqual([
        { kind: 'setting', id: 'ftp', body: 240, updatedAt: 1000 },
        { kind: 'setting', id: 'mass', body: 72, updatedAt: 2000 },
      ]);
    });

    it('un réglage sans version cède devant celui du compte (version 0)', () => {
      const { sync } = setup({ 'mamoulinette.ftp': '240' });
      expect(sync.all()).toEqual([{ kind: 'setting', id: 'ftp', body: 240, updatedAt: 0 }]);
    });
  });

  describe('ce qui vient d\'un autre appareil', () => {
    it('une FTP reçue : champ et mémoire suivent, et tout ce qui en dépend est prévenu', () => {
      const { sync, inputs, settings, ftpChanged, refreshProfile } = setup();
      sync.apply([item('ftp', 260)]);
      expect(inputs.setValue).toHaveBeenCalledWith('ftp', 260);
      expect(settings.ftpW()).toBe(260);
      expect(ftpChanged).toHaveBeenCalledTimes(1);
      expect(refreshProfile).toHaveBeenCalledTimes(1);
    });

    it('une masse reçue ne change pas la FTP : la séance n\'a pas à se relire', () => {
      const { sync, inputs, settings, ftpChanged, refreshProfile } = setup();
      sync.apply([item('mass', 75)]);
      expect(inputs.setValue).toHaveBeenCalledWith('mass', 75);
      expect(settings.massKg()).toBe(75);
      expect(ftpChanged).not.toHaveBeenCalled();
      expect(refreshProfile).toHaveBeenCalledTimes(1);
    });

    it('un réglage supprimé ailleurs revient à la valeur par défaut', () => {
      const { sync, inputs, settings } = setup({ 'mamoulinette.ftp': '240' });
      sync.apply([item('ftp', null)]);
      expect(inputs.setValue).toHaveBeenCalledWith('ftp', undefined);
      expect(settings.ftpW()).toBeUndefined();
    });

    it('un élément inconnu est ignoré', () => {
      const { sync, inputs, ftpChanged } = setup();
      sync.apply([{ kind: 'setting', id: 'poids-du-chat', body: 4, updatedAt: 1 }]);
      expect(inputs.setValue).not.toHaveBeenCalled();
      expect(ftpChanged).not.toHaveBeenCalled();
    });
  });

  it('un autre compte prend l\'appareil : tout est effacé et chacun est prévenu', () => {
    const { sync, inputs, settings, ftpChanged, refreshProfile } = setup({ 'mamoulinette.ftp': '240', 'mamoulinette.mass': '72' });
    sync.clear();
    expect(inputs.setValue).toHaveBeenCalledWith('ftp', undefined);
    expect(inputs.setValue).toHaveBeenCalledWith('mass', undefined);
    expect(settings.ftpW()).toBeUndefined();
    expect(settings.massKg()).toBeUndefined();
    expect(ftpChanged).toHaveBeenCalledTimes(1);
    expect(refreshProfile).toHaveBeenCalledTimes(1);
  });
});
