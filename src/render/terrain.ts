import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { drain, type Steps } from './background';
import { fbm, smoothstep } from './noise';
import { cloudShade } from './shade';
import { PALETTE } from './palette';
import { forestCover, treelineFactor } from './vegetation';
import { FAR_MARGIN_M, ROAD_INFLUENCE_M, type RoadHit, type WaterHit, type WorldLayout } from './world-layout';

/** Côté d'un morceau de terrain, en m. */
export const CHUNK_M = 128;
/** Maille près d'une route (on la voit de près) et ailleurs, en m. */
const NEAR_CELL_M = 4;
const FAR_CELL_M = 16;
/** Maille du relief lointain, qui couvre tout le réseau, en m. */
const BACKDROP_CELL_M = 96;
/** Le relief lointain est posé plus bas que les morceaux, pour ne jamais scintiller avec eux, en m. */
const BACKDROP_DROP_M = 3;
/** Jupe sous les bords d'un morceau : elle cache les fissures entre deux mailles différentes, en m. */
const SKIRT_M = 6;
/** Rayon de morceaux gardés autour du cycliste, en m. */
export const TERRAIN_RADIUS_M = 1500;

export const chunkKey = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);

const scratch: RoadHit = { dist: Infinity, alt: 0, edge: -1, s: 0 };
const tint = new THREE.Color();
const water: WaterHit = { sd: Infinity, level: 0, beach: 0 };
const litter: RoadHit = { dist: Infinity, alt: 0, edge: -1, s: 0 };

/** Part de sol de forêt mêlée à la prairie sous un couvert complet. */
const FOREST_TINT = 0.6;

/** Couleur du sol : prairie, sol de forêt, rocaille en altitude, roche sur les pentes raides (`ny` : normale verticale). */
function groundColor(layout: WorldLayout, x: number, z: number, y: number, ny: number, out: Float32Array, k: number) {
  // Prairie par grandes plaques claires et sombres, et de l'herbe sèche par endroits.
  tint.copy(PALETTE.grassDark).lerp(PALETTE.grassLight, smoothstep(-0.4, 0.4, fbm(x * 0.008, z * 0.008)));
  tint.lerp(PALETTE.grassDry, 0.55 * smoothstep(0.15, 0.6, fbm(x * 0.0031 + 40, z * 0.0031 - 17, 2)));
  const alt = y / layout.relief;
  tint.lerp(PALETTE.forestFloor, FOREST_TINT * forestCover(x, z) * treelineFactor(alt));
  tint.lerp(PALETTE.scree, 0.85 * smoothstep(240, 330, alt + 20 * fbm(x * 0.01, z * 0.01)));
  tint.lerp(PALETTE.cliff, smoothstep(0.76, 0.62, ny));
  // Feuilles tombées au pied des érables, le long de la route.
  if (layout.hasGroves && layout.roadDistanceAt(x, z) < 120) {
    const autumn = layout.autumnAt(layout.nearestRoad(x, z, litter));
    if (autumn > 0) tint.lerp(PALETTE.leafLitter, 0.55 * autumn * Math.exp(-litter.dist / 28));
  }
  // Autour d'un lac : une grève de sable, puis le fond sous la surface.
  const sd = layout.waterAt(x, z, water).sd;
  if (sd < 16) tint.lerp(PALETTE.sand, 0.8 * (1 - smoothstep(0.3 * water.beach, 1.15 * water.beach, sd))).lerp(PALETTE.lakeBed, 1 - smoothstep(-6, 2, sd));
  // Le sable du bas-côté est une bande posée sur la route (`world.ts`) : un bord net, qu'une maille de 4 m ne donnerait pas.
  out[k] = tint.r;
  out[k + 1] = tint.g;
  out[k + 2] = tint.b;
}

/**
 * Maillage régulier du relief sur le rectangle [x0, x0+w] × [z0, z0+h]. Les normales viennent du relief lui-même
 * (différences centrées, une rangée de plus de chaque côté) : aucune couture d'éclairage entre deux morceaux.
 * Par étapes, une rangée de sommets à la fois.
 */
