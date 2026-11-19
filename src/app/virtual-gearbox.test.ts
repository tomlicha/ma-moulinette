import { describe, expect, it } from 'vitest';
import { CHAINRING_LIMITS, VIRTUAL_GEARS, nearestGear, realRatio } from '../domain/sim/virtual-gears';
import type { KeyValueStore } from '../shared/util/key-value-store';
import { VirtualGearbox, type GearChange, type GearState } from './virtual-gearbox';

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

function watch(box: VirtualGearbox) {
  const seen: Array<[GearState, GearChange]> = [];
  box.on('changed', (s, why) => seen.push([s, why]));
  return seen;
}

describe('VirtualGearbox', () => {
  it('garde les clés historiques : les appareils déjà installés en dépendent', () => {
    expect(VirtualGearbox.KEYS).toEqual({ cog: 'mamoulinette.cog', chainring: 'mamoulinette.chainring' });
  });

  it('démarre sans Cog, plateau par défaut, sur la vitesse qui ressemble au braquet réel', () => {
    const s = new VirtualGearbox(memory()).state();
    expect(s.enabled).toBe(false);
    expect(s.realRatio).toBeCloseTo(realRatio(CHAINRING_LIMITS.default));
    expect(s.gear).toBe(nearestGear(realRatio(CHAINRING_LIMITS.default)) + 1);
    expect(s.virtualRatio).toBe(VIRTUAL_GEARS[s.gear - 1]);
  });

  it('relit le Cog et le plateau mémorisés', () => {
    const box = new VirtualGearbox(memory({ 'mamoulinette.cog': '1', 'mamoulinette.chainring': '50' }));
    expect(box.state().enabled).toBe(true);
    expect(box.chainring).toBe(50);
    expect(box.state().realRatio).toBeCloseTo(realRatio(50));
  });

  it('ignore un plateau mémorisé hors bornes ou illisible', () => {
    expect(new VirtualGearbox(memory({ 'mamoulinette.chainring': '5' })).chainring).toBe(CHAINRING_LIMITS.default);
    expect(new VirtualGearbox(memory({ 'mamoulinette.chainring': 'abc' })).chainring).toBe(CHAINRING_LIMITS.default);
    expect(new VirtualGearbox(memory({ 'mamoulinette.chainring': '40.5' })).chainring).toBe(CHAINRING_LIMITS.default);
  });

  it('monter le Cog le mémorise et le signale comme un réglage', () => {
    const store = memory();
    const box = new VirtualGearbox(store);
    const seen = watch(box);
    box.setEnabled(true);
    expect(store.data.get('mamoulinette.cog')).toBe('1');
    expect(seen).toHaveLength(1);
    expect(seen[0]![0].enabled).toBe(true);
    expect(seen[0]![1]).toBe('setup');
    box.setEnabled(false);
    expect(store.data.get('mamoulinette.cog')).toBe('0');
  });

  it('changer de plateau le mémorise et repart de la vitesse qui ressemble au nouveau braquet', () => {
    const store = memory();
    const box = new VirtualGearbox(store);
    const seen = watch(box);
    box.setChainring(52);
    expect(store.data.get('mamoulinette.chainring')).toBe('52');
    expect(box.state().gear).toBe(nearestGear(realRatio(52)) + 1);
    expect(seen.map(([, why]) => why)).toEqual(['setup']);
  });

  it('arrondit le plateau saisi', () => {
    const box = new VirtualGearbox(memory());
    box.setChainring(39.6);
    expect(box.chainring).toBe(40);
  });

  it('un plateau hors bornes est ignoré, mais l’événement part (la vue se remet à la valeur retenue)', () => {
    const store = memory();
    const box = new VirtualGearbox(store);
    const seen = watch(box);
    box.setChainring(CHAINRING_LIMITS.max + 1);
    expect(box.chainring).toBe(CHAINRING_LIMITS.default);
    expect(store.data.has('mamoulinette.chainring')).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it('change de vitesse seulement si le Cog est monté', () => {
    const box = new VirtualGearbox(memory());
    const seen = watch(box);
    const before = box.state().gear;
    box.shift(1);
    expect(box.state().gear).toBe(before);
    expect(seen).toHaveLength(0);

    box.setEnabled(true);
    box.shift(1);
    expect(box.state().gear).toBe(before + 1);
    expect(seen.at(-1)![1]).toBe('shift');
    box.shift(-2);
    expect(box.state().gear).toBe(before - 1);
  });

  it('ne dépasse pas les butées et ne signale rien quand rien ne change', () => {
    const box = new VirtualGearbox(memory({ 'mamoulinette.cog': '1' }));
    box.shift(100);
    expect(box.state().gear).toBe(box.gearCount);
    const seen = watch(box);
    box.shift(1);
    expect(seen).toHaveLength(0);
    box.shift(-100);
    expect(box.state().gear).toBe(1);
    box.shift(-1);
    expect(seen).toHaveLength(1);
  });

  it('un stockage bloqué n’empêche rien : le réglage vaut pour la session', () => {
    const box = new VirtualGearbox(blocked);
    expect(box.state().enabled).toBe(false);
    expect(() => box.setEnabled(true)).not.toThrow();
    expect(() => box.setChainring(48)).not.toThrow();
    expect(box.state().enabled).toBe(true);
    expect(box.chainring).toBe(48);
  });
});
