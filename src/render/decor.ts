import * as THREE from 'three/webgpu';
import { drain, type Steps } from './background';
import { float, length, positionGeometry, positionLocal, sin, smoothstep as tslSmoothstep, time, uv, vec3 } from 'three/tsl';
import { faceted, instanced, lumpy, merge, painted } from './geometry-utils';
import { mulberry32, smoothstep } from './noise';
import { PALETTE } from './palette';
import { CHUNK_M, chunkKey } from './terrain';
import { firShare, forestCover, treelineFactor } from './vegetation';
import { ROAD_HALF, type RoadHit, type WaterHit, type WorldLayout } from './world-layout';

/** Rayon de décor gardé autour du cycliste, en m. */
export const DECOR_RADIUS_M = 1100;

export interface DecorOptions {
  /** Places pour chaque essence (sapins, feuillus), toutes distances confondues. Le surplus, le plus lointain, n'est pas dessiné. */
  treeCapacity: number;
  rockCapacity: number;
  /** Tentatives de plantation par morceau de 128 m : presque toutes réussissent en forêt, très peu dans un pré. */
  treeAttempts: number;
  rockAttempts: number;
  /** Touffes d'herbe et fleurs au bord des routes : places, et tentatives par morceau traversé par une route. */
  tuftCapacity: number;
  tuftAttempts: number;
}

export const DECOR_HIGH: DecorOptions = { treeCapacity: 4500, rockCapacity: 1200, treeAttempts: 130, rockAttempts: 14, tuftCapacity: 3200, tuftAttempts: 900 };
export const DECOR_LOW: DecorOptions = { treeCapacity: 1800, rockCapacity: 500, treeAttempts: 60, rockAttempts: 6, tuftCapacity: 1100, tuftAttempts: 320 };

/** En deçà de cette distance au cycliste, un arbre a sa forme complète ; au-delà, une silhouette de quelques triangles. */
const FULL_RANGE_M = 260;
/** Marge ajoutée à la portée des ombres : un arbre juste hors de portée projette encore son ombre dedans. */
const CAST_MARGIN_M = 25;
/** Places des lots proches, par essence : arbres qui portent une ombre, puis arbres complets sans ombre. */
const CAST_CAPACITY = 400;
const FULL_CAPACITY = 1400;

/**
 * Vent : les couronnes se balancent, d'autant plus qu'on monte dans l'arbre, par vagues qui traversent le pays. Le
 * déplacement se calcule dans la carte graphique, sans rien coûter au reste.
 */
function sway(mesh: THREE.InstancedMesh) {
  const lift = positionGeometry.y.max(0);
  const reach = lift.mul(lift).mul(0.0038); // 14 cm à 6 m
  const phase = positionLocal.x.mul(0.035).add(positionLocal.z.mul(0.022));
  const mat = mesh.material as THREE.MeshStandardNodeMaterial;
  mat.positionNode = positionLocal.add(
    vec3(sin(time.mul(1.25).add(phase)).mul(reach), 0, sin(time.mul(0.85).add(phase.mul(1.4))).mul(reach)),
  ) as unknown as NonNullable<THREE.MeshStandardNodeMaterial['positionNode']>;
}

/** Les herbes et les fleurs ne se dessinent qu'à cette distance du cycliste, et ne poussent qu'à cette distance de la route, en m. */
const TUFT_RANGE_M = 90;
const TUFT_BAND_M = 40;
const FLOWERS = [0xffffff, 0xf7d84a, 0xf29ac0, 0xb18cf0, 0xf2643c];

