import { describe, expect, it } from 'vitest';
import { HeaderChips, type ChipsSlot } from './header-chips';
import type { View } from './router';

function slot(): ChipsSlot & { got: unknown[] } {
  const s = { got: [] as unknown[], after(node: unknown) { s.got.push(node); } };
  return s;
}

describe('HeaderChips', () => {
  const chips = { name: 'pastilles' };

  it('pose les pastilles dans l’en-tête de l’écran qui en a un', () => {
    const accueil = slot();
    const seances = slot();
    const slots: Partial<Record<View, ChipsSlot>> = { accueil, seances };
    const h = new HeaderChips(chips, (v) => slots[v] ?? null, 'accueil');
    h.show('seances');
    expect(seances.got).toEqual([chips]);
    expect(accueil.got).toEqual([]);
  });

  it('un écran sans repère laisse les pastilles à l’accueil', () => {
    const accueil = slot();
    const seances = slot();
    const slots: Partial<Record<View, ChipsSlot>> = { accueil, seances };
    const h = new HeaderChips(chips, (v) => slots[v] ?? null, 'accueil');
    h.show('seances');
    h.show('appareils');
    expect(accueil.got).toEqual([chips]);
  });

  it('ne déplace pas les pastilles quand l’écran ne change pas d’en-tête', () => {
    const accueil = slot();
    const h = new HeaderChips(chips, (v) => (v === 'accueil' ? accueil : null), 'accueil');
    h.show('accueil');
    h.show('sortie');
    h.show('appareils');
    expect(accueil.got).toHaveLength(1);
  });
});
