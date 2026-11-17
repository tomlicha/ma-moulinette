import { describe, expect, it } from 'vitest';
import { BlockLibrary } from './block-library';
import { validateBlocks, type EditorBlock } from './blocks';
import { zoneOf } from './profile';
import { BLOCK_PRESETS, ZONE_PRESETS, blankPresets, mainPower, PRESET_CATEGORIES, summarizeBlocks } from './presets';
import type { KeyValueStore } from '../sensors/device-registry';

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('blocs préfaits', () => {
  it('chaque bloc est valide, nommé et rangé dans un type connu', () => {
    const cats = new Set(PRESET_CATEGORIES.map((c) => c.id));
    const ids = new Set<string>();
    for (const p of BLOCK_PRESETS) {
      expect(validateBlocks(p.blocks), p.id).toEqual([]);
      expect(cats.has(p.category), p.id).toBe(true);
      expect(p.name.trim(), p.id).not.toBe('');
      expect(ids.has(p.id), `identifiant en double ${p.id}`).toBe(false);
      ids.add(p.id);
    }
  });

  it('chaque type propose au moins deux blocs', () => {
    for (const c of PRESET_CATEGORIES) expect(BLOCK_PRESETS.filter((p) => p.category === c.id).length, c.name).toBeGreaterThanOrEqual(2);
  });

  it('chaque type d’effort (Endurance à Sprint) a un bloc d’intervalles et un bloc simple continu', () => {
    for (const c of PRESET_CATEGORIES.filter((q) => !['warm', 'cool'].includes(q.id))) {
      const types = BLOCK_PRESETS.filter((p) => p.category === c.id).map((p) => p.blocks.map((b) => b.type).join('+'));
      expect(types.sort(), c.name).toEqual(['intervals', 'steady']);
    }
  });

  it('chaque zone, de Z1 à Z6, a un bloc simple et un bloc d’intervalles, valides et dans la zone', () => {
    for (const z of ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'] as const) {
      const simple = ZONE_PRESETS.filter((p) => p.id === `zone-${z}`);
      const inter = ZONE_PRESETS.filter((p) => p.id === `zone-${z}-int`);
      expect(simple, `${z} simple`).toHaveLength(1);
      expect(inter, `${z} intervalles`).toHaveLength(1);
      expect(simple[0]!.blocks.map((b) => b.type), z).toEqual(['steady']);
      expect(inter[0]!.blocks.map((b) => b.type), z).toEqual(['intervals']);
      for (const p of [...simple, ...inter]) expect(zoneOf(mainPower(p.blocks[0]!)!), p.id).toBe(z);
    }
    expect(ZONE_PRESETS).toHaveLength(12);
    for (const p of ZONE_PRESETS) expect(validateBlocks(p.blocks), p.id).toEqual([]);
  });

  it('dans un bloc d’intervalles par zone, la récupération est plus basse que l’effort et le nom dit le format', () => {
    for (const p of ZONE_PRESETS.filter((q) => q.id.endsWith('-int'))) {
      const b = p.blocks[0]!;
      if (b.type !== 'intervals') throw new Error(p.id);
      expect(b.offPower, p.id).toBeLessThan(b.onPower);
      expect(p.name, p.id).toContain(`${b.repeat}×`);
    }
    expect(ZONE_PRESETS.find((p) => p.id === 'zone-z6-int')!.name).toBe('Z6 Anaérobie 8×30 s');
    expect(ZONE_PRESETS.find((p) => p.id === 'zone-z4-int')!.name).toBe('Z4 Seuil 3×8 min');
  });

  it('les blocs vierges couvrent les six types et sont valides', () => {
    const blanks = blankPresets();
    expect(blanks.map((b) => b.blocks[0]!.type).sort()).toEqual(['cooldown', 'free', 'intervals', 'ramp', 'steady', 'warmup']);
    for (const b of blanks) expect(validateBlocks(b.blocks)).toEqual([]);
  });

  it('résume la durée et l’intensité principale', () => {
    const vo2 = BLOCK_PRESETS.find((p) => p.id === 'vo2-5x4')!;
    expect(summarizeBlocks(vo2.blocks)).toEqual({ durationS: 5 * (240 + 240), power: 1.2 });
    const accel = BLOCK_PRESETS.find((p) => p.id === 'warm-accel')!;
    expect(summarizeBlocks(accel.blocks).durationS).toBe(360 + 3 * 120);
    expect(summarizeBlocks([{ type: 'free', durationS: 60 }])).toEqual({ durationS: 60, power: undefined });
  });
});

describe('Mes blocs', () => {
  const block: EditorBlock = { type: 'intervals', repeat: 4, onS: 480, offS: 240, onPower: 1, offPower: 0.55 };

  it('enregistre, relit les plus récents d’abord, et supprime', () => {
    let n = 0;
    const lib = new BlockLibrary(memoryStore(), () => `b${++n}`);
    expect(lib.list()).toEqual([]);
    lib.save('Mon seuil', [block], 1000);
    lib.save('  ', [{ type: 'steady', durationS: 300, power: 0.8 }], 2000);
    expect(lib.list().map((b) => b.name)).toEqual(['Bloc sans nom', 'Mon seuil']);
    lib.remove('b2');
    expect(lib.list().map((b) => b.id)).toEqual(['b1']);
  });

  it('garde une copie : modifier le bloc d’origine ne change pas la bibliothèque', () => {
    const lib = new BlockLibrary(memoryStore());
    const b = { ...block };
    lib.save('Copie', [b]);
    (b as { repeat: number }).repeat = 9;
    expect((lib.list()[0]!.blocks[0] as { repeat: number }).repeat).toBe(4);
  });

  it('ignore un contenu illisible ou invalide', () => {
    const store = memoryStore();
    store.setItem('mamoulinette.blocks', '{ pas du json');
    expect(new BlockLibrary(store).list()).toEqual([]);
    store.setItem('mamoulinette.blocks', JSON.stringify([{ id: 'x', name: 'vide', blocks: [], updatedAt: 1 }, { nope: true }]));
    expect(new BlockLibrary(store).list()).toEqual([]);
  });
});