/** Touffe d'herbe : trois brins en éventail, éclairés comme le sol (normales vers le haut). */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3 + 0.3;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const lean = 0.12 * (i - 1);
    pos.push(-0.09 * c, 0, -0.09 * s, 0.09 * c, 0, 0.09 * s, lean * s, 0.6, -lean * c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(27).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/** Fleur : une tête à facettes sur une tige. La tige est peinte en vert sombre, la tête prend la couleur de l'instance. */
function flowerGeometry(): THREE.BufferGeometry {
  const head = new THREE.IcosahedronGeometry(0.1, 0).translate(0, 0.44, 0);
  const stem = new THREE.BufferGeometry();
  stem.setAttribute('position', new THREE.Float32BufferAttribute([-0.025, 0, 0, 0.025, 0, 0, 0, 0.4, 0], 3));
  stem.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  painted(head, () => 1);
  const green = new Float32Array([0.2, 0.5, 0.18, 0.2, 0.5, 0.18, 0.2, 0.5, 0.18]);
  stem.setAttribute('color', new THREE.BufferAttribute(green, 3));
  return merge([head, stem]);
}

/** Rayon au sol de l'ombre de contact d'un arbre à l'échelle 1, en m. */
const FIR_CONTACT_M = 2.3;
const LEAF_CONTACT_M = 2.9;
/** Opacité de l'ombre de contact en son centre. */
const CONTACT_OPACITY = 0.34;
/** Composante verticale de la normale du sol en dessous de laquelle la pente est trop raide pour un arbre. */
const TREE_MIN_NORMAL_Y = 0.72;

const FIR_TIERS: [number, number, number][] = [
  [1.75, 2.5, 0.75], // rayon, hauteur, base
  [1.35, 2.2, 2.05],
  [0.95, 2.0, 3.35],
];

/** Les étages d'un sapin : chacun est peint plus sombre vers le haut, là où l'étage du dessus le couvre. */
function firCrown(segments: number, openEnded: boolean): THREE.BufferGeometry {
  return faceted(
    merge(
      FIR_TIERS.map(([r, h, y], i) => {
        const cone = new THREE.ConeGeometry(r, h, segments, 1, openEnded).translate(0, y + h / 2, 0);
        const last = i === FIR_TIERS.length - 1;
        // Le dernier étage n'est couvert par rien : il reste clair jusqu'à la pointe.
        return painted(cone, (_x, py, _z, ny) => (ny < -0.5 ? 0.6 : (0.92 + 0.05 * i) * (last ? 1 : 1 - 0.26 * smoothstep(y + 0.35 * h, y + 0.8 * h, py))));
      }),
    ),
  );
}

/**
 * Sapin à étages : trois cônes à facettes empilés sur un tronc court (environ 6,5 m à l'échelle 1). `far` : la
 * silhouette vue de loin, sans dessous ni tronc, posée plus bas pour toucher le sol.
 */
function firGeometry() {
  const trunk = new THREE.CylinderGeometry(0.15, 0.2, 1.0, 7).translate(0, 0.45, 0);
  return { crown: firCrown(10, false), trunk: faceted(trunk), far: firCrown(6, true).translate(0, -0.55, 0) };
}

/** Ombrage peint d'une couronne de feuillu : bas et dessous plus sombres, sommet un peu plus clair. */
const leafShade = (_x: number, y: number, _z: number, ny: number) => (0.74 + 0.3 * smoothstep(2.2, 5.6, y)) * (0.88 + 0.12 * smoothstep(-0.7, 0.5, ny));

/**
 * Feuillu en bulles : une grosse boule et trois plus petites, bosselées, à facettes nettes, sur un tronc fin (environ 6 m).
 * `far` : la silhouette vue de loin, une seule boule sur un tronc à quatre pans. Elle n'a qu'une matière : le tronc y
 * est peint du rapport entre la couleur du bois et celle du feuillage, pour ressortir brun une fois teinté par l'instance.
 */
function leafyGeometry() {
  const blobs: [number, number, number, number][] = [
    [0, 3.9, 0, 1.95],
    [1.15, 3.35, 0.55, 1.25],
    [-0.9, 3.45, -0.75, 1.2],
    [0.2, 4.95, -0.5, 1.15],
  ];
  const crown = merge(blobs.map(([x, y, z, r], i) => lumpy(new THREE.IcosahedronGeometry(r, 1), 0.08, 11 + i).translate(x, y, z)));
  painted(crown, leafShade);
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 2.6, 7).translate(0, 1.3, 0);

  const farCrown = painted(lumpy(new THREE.IcosahedronGeometry(2.25, 1), 0.1, 17).scale(1.08, 0.95, 1.08).translate(0.1, 4.0, -0.1), leafShade);
  const farTrunk = faceted(new THREE.CylinderGeometry(0.2, 0.28, 2.6, 4, 1, true).translate(0, 1.3, 0));
  const wood = [PALETTE.trunk.r / PALETTE.leaf.r, PALETTE.trunk.g / PALETTE.leaf.g, PALETTE.trunk.b / PALETTE.leaf.b];
  const tint = new Float32Array(farTrunk.getAttribute('position').count * 3);
  for (let i = 0; i < tint.length; i++) tint[i] = wood[i % 3]!;
  farTrunk.setAttribute('color', new THREE.BufferAttribute(tint, 3));
  return { crown, trunk: faceted(trunk), far: merge([farCrown, farTrunk]) };
}

