import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../sim/courses/col-des-erables';
import { FAR_MARGIN_M, WorldLayout } from './world-layout';

/**
 * Empreinte exacte du relief : les accélérations de `WorldLayout` (index spatiaux, sorties anticipées) ne doivent rien
 * changer au monde, au bit près. Si le relief change volontairement (nouvelles règles, nouveau parcours), relancer ce
 * test et recopier la nouvelle empreinte affichée.
 */
const EXPECTED = '0680392b:355348';

/** FNV-1a sur les bits exacts des nombres. */
function fingerprint(values: number[]): string {
  const view = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  for (const v of values) {
    view.setFloat64(0, v);
    for (let i = 0; i < 8; i++) h = Math.imul(h ^ view.getUint8(i), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + ':' + values.length;
}

describe('WorldLayout, relief au bit près', () => {
  it('donne les mêmes hauteurs, distances et routes les plus proches', () => {
    const layout = new WorldLayout(COL_DES_ERABLES);
    const b = layout.bounds;
    const values: number[] = [];
    // Grille irrégulière (pas premiers) sur tout le terrain dessiné, marge du relief lointain comprise.
    for (let x = b.minX - FAR_MARGIN_M; x <= b.maxX + FAR_MARGIN_M; x += 37.3) {
      for (let z = b.minZ - FAR_MARGIN_M; z <= b.maxZ + FAR_MARGIN_M; z += 41.7) {
        const hit = layout.nearestRoad(x, z);
        values.push(layout.groundAlt(x, z), layout.roadDistanceAt(x, z), layout.farAlt(x, z), hit.dist, hit.alt, hit.edge, hit.s);
      }
    }
    expect(fingerprint(values)).toBe(EXPECTED);
  });
});
