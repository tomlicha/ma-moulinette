import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { OthersLayer, type PlacedRider } from './others';

// `tags` ne lit ni les modèles ni le relief : des coquilles suffisent.
const layer = new OthersLayer({} as never, {} as never, -1.6);

/** Caméra en (0, 2, 0) regardant vers +x, comme la vue de poursuite. */
function camera() {
  const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 4000);
  cam.position.set(0, 2, 0);
  cam.lookAt(10, 2, 0);
  cam.updateMatrixWorld();
  return cam;
}

const at = (slot: number, x: number, z = 0, distanceM = Math.abs(x)): PlacedRider => ({ slot, name: `C${slot}`, x, y: 0, z, distanceM });

describe('OthersLayer.tags', () => {
  it('place le nom d’un coureur devant la caméra, au centre de l’écran', () => {
    const tags = layer.tags([at(1, 20)], camera(), 1000, 500);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.x).toBeCloseTo(500, 0);
    expect(tags[0]!.y).toBeGreaterThan(0);
    expect(tags[0]!.y).toBeLessThan(500);
  });

  it('ne montre pas un coureur derrière la caméra, de près comme de loin', () => {
    const cam = camera();
    expect(layer.tags([at(1, -0.6), at(2, -5), at(3, -40)], cam, 1000, 500)).toEqual([]);
  });

  it('ne montre pas un coureur hors du champ latéral', () => {
    expect(layer.tags([at(1, 5, 30)], camera(), 1000, 500)).toEqual([]);
  });

  it('ne montre pas les coureurs trop lointains', () => {
    expect(layer.tags([at(1, 200, 0, 200)], camera(), 1000, 500)).toEqual([]);
  });
});