/**
 * Ombre de contact : un disque sombre et flou posé au pied de chaque arbre. Elle l'ancre au sol à toute distance,
 * là où les ombres portées ne vont pas.
 */
function contactMesh(capacity: number): THREE.InstancedMesh {
  const mat = new THREE.MeshBasicNodeMaterial({ color: 0x16301c, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const r = length(uv().sub(0.5)).mul(2); // 0 au centre, 1 au bord
  mat.opacityNode = float(CONTACT_OPACITY).mul(tslSmoothstep(1, 0.25, r)) as unknown as NonNullable<THREE.MeshBasicNodeMaterial['opacityNode']>;
  const m = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 8).rotateX(-Math.PI / 2), mat, capacity);
  m.frustumCulled = false;
  m.renderOrder = 1;
  return m;
}

/** Instances d'un morceau : matrices (16 flottants) et couleurs (3) à la suite. */
interface Batch {
  matrices: number[];
  colors: number[];
}
interface ChunkDecor {
  /** Centre du morceau, pour le trier par distance au cycliste. */
  cx: number;
  cz: number;
  fir: Batch;
  leaf: Batch;
  rock: Batch;
  tuft: Batch;
  flower: Batch;
  /** Ombres de contact des arbres : matrices seulement. */
  contact: number[];
}

const emptyBatch = (): Batch => ({ matrices: [], colors: [] });

/**
 * Un lot d'instances : la forme (couronne, rocher), le tronc qui la suit s'il y en a un, et le nombre d'instances écrites.
 * Les lots d'une même essence s'enchaînent du plus proche au plus lointain.
 */
interface Lot {
  shape: THREE.InstancedMesh;
  trunk?: THREE.InstancedMesh;
  /** Distance au cycliste jusqu'à laquelle ce lot prend les instances, en m. */
  reachM: number;
  n: number;
}

/**
 * Arbres et rochers semés par morceau de 128 m (générateur propre à chaque morceau : le même monde à chaque chargement),
 * en forêts et en prés d'après `vegetation.ts`, rejetés sur la chaussée et sur les pentes raides, plus rares avec
 * l'altitude.
 *
 * Chaque essence se dessine en trois lots selon la distance au cycliste : les arbres proches, qui portent une ombre ;
 * les arbres complets sans ombre ; les silhouettes lointaines, de quelques triangles. Sans ce tri, chaque arbre était
 * redessiné dans les deux passes d'ombre, d'où qu'il soit : c'était la moitié des triangles de l'image.
 */
export class Decor {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, ChunkDecor>();
  private readonly firs: Lot[];
  private readonly leaves: Lot[];
  private readonly rocks: Lot[];
  private readonly tufts: Lot[];
  private readonly flowers: Lot[];
  private readonly contacts: THREE.InstancedMesh;
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly normal = new THREE.Vector3();
  private readonly scratch: RoadHit = { dist: Infinity, alt: 0, edge: -1, s: 0 };
  private readonly water: WaterHit = { sd: Infinity, level: 0, beach: 0 };
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly order: ChunkDecor[] = [];
  private lastX = Infinity;
  private lastZ = Infinity;
  private pending = true;