function* gridMeshSteps(
  layout: WorldLayout,
  x0: number,
  z0: number,
  w: number,
  h: number,
  nx: number,
  nz: number,
  drop: number,
  skirt: boolean,
  /** Hauteur à l'image en (x, z) ; par défaut le sol. Le relief lointain passe un minorant (voir `Terrain`). */
  sample: (x: number, z: number) => number = (x, z) => layout.groundY(x, z, scratch),
): Steps<THREE.BufferGeometry> {
  const sx = w / nx;
  const sz = h / nz;
  const cols = nx + 3;
  const heights = new Float32Array(cols * (nz + 3));
  for (let b = -1; b <= nz + 1; b++) {
    yield;
    for (let a = -1; a <= nx + 1; a++) {
      const i = (b + 1) * cols + (a + 1);
      heights[i] = sample(x0 + a * sx, z0 + b * sz) - drop;
    }
  }
  const at = (a: number, b: number) => heights[(b + 1) * cols + (a + 1)]!;

  const vertCount = (nx + 1) * (nz + 1);
  const ringCount = 2 * (nx + nz);
  const total = vertCount + (skirt ? ringCount : 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  for (let b = 0; b <= nz; b++) {
    yield;
    for (let a = 0; a <= nx; a++) {
      const v = b * (nx + 1) + a;
      const x = x0 + a * sx;
      const z = z0 + b * sz;
      const y = at(a, b);
      pos[v * 3] = x;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = z;
      let nxv = (at(a - 1, b) - at(a + 1, b)) / (2 * sx);
      let nzv = (at(a, b - 1) - at(a, b + 1)) / (2 * sz);
      const len = Math.hypot(nxv, 1, nzv);
      nxv /= len;
      nzv /= len;
      nor[v * 3] = nxv;
      nor[v * 3 + 1] = 1 / len;
      nor[v * 3 + 2] = nzv;
      groundColor(layout, x, z, y + drop, drop > 0 ? 1 : 1 / len, col, v * 3);
    }
  }

  const idx: number[] = [];
  for (let b = 0; b < nz; b++) {
    for (let a = 0; a < nx; a++) {
      const v00 = b * (nx + 1) + a;
      const v10 = v00 + 1;
      const v01 = v00 + (nx + 1);
      const v11 = v01 + 1;
      idx.push(v00, v01, v10, v10, v01, v11); // faces vers le haut
    }
  }

  if (skirt) {
    // Le tour du morceau, dans l'ordre : bas, droite, haut, gauche.
    const ring: number[] = [];
    for (let a = 0; a <= nx; a++) ring.push(a);
    for (let b = 1; b <= nz; b++) ring.push(b * (nx + 1) + nx);
    for (let a = nx - 1; a >= 0; a--) ring.push(nz * (nx + 1) + a);
    for (let b = nz - 1; b >= 1; b--) ring.push(b * (nx + 1));
    ring.forEach((v, k) => {
      const s = vertCount + k;
      pos[s * 3] = pos[v * 3]!;
      pos[s * 3 + 1] = pos[v * 3 + 1]! - SKIRT_M;
      pos[s * 3 + 2] = pos[v * 3 + 2]!;
      nor.set([nor[v * 3]!, nor[v * 3 + 1]!, nor[v * 3 + 2]!], s * 3);
      col.set([col[v * 3]!, col[v * 3 + 1]!, col[v * 3 + 2]!], s * 3);
    });
    for (let k = 0; k < ring.length; k++) {
      const k2 = (k + 1) % ring.length;
      const a = ring[k]!;
      const b = ring[k2]!;
      const sa = vertCount + k;
      const sb = vertCount + k2;
      idx.push(a, b, sb, a, sb, sa, a, sb, b, a, sa, sb); // les deux faces : la jupe se voit de l'extérieur du morceau
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  g.computeBoundingSphere();
  return g;
}

interface Chunk {
  mesh: THREE.Mesh;
  /** Maille fine (4 m) ou grossière (16 m). */
  fine: boolean;
}

/** Au-delà de cette distance au cycliste, un morceau passe en maille grossière ; en deçà de `FINE_IN_M` il repasse en fine. */
const FINE_OUT_M = 650;
const FINE_IN_M = 520;
/** Le cycliste doit avoir avancé de cette distance pour qu'on réexamine les morceaux, en m. */
const MOVE_STEP_M = 16;

/**
 * Relief de la zone, en deux couches. Un relief lointain grossier couvre tout le réseau, posé un peu plus bas. Par-dessus,
 * des morceaux de 128 m se construisent autour du cycliste : maille de 4 m le long des routes et près de lui (là où on
 * regarde), 16 m ailleurs.
 */
export class Terrain {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, Chunk>();
  private readonly corridors = new Map<number, boolean>();
  private readonly material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1 });
  private lastX = Infinity;
  private lastZ = Infinity;
  private pending = true;

  /** Le relief, construit par étapes (le relief lointain, une rangée à la fois) : à dérouler avec `Background.run`. */
  static *build(layout: WorldLayout, radiusM = TERRAIN_RADIUS_M): Steps<Terrain> {
    const terrain = new Terrain(layout, radiusM);
    yield* terrain.backdropSteps();
    return terrain;
  }

  private constructor(private readonly layout: WorldLayout, private readonly radiusM = TERRAIN_RADIUS_M) {
    // La couleur des sommets est multipliée par ce nœud : les ombres de nuages glissent sur le sol.
    this.material.colorNode = vec3(cloudShade()) as unknown as NonNullable<THREE.MeshStandardNodeMaterial['colorNode']>;
  }

  /** Relief lointain grossier sous tout le réseau. */
  private *backdropSteps(): Steps {
    const layout = this.layout;
    const b = layout.bounds;
    const pad = FAR_MARGIN_M;
    const w = b.maxX - b.minX + 2 * pad;
    const h = b.maxZ - b.minZ + 2 * pad;
    const nx = Math.ceil(w / BACKDROP_CELL_M);
    const nz = Math.ceil(h / BACKDROP_CELL_M);
    // Une grille de 96 m interpolée en ligne droite passerait au-dessus de l'entaille d'une route dans un versant et la
    // recouvrirait. Chaque sommet prend donc le minimum du sol sur son voisinage (±48 m) : le relief lointain reste un
    // minorant, caché sous les morceaux proches.
    const half = BACKDROP_CELL_M / 2;
    const lowest = (x: number, z: number) => {
      // Loin de toute route il n'y a pas d'entaille à préserver : le vrai sol, sinon les sommets du relief propre
      // grandiraient d'un coup quand les morceaux proches les remplacent.
      if (layout.roadDistanceAt(x, z) > ROAD_INFLUENCE_M + BACKDROP_CELL_M) return layout.groundY(x, z, scratch);
      let m = Infinity;
      for (const dx of [-half, 0, half]) for (const dz of [-half, 0, half]) m = Math.min(m, layout.groundY(x + dx, z + dz, scratch));
      return m;
    };
    const far = new THREE.Mesh(yield* gridMeshSteps(layout, b.minX - pad, b.minZ - pad, w, h, nx, nz, BACKDROP_DROP_M, false, lowest), this.material);
    far.receiveShadow = true;
    this.group.add(far);
  }

  /** Une route passe-t-elle assez près de ce morceau pour qu'on le voie de près ? Calculé une fois par morceau. */
  private isCorridor(i: number, j: number): boolean {
    const key = chunkKey(i, j);
    let c = this.corridors.get(key);
    if (c === undefined) {
      c = this.layout.nearestRoad((i + 0.5) * CHUNK_M, (j + 0.5) * CHUNK_M, scratch).dist < ROAD_INFLUENCE_M;
      this.corridors.set(key, c);
    }
    return c;
  }

  private *build(i: number, j: number, fine: boolean): Steps<Chunk> {
    const x0 = i * CHUNK_M;
    const z0 = j * CHUNK_M;
    const n = CHUNK_M / (fine ? NEAR_CELL_M : FAR_CELL_M);
    const mesh = new THREE.Mesh(yield* gridMeshSteps(this.layout, x0, z0, CHUNK_M, CHUNK_M, n, n, 0, true), this.material);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return { mesh, fine };
  }

  private drop(chunk: Chunk) {
    this.group.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
  }

  /**
   * Construit les morceaux manquants autour de (x, z), du plus proche au plus loin, change la maille de ceux qui
   * s'approchent ou s'éloignent, et retire les trop lointains. `budget` limite le nombre de constructions par appel :
   * pas d'à-coup à l'image. Renvoie vrai si l'ensemble a changé.
   */
  update(x: number, z: number, budget = 2): boolean {
    return drain(this.updateSteps(x, z, budget));
  }

  /** `update` par étapes, une rangée de sommets à la fois. */
  private *updateSteps(x: number, z: number, budget: number): Steps<boolean> {
    if (!this.pending && Math.hypot(x - this.lastX, z - this.lastZ) < MOVE_STEP_M) return false;
    this.lastX = x;
    this.lastZ = z;
    const ci = Math.floor(x / CHUNK_M);
    const cj = Math.floor(z / CHUNK_M);
    const span = Math.ceil(this.radiusM / CHUNK_M) + 1;
    const want: { i: number; j: number; d: number }[] = [];
    for (let i = ci - span; i <= ci + span; i++) {
      for (let j = cj - span; j <= cj + span; j++) {
        const d = Math.hypot((i + 0.5) * CHUNK_M - x, (j + 0.5) * CHUNK_M - z);
        if (d <= this.radiusM) want.push({ i, j, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    let changed = false;
    let left = budget;
    this.pending = false;
    for (const c of want) {
      const key = chunkKey(c.i, c.j);
      const cur = this.chunks.get(key);
      // Maille fine le long d'une route et près du cycliste ; hystérésis entre `FINE_IN_M` et `FINE_OUT_M`.
      const near = this.isCorridor(c.i, c.j) && (cur?.fine ? c.d < FINE_OUT_M : c.d < FINE_IN_M);
      if (cur && cur.fine === near) continue;
      if (left <= 0) {
        this.pending = true;
        continue;
      }
      if (cur) this.drop(cur);
      this.chunks.set(key, yield* this.build(c.i, c.j, near));
      left--;
      changed = true;
    }
    // Un peu d'hystérésis : un morceau à la limite ne se reconstruit pas à chaque pas.
    const keep = this.radiusM + 2 * CHUNK_M;
    for (const [key, chunk] of this.chunks) {
      const i = Math.floor(key / 8192) - 4096;
      const j = (key % 8192) - 4096;
      if (Math.hypot((i + 0.5) * CHUNK_M - x, (j + 0.5) * CHUNK_M - z) > keep) {
        this.drop(chunk);
        this.chunks.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  /** Construit d'un coup tout ce qui entoure (x, z) : à l'ouverture de la vue, avant la première image. */
  prime(x: number, z: number) {
    drain(this.primeSteps(x, z));
  }

  /** `prime` par étapes, un morceau à la fois. */
  *primeSteps(x: number, z: number): Steps {
    this.pending = true;
    while ((yield* this.updateSteps(x, z, 1)) || this.pending) yield;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  /** Morceaux en maille grossière à moins de `withinM` de (x, z) : doit rester nul le long des routes proches. */
  coarseNear(x: number, z: number, withinM: number): number {
    let n = 0;
    for (const [key, c] of this.chunks) {
      const i = Math.floor(key / 8192) - 4096;
      const j = (key % 8192) - 4096;
      if (!c.fine && this.isCorridor(i, j) && Math.hypot((i + 0.5) * CHUNK_M - x, (j + 0.5) * CHUNK_M - z) < withinM) n++;
    }
    return n;
  }
}