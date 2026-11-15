import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Bruit déterministe d'un sommet : les sommets confondus d'un maillage non indexé bougent ensemble. */
function vertexNoise(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(Math.round(x * 1000), 374761393) ^ Math.imul(Math.round(y * 1000), 668265263);
  h = (h ^ Math.imul(Math.round(z * 1000), 2246822519) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
}

/** Bosselle une forme autour de son centre (`amount` : écart relatif du rayon), facettes nettes. */
export function lumpy(geo: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 1 + amount * vertexNoise(x, y, z, seed);
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Ombrage peint dans la couleur des sommets : `shade(x, y, z, ny)` rend un facteur (1 = couleur pleine) qui multiplie
 * la couleur de la matière. Une occlusion ambiante sans calcul à l'image : le dessous et le cœur d'un arbre
 * s'assombrissent une fois pour toutes.
 */
export function painted(geo: THREE.BufferGeometry, shade: (x: number, y: number, z: number, ny: number) => number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = shade(pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getY(i) : 1);
    col[i * 3] = k;
    col[i * 3 + 1] = k;
    col[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Facettes nettes (style des maquettes) : sommets non partagés, normales de face. */
export function faceted(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    return g;
  });
  return mergeGeometries(clean)!;
}

/** Instances de `geo`, ombres portées et reçues, couleur par instance. */
export function instanced(geo: THREE.BufferGeometry, count: number, opts: { color?: THREE.Color; roughness?: number; shadows?: boolean } = {}) {
  const m = new THREE.InstancedMesh(
    geo,
    // Une géométrie qui porte un ombrage peint (`painted`) le voit multiplier la couleur de chaque instance.
    new THREE.MeshStandardNodeMaterial({ color: opts.color ?? 0xffffff, roughness: opts.roughness ?? 0.9, vertexColors: geo.hasAttribute('color') }),
    count,
  );
  m.castShadow = opts.shadows ?? true;
  m.receiveShadow = true;
  m.frustumCulled = false; // les instances couvrent une grande zone : la sphère englobante de base ne vaut rien
  return m;
}