  /**
   * `shadowRangeM` : portée des ombres portées autour de la caméra ; au-delà, un arbre n'en projette pas.
   * `clearings` : disques où rien n'est planté (l'emprise des bâtiments).
   */
  constructor(
    private readonly layout: WorldLayout,
    private readonly opts: DecorOptions,
    private readonly radiusM = DECOR_RADIUS_M,
    shadowRangeM = 80,
    private readonly clearings: { x: number; z: number; r: number }[] = [],
  ) {
    const fir = firGeometry();
    const leafy = leafyGeometry();
    const rock = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.16, 5);
    const castM = shadowRangeM + CAST_MARGIN_M;
    const trunkOpts = { color: PALETTE.trunk, roughness: 1 };

    const tree = (crown: THREE.BufferGeometry, trunk: THREE.BufferGeometry, far: THREE.BufferGeometry): Lot[] => [
      { shape: instanced(crown, CAST_CAPACITY, { roughness: 0.85 }), trunk: instanced(trunk, CAST_CAPACITY, trunkOpts), reachM: castM, n: 0 },
      { shape: instanced(crown, FULL_CAPACITY, { roughness: 0.85, shadows: false }), trunk: instanced(trunk, FULL_CAPACITY, { ...trunkOpts, shadows: false }), reachM: FULL_RANGE_M, n: 0 },
      { shape: instanced(far, opts.treeCapacity, { roughness: 0.85, shadows: false }), reachM: Infinity, n: 0 },
    ];
    this.firs = tree(fir.crown, fir.trunk, fir.far);
    this.leaves = tree(leafy.crown, leafy.trunk, leafy.far);
    for (const lot of [this.firs[0]!, this.firs[1]!, this.leaves[0]!, this.leaves[1]!]) sway(lot.shape); // pas les silhouettes lointaines
    this.rocks = [
      { shape: instanced(rock, CAST_CAPACITY, { roughness: 0.95 }), reachM: castM, n: 0 },
      { shape: instanced(rock, opts.rockCapacity, { roughness: 0.95, shadows: false }), reachM: Infinity, n: 0 },
    ];
    this.tufts = [{ shape: instanced(tuftGeometry(), opts.tuftCapacity, { roughness: 1, shadows: false }), reachM: TUFT_RANGE_M, n: 0 }];
    this.flowers = [{ shape: instanced(flowerGeometry(), Math.round(opts.tuftCapacity / 4), { roughness: 0.9, shadows: false }), reachM: TUFT_RANGE_M, n: 0 }];
    (this.tufts[0]!.shape.material as THREE.Material).side = THREE.DoubleSide;
    (this.flowers[0]!.shape.material as THREE.Material).side = THREE.DoubleSide;
    this.contacts = contactMesh(2 * opts.treeCapacity);
    this.contacts.count = 0;
    for (const lot of [...this.firs, ...this.leaves, ...this.rocks, ...this.tufts, ...this.flowers]) {
      lot.shape.setColorAt(0, this.color.set(0xffffff)); // crée l'attribut de couleur
      lot.shape.count = 0;
      if (lot.trunk) {
        lot.trunk.count = 0;
        this.group.add(lot.trunk);
      }
      this.group.add(lot.shape);
    }
    this.group.add(this.contacts);
  }

  private generate(i: number, j: number): ChunkDecor {
    const { layout, opts, dummy, color, scratch, normal } = this;
    const rand = mulberry32(Math.imul(i + 7919, 73856093) ^ Math.imul(j + 104729, 19349663));
    const x0 = i * CHUNK_M;
    const z0 = j * CHUNK_M;
    const out: ChunkDecor = { cx: x0 + CHUNK_M / 2, cz: z0 + CHUNK_M / 2, fir: emptyBatch(), leaf: emptyBatch(), rock: emptyBatch(), tuft: emptyBatch(), flower: emptyBatch(), contact: [] };
    const near = layout.nearestRoad(out.cx, out.cz, scratch).dist < 160;

    for (let t = opts.treeAttempts; t > 0; t--) {
      const x = x0 + rand() * CHUNK_M;
      const z = z0 + rand() * CHUNK_M;
      const luck = rand();
      const cover = forestCover(x, z);
      // La forêt est dense, le pré presque nu ; au bord de la route, quelques arbres isolés même dans un pré.
      const open = 1 - cover;
      const y = layout.groundY(x, z, scratch);
      const dist = scratch.dist;
      const alt = y / layout.relief;
      if (dist < ROAD_HALF + 7) continue;
      if (layout.waterAt(x, z, this.water).sd < 7) continue; // ni dans l'eau ni sur la grève
      const roadside = dist === Infinity ? 0 : Math.exp(-dist / 45);
      // Les érables bordent leur route de près : on roule dessous.
      const autumn = layout.autumnAt(scratch);
      if (luck > (0.04 + 0.86 * cover + (0.3 + 0.6 * autumn) * open * roadside) * treelineFactor(alt)) continue;
      // Pente du sol : elle couche l'ombre de contact, et un versant trop raide reste nu.
      normal.set(y - layout.groundY(x + 1, z), 1, y - layout.groundY(x, z + 1)).normalize();
      if (normal.y < TREE_MIN_NORMAL_Y) continue;
      if (this.clearings.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r)) continue;

      // Les arbres d'une forêt sont plus hauts que ceux d'un pré.
      const scale = (0.75 + rand() * 0.8) * (1 + 0.2 * cover);
      dummy.position.set(x, y - 0.1, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      const isFir = rand() < firShare(x, z, alt) * (1 - 0.92 * autumn);
      if (isFir) {
        dummy.scale.set(scale, scale * (0.9 + rand() * 0.35), scale);
        dummy.updateMatrix();
        out.fir.matrices.push(...dummy.matrix.elements);
        color.copy(PALETTE.fir).offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.12, (rand() - 0.4) * 0.1);
        out.fir.colors.push(color.r, color.g, color.b);
      } else {
        dummy.scale.set(scale, scale * (0.85 + rand() * 0.3), scale);
        dummy.updateMatrix();
        out.leaf.matrices.push(...dummy.matrix.elements);
        if (rand() < autumn) color.copy(PALETTE.maple[Math.floor(rand() * PALETTE.maple.length)]!).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.08);
        else color.copy(PALETTE.leaf).offsetHSL((rand() - 0.5) * 0.05, (rand() - 0.5) * 0.15, (rand() - 0.45) * 0.14);
        out.leaf.colors.push(color.r, color.g, color.b);
      }
      const reach = scale * (isFir ? FIR_CONTACT_M : LEAF_CONTACT_M);
      dummy.position.set(x, y + 0.08, z);
      dummy.quaternion.setFromUnitVectors(this.up, normal);
      dummy.scale.set(reach, 1, reach);
      dummy.updateMatrix();
      out.contact.push(...dummy.matrix.elements);
    }

    // Rochers arrondis, souvent par deux ou trois, surtout près de la route, plus nombreux au-dessus des arbres.
    const rockTries = near ? opts.rockAttempts : Math.ceil(opts.rockAttempts / 3);
    for (let t = rockTries; t > 0; t--) {
      const x = x0 + rand() * CHUNK_M;
      const z = z0 + rand() * CHUNK_M;
      const y = layout.groundY(x, z, scratch);
      const dist = scratch.dist;
      const alt = y / layout.relief;
      if (dist < ROAD_HALF + 4) continue;
      if (layout.waterAt(x, z, this.water).sd < -3) continue; // des rochers sur la grève, pas au large
      const density = (dist === Infinity ? 0.25 : 0.3 + 0.7 * Math.exp(-dist / 60)) * (1 + 1.5 * smoothstep(200, 320, alt));
      if (rand() > Math.min(1, density)) continue;
      const group = 1 + Math.floor(rand() * 3);
      const big = 0.4 + rand() * rand() * 1.4;
      for (let k = 0; k < group; k++) {
        const px = x + (k ? (rand() - 0.5) * 2.5 * big : 0);
        const pz = z + (k ? (rand() - 0.5) * 2.5 * big : 0);
        const r = big * (k ? 0.45 + rand() * 0.35 : 1);
        const py = layout.groundY(px, pz, scratch);
        if (scratch.dist < ROAD_HALF + 1.5) continue;
        dummy.position.set(px, py - r * 0.25, pz);
        dummy.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4);
        dummy.scale.set(r * (1.1 + rand() * 0.4), r * (0.55 + rand() * 0.25), r * (0.9 + rand() * 0.3));
        dummy.updateMatrix();
        out.rock.matrices.push(...dummy.matrix.elements);
        color.copy(PALETTE.rock).offsetHSL(0, 0, (rand() - 0.5) * 0.1);
        out.rock.colors.push(color.r, color.g, color.b);
      }
    }
    // Herbes hautes et fleurs le long de la route : ce qui défile au plus près du cycliste.
    if (near) {
      for (let t = opts.tuftAttempts; t > 0; t--) {
        const x = x0 + rand() * CHUNK_M;
        const z = z0 + rand() * CHUNK_M;
        const y = layout.groundY(x, z, scratch);
        if (scratch.dist < ROAD_HALF + 1.6 || scratch.dist > TUFT_BAND_M) continue;
        if (layout.waterAt(x, z, this.water).sd < 2) continue;
        if (this.clearings.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r)) continue;
        const autumn = layout.autumnAt(scratch);
        const size = 0.4 + rand() * 0.45;
        dummy.position.set(x, y - 0.03, z);
        dummy.rotation.set(0, rand() * Math.PI * 2, 0);
        dummy.scale.set(size * 1.4, size, size * 1.4);
        dummy.updateMatrix();
        if (rand() < 0.24 * (1 - autumn)) {
          out.flower.matrices.push(...dummy.matrix.elements);
          color.set(FLOWERS[Math.floor(rand() * FLOWERS.length)]!);
          out.flower.colors.push(color.r, color.g, color.b);
        } else {
          out.tuft.matrices.push(...dummy.matrix.elements);
          color.copy(PALETTE.grassLight).lerp(PALETTE.grassDry, rand() * 0.6).lerp(PALETTE.leafLitter, 0.5 * autumn).offsetHSL(0, 0, (rand() - 0.5) * 0.08);
          out.tuft.colors.push(color.r, color.g, color.b);
        }
      }
    }
    return out;
  }

  /**
   * Recopie les morceaux gardés dans les lots, du plus proche du cycliste au plus lointain : chaque instance va dans le
   * premier lot qui l'atteint et où il reste une place. Quand les lots sont pleins, c'est le lointain qui manque.
   */
  private repopulate(x: number, z: number) {
    const order = this.order;
    order.length = 0;
    for (const c of this.chunks.values()) order.push(c);
    order.sort((a, b) => (a.cx - x) ** 2 + (a.cz - z) ** 2 - ((b.cx - x) ** 2 + (b.cz - z) ** 2));

    const fill = (lots: Lot[], pick: (c: ChunkDecor) => Batch) => {
      for (const lot of lots) lot.n = 0;
      for (const chunk of order) {
        const b = pick(chunk);
        const count = b.colors.length / 3;
        for (let q = 0; q < count; q++) {
          const d = Math.hypot(b.matrices[q * 16 + 12]! - x, b.matrices[q * 16 + 14]! - z);
          const lot = lots.find((l) => d < l.reachM && l.n < l.shape.instanceMatrix.count);
          if (!lot) continue;
          const mats = lot.shape.instanceMatrix.array as Float32Array;
          const cols = lot.shape.instanceColor!.array as Float32Array;
          for (let e = 0; e < 16; e++) mats[lot.n * 16 + e] = b.matrices[q * 16 + e]!;
          for (let e = 0; e < 3; e++) cols[lot.n * 3 + e] = b.colors[q * 3 + e]!;
          lot.n++;
        }
      }
      for (const lot of lots) {
        lot.shape.count = lot.n;
        lot.shape.instanceMatrix.needsUpdate = true;
        lot.shape.instanceColor!.needsUpdate = true;
        if (lot.trunk) {
          (lot.trunk.instanceMatrix.array as Float32Array).set((lot.shape.instanceMatrix.array as Float32Array).subarray(0, lot.n * 16));
          lot.trunk.count = lot.n;
          lot.trunk.instanceMatrix.needsUpdate = true;
        }
      }
    };
    fill(this.firs, (c) => c.fir);
    fill(this.leaves, (c) => c.leaf);
    fill(this.rocks, (c) => c.rock);
    fill(this.tufts, (c) => c.tuft);
    fill(this.flowers, (c) => c.flower);

    const mats = this.contacts.instanceMatrix.array as Float32Array;
    const cap = this.contacts.instanceMatrix.count;
    let n = 0;
    for (const chunk of order) {
      const k = Math.min(chunk.contact.length / 16, cap - n);
      if (k <= 0) break;
      for (let q = 0; q < k * 16; q++) mats[n * 16 + q] = chunk.contact[q]!;
      n += k;
    }
    this.contacts.count = n;
    this.contacts.instanceMatrix.needsUpdate = true;
  }

  /**
   * Sème les morceaux manquants autour de (x, z), retire les lointains et retrie les lots par distance. Ne fait rien
   * tant que le cycliste n'a pas avancé de 16 m. Renvoie vrai si des morceaux ont changé.
   */
  update(x: number, z: number, budget = 2): boolean {
    if (!this.pending && Math.hypot(x - this.lastX, z - this.lastZ) < 16) return false;
    const changed = this.sow(x, z, budget);
    this.repopulate(x, z);
    return changed;
  }

  /** Sème au plus `budget` morceaux manquants autour de (x, z) et oublie les lointains, sans toucher aux lots. */
  private sow(x: number, z: number, budget: number): boolean {
    this.lastX = x;
    this.lastZ = z;
    const radiusM = this.radiusM;
    const ci = Math.floor(x / CHUNK_M);
    const cj = Math.floor(z / CHUNK_M);
    const span = Math.ceil(radiusM / CHUNK_M) + 1;
    const want: { i: number; j: number; d: number }[] = [];
    for (let i = ci - span; i <= ci + span; i++) {
      for (let j = cj - span; j <= cj + span; j++) {
        const d = Math.hypot((i + 0.5) * CHUNK_M - x, (j + 0.5) * CHUNK_M - z);
        if (d <= radiusM) want.push({ i, j, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    let changed = false;
    this.pending = false;
    for (const c of want) {
      const key = chunkKey(c.i, c.j);
      if (this.chunks.has(key)) continue;
      if (budget <= 0) {
        this.pending = true;
        continue;
      }
      this.chunks.set(key, this.generate(c.i, c.j));
      budget--;
      changed = true;
    }
    const keep = radiusM + 2 * CHUNK_M;
    for (const [key, chunk] of this.chunks) {
      if (Math.hypot(chunk.cx - x, chunk.cz - z) > keep) {
        this.chunks.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  /** Sème tout ce qui entoure (x, z), un morceau par étape, puis remplit les lots une seule fois. */
  *primeSteps(x: number, z: number): Steps {
    this.pending = true;
    while (this.pending) {
      this.sow(x, z, 1);
      yield;
    }
    this.repopulate(x, z);
  }

  prime(x: number, z: number) {
    drain(this.primeSteps(x, z));
  }

  /** Arbres et rochers dessinés en ce moment. */
  get instanceCount(): number {
    return [...this.firs, ...this.leaves, ...this.rocks].reduce((n, lot) => n + lot.n, 0);
  }
}
