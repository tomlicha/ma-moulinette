import * as THREE from 'three/webgpu';
import { attribute, cos, float, fract, instancedBufferAttribute, max, mod, positionGeometry, positionLocal, sin, smoothstep, time, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lumpy } from './geometry-utils';
import { mulberry32 } from './noise';
import { Kit, sign } from './places';
import { U_TOP, type VelodromeTrack } from '../sim/velodrome-track';

/**
 * Le vélodrome un jour d'arrivée : le public (qui saute, agite les bras, brandit des drapeaux), les fanions, l'arche de
 * ballons sur la porte des coureurs, le portique et la cloche du dernier tour, le podium et son pavé, les confettis,
 * les fumigènes, l'écran géant, l'hélicoptère de la télévision, les baraques à frites, les bus des équipes, et le
 * dernier secteur pavé de la route d'accès entre ses barrières.
 *
 * Tout ce qui bouge le fait dans la carte graphique (`time`), sauf l'hélicoptère, la cloche et l'écran (`update`).
 */

type PosNode = NonNullable<THREE.MeshStandardNodeMaterial['positionNode']>;
const asPos = (n: unknown) => n as PosNode;
// Les attributs lus par TSL arrivent sans type de nœud : on les déclare.
const asFloat = (n: unknown) => n as ReturnType<typeof float>;
const asVec3 = (n: unknown) => n as ReturnType<typeof vec3>;

export interface Frame {
  yaw: number;
  origin: { x: number; y: number; z: number };
  at(x: number, y: number, z: number): THREE.Vector3;
}

export interface FeteContext {
  track: VelodromeTrack;
  finishS: number;
  apron: number;
  home: Frame;
  back: Frame;
  finish: Frame;
  stand: { rows: number; length: number; rowZ(i: number): number; rowTop(i: number): number; facadeZ: number; roofY: number };
  terraces: { rows: number; x: number; length: number; rowZ(i: number): number; rowTop(i: number): number };
  /** Route d'accès : point à `b` m du mur (mesuré en travers de la ligne droite) et `o` m de l'axe. */
  road: { at(b: number, o: number): THREE.Vector3; yaw: number; halfWidth: number; cobblesFrom: number; cobblesTo: number };
  gate: { from: number; to: number };
  screenS: number;
  /** Parking des équipes, dans le repère de la ligne droite opposée. */
  parking: { x0: number; x1: number; z0: number; z1: number };
  /** Bends : intervalles de `s` où le public se tient sur la coursive. */
  bends: [number, number][];
}

export interface Fete {
  group: THREE.Group;
  update(dtS: number): void;
  /** Tours bouclés par le joueur : le tableau au bord de la piste et l'écran géant les affichent, la cloche sonne. */
  setLaps(n: number): void;
}

const SHIRTS = [0xf6d32a, 0xf6d32a, 0x1a1a1a, 0xd8262f, 0xf5f5f5, 0x24419a, 0xf08a3c, 0x3a9b5c, 0x4cc9f0, 0xe85d9c, 0x8a5cc4, 0x7a7f88];
const SKINS = [0xf1c7a5, 0xe0ac86, 0xc68a62, 0x9a6544, 0x6b4430, 0xf5d0b5];
const PENNANTS = [0xd8262f, 0xf5f5f5, 0x24419a, 0xf6d32a];

const FLAGS: Record<string, (u: number, v: number) => number> = {
  france: (u) => (u < 1 / 3 ? 0x24419a : u < 2 / 3 ? 0xf5f5f5 : 0xd8262f),
  belgique: (u) => (u < 1 / 3 ? 0x1a1a1a : u < 2 / 3 ? 0xf6d32a : 0xd8262f),
  // Le Lion de Flandre : un lion noir sur fond or, ramené ici à une silhouette.
  flandre: (u, v) => ((u - 0.48) ** 2 / 0.05 + (v - 0.5) ** 2 / 0.1 < 1 || ((u - 0.3) ** 2 + (v - 0.25) ** 2 < 0.012) ? 0x1a1a1a : 0xf6d32a),
  damier: (u, v) => ((Math.floor(u * 8) + Math.floor(v * 5)) % 2 ? 0x1a1a1a : 0xf5f5f5),
};
const FLAG_NAMES = ['flandre', 'flandre', 'france', 'belgique', 'flandre', 'damier'];

/** Forme colorée d'un facteur constant (multiplié par la couleur de l'instance). */
function tinted(geo: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count * 3).fill(k), 3));
  return g;
}

function fused(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

/** Spectateur debout, pieds à l'origine : jambes sombres, buste à la couleur du maillot ; bras levés pour qui acclame. */
function personGeo(cheer: boolean): THREE.BufferGeometry {
  const parts = [tinted(new THREE.BoxGeometry(0.34, 0.8, 0.22).translate(0, 0.4, 0), 0.32), tinted(new THREE.BoxGeometry(0.46, 0.7, 0.26).translate(0, 1.13, 0), 1)];
  // Bras en prismes à trois pans : 8 triangles au lieu de 12.
  if (cheer) for (const sx of [-1, 1]) parts.push(tinted(new THREE.CylinderGeometry(0.06, 0.06, 0.62, 3, 1, true).translate(0, 0.31, 0).rotateZ(-sx * 0.38).translate(sx * 0.24, 1.42, 0), 1));
  return fused(parts);
}

/** Pavé : tronc de pyramide à base carrée sans face de dessous (10 triangles). */
function cobbleGeo(): THREE.BufferGeometry {
  const b = 0.24;
  const t = 0.17;
  const h = 0.12;
  const B = [[-b, 0, -b], [b, 0, -b], [b, 0, b], [-b, 0, b]];
  const T = [[-t, h, -t], [t, h, -t], [t, h, t], [-t, h, t]];
  const pos: number[] = [...T[0]!, ...T[2]!, ...T[1]!, ...T[0]!, ...T[3]!, ...T[2]!];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    pos.push(...B[i]!, ...B[j]!, ...T[j]!, ...B[i]!, ...T[j]!, ...T[i]!);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

interface Person {
  x: number;
  y: number;
  z: number;
  yaw: number;
  cheer: boolean;
  shirt: number;
  scale: number;
  phase: number;
}

/** Le public : instances d'un corps (bras baissés ou levés) et d'une tête, animées ensemble par une phase propre. */
function crowdMeshes(people: Person[]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const build = (list: Person[], geo: THREE.BufferGeometry, arms: boolean, colorOf: (p: Person) => number) => {
    if (!list.length) return;
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9 });
    const ph = asFloat(instancedBufferAttribute(new THREE.InstancedBufferAttribute(Float32Array.from(list, (p) => p.phase), 1)));
    const w = ph.mul(6.2832);
    const zeal = fract(ph.mul(7.31));
    const jump = max(sin(time.mul(zeal.mul(3).add(4)).add(w)), 0).mul(zeal.mul(zeal).mul(0.2));
    let dx = sin(time.mul(1.7).add(w.mul(3))).mul(0.04).mul(positionGeometry.y);
    if (arms) dx = dx.add(sin(time.mul(7).add(w.mul(5))).mul(0.22).mul(smoothstep(1.5, 2.05, positionGeometry.y)));
    mat.positionNode = asPos(positionLocal.add(vec3(dx, jump, 0)));
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const c = new THREE.Color();
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, p.scale, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(colorOf(p)));
    });
    mesh.frustumCulled = false;
    out.push(mesh);
  };
  build(people.filter((p) => !p.cheer), personGeo(false), false, (p) => p.shirt);
  build(people.filter((p) => p.cheer), personGeo(true), true, (p) => p.shirt);
  // Les têtes dans le même ordre que les corps : même phase, même saut.
  const ordered = [...people.filter((p) => !p.cheer), ...people.filter((p) => p.cheer)];
  build(ordered, tinted(new THREE.OctahedronGeometry(0.14, 0).scale(1, 1.15, 1).translate(0, 1.63, 0), 1), false, (p) => SKINS[Math.floor(p.phase * 997) % SKINS.length]!);
  return out;
}

/** Maillage fondu dont les sommets portent des attributs d'animation. */
class Batch {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly extra: Record<string, number[]> = {};

  tri(a: number[], b: number[], c: number[], color: number, extra: Record<string, [number, number, number] | number[][]>) {
    this.pos.push(...a, ...b, ...c);
    const k = new THREE.Color(color);
    for (let i = 0; i < 3; i++) this.col.push(k.r, k.g, k.b);
    for (const [name, vals] of Object.entries(extra)) {
      const arr = (this.extra[name] ??= []);
      for (const v of vals) arr.push(...(Array.isArray(v) ? v : [v]));
    }
  }

  mesh(positionNode: (a: (name: string) => ReturnType<typeof float>, v: (name: string) => ReturnType<typeof vec3>) => unknown, side: THREE.Side = THREE.DoubleSide): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    for (const [name, arr] of Object.entries(this.extra)) g.setAttribute(name, new THREE.Float32BufferAttribute(arr, arr.length / (this.pos.length / 3)));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, side });
    mat.positionNode = asPos(positionNode((n) => asFloat(attribute(n, 'float')), (n) => asVec3(attribute(n, 'vec3'))));
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    return mesh;
  }
}

export function buildFestivities(ctx: FeteContext): Fete {
  const { track, home, back, finish, stand, terraces, road } = ctx;
  const rand = mulberry32(2026);
  const group = new THREE.Group();
  const k = new Kit();
  const people: Person[] = [];
  const person = (x: number, y: number, z: number, yaw: number, cheerP = 0.3, shirt?: number) =>
    people.push({ x, y, z, yaw: yaw + (rand() - 0.5) * 0.6, cheer: rand() < cheerP, shirt: shirt ?? SHIRTS[Math.floor(rand() * SHIRTS.length)]!, scale: 0.92 + rand() * 0.16, phase: rand() });

  // --- Drapeaux qui flottent -------------------------------------------------------------------------------------
  const flags = new Batch();
  /** Drapeau hissé en (x, y, z) (coin haut, côté hampe), qui s'étend vers le cap `yaw`. */
  const flag = (x: number, y: number, z: number, yaw: number, w: number, h: number, pattern: string) => {
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    const n: [number, number, number] = [Math.sin(yaw) * 0.12 * w, 0, Math.cos(yaw) * 0.12 * w];
    const ph = rand();
    const paint = FLAGS[pattern]!;
    const NX = 8;
    const NY = 5;
    const at = (u: number, v: number) => [x + ax * u * w, y - v * h, z + az * u * w];
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NY; j++) {
        const [u0, u1, v0, v1] = [i / NX, (i + 1) / NX, j / NY, (j + 1) / NY];
        const color = paint((u0 + u1) / 2, (v0 + v1) / 2);
        flags.tri(at(u0, v0), at(u1, v0), at(u0, v1), color, { flagU: [u0, u1, u0], flagN: [n, n, n], phase: [ph, ph, ph] });
        flags.tri(at(u1, v0), at(u1, v1), at(u0, v1), color, { flagU: [u1, u1, u0], flagN: [n, n, n], phase: [ph, ph, ph] });
      }
    }
  };
  const pole = (x: number, y: number, z: number, h: number, color = 0xdcdcdc) => k.box(0.08, h, 0.08, x, y, z, color);
  const randomFlag = () => FLAG_NAMES[Math.floor(rand() * FLAG_NAMES.length)]!;

  // --- Le public ---------------------------------------------------------------------------------------------------
  // Tribune couverte : comble, tout le monde debout pour l'arrivée.
  for (let i = 0; i < stand.rows; i++) {
    for (let x = -stand.length / 2 + 0.5; x < stand.length / 2 - 0.4; x += 0.62) {
      if (rand() > 0.82) continue;
      const p = home.at(x + (rand() - 0.5) * 0.15, 0, stand.rowZ(i) + 0.17);
      person(p.x, stand.rowTop(i), p.z, home.yaw + Math.PI);
      if (rand() < 0.025) {
        pole(p.x + 0.2, stand.rowTop(i) + 1.45, p.z, 1.5, 0x8a5c36);
        flag(p.x + 0.2, stand.rowTop(i) + 2.95, p.z, home.yaw + (rand() < 0.5 ? 0 : Math.PI), 1.2, 0.8, randomFlag());
      }
    }
  }
  // Gradins découverts.
  for (let i = 0; i < terraces.rows; i++) {
    for (let x = terraces.x - terraces.length / 2 + 0.5; x < terraces.x + terraces.length / 2 - 0.4; x += 0.6) {
      if (rand() > 0.85) continue;
      const p = back.at(x + (rand() - 0.5) * 0.2, 0, terraces.rowZ(i) + 0.4);
      person(p.x, terraces.rowTop(i), p.z, back.yaw + Math.PI, 0.4);
      if (rand() < 0.04) {
        pole(p.x + 0.2, terraces.rowTop(i) + 1.45, p.z, 1.6, 0x8a5c36);
        flag(p.x + 0.2, terraces.rowTop(i) + 3.05, p.z, back.yaw + (rand() < 0.5 ? 0 : Math.PI), 1.3, 0.85, randomFlag());
      }
    }
  }
  // Coursive des virages : deux rangs contre le mur.
  for (const [s0, s1] of ctx.bends) {
    for (let s = s0; s < s1; s += 0.68) {
      const f = track.frame(s);
      const y = track.height(s, U_TOP) + 0.2;
      for (const u of [U_TOP + 0.6, U_TOP + 1.35]) {
        if (rand() > 0.8) continue;
        const p = track.point(s + (rand() - 0.5) * 0.3, u);
        person(p.x, y, p.z, Math.atan2(-f.outX, -f.outZ), 0.45);
        if (rand() < 0.035) {
          pole(p.x, y + 1.45, p.z, 1.6, 0x8a5c36);
          flag(p.x, y + 3.05, p.z, Math.atan2(-f.dirZ, f.dirX) + (rand() < 0.5 ? 0 : Math.PI), 1.3, 0.85, randomFlag());
        }
      }
    }
  }

  // --- Route d'accès : dernier secteur pavé, barrières, public, fanions -------------------------------------------
  const roadYawKit = road.yaw; // repère Kit : x local le long de la route
  {
    const geo = cobbleGeo();
    const rows: [THREE.Vector3, number][] = [];
    let r = 0;
    for (let b = road.cobblesFrom; b < road.cobblesTo; b += 0.42, r++) {
      for (let o = -road.halfWidth + 0.25 + (r % 2) * 0.25; o < road.halfWidth - 0.2; o += 0.5) {
        const p = road.at(b + (rand() - 0.5) * 0.06, o + (rand() - 0.5) * 0.06);
        p.y = 0.04 + 0.07 * (1 - (o / road.halfWidth) ** 2) + rand() * 0.02;
        rows.push([p, rand()]);
      }
    }
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
    const mesh = new THREE.InstancedMesh(geo, mat, rows.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const tones = [0x8d8a84, 0x9d968a, 0x7c7a78, 0xa79f90, 0x6f6c6a, 0x958b7a];
    rows.forEach(([p, t], i) => {
      q.setFromEuler(new THREE.Euler((t - 0.5) * 0.12, roadYawKit + (t - 0.5) * 0.3, (rand() - 0.5) * 0.12));
      m.compose(p, q, new THREE.Vector3(1.1 + t * 0.3, 1, 0.85 + rand() * 0.2));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(tones[Math.floor(t * tones.length)]!));
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  // Barrières Vauban et public derrière, de part et d'autre.
  for (const side of [-1, 1]) {
    for (let b = road.cobblesFrom + 2; b < road.cobblesTo - 1; b += 2.4) {
      const p = road.at(b + 1.2, side * (road.halfWidth + 0.7));
      const bar = new Kit();
      for (const y of [0.15, 1.05]) bar.box(2.3, 0.05, 0.05, 0, y, 0, 0xb8bec6);
      for (let x = -1.1; x <= 1.1; x += 0.275) bar.box(0.03, 0.9, 0.03, x, 0.15, 0, 0xb8bec6);
      for (const x of [-1.05, 1.05]) bar.box(0.06, 0.06, 0.6, x, 0, 0, 0x8e959e);
      k.place(bar, p.x, 0, p.z, roadYawKit);
      for (const o of [0.6, 1.3]) {
        for (const db of [0.4, 1.2, 2.0]) {
          if (rand() > 0.75) continue;
          const q = road.at(b + db, side * (road.halfWidth + 0.7 + o));
          person(q.x, 0, q.z, roadYawKit + (side > 0 ? 0 : Math.PI) + Math.PI / 2, 0.5);
        }
      }
    }
    // Mâts de fanions par-dessus la route.
    for (let b = road.cobblesFrom + 6; b < road.cobblesTo; b += 16) {
      const p = road.at(b, side * (road.halfWidth + 0.4));
      pole(p.x, 0, p.z, 5.8, 0x8e959e);
    }
  }
  const bunting = new Batch();
  const lines: number[] = [];
  const garland = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
    const len = a.distanceTo(b);
    const n = Math.max(2, Math.floor(len / 0.5));
    const at = (t: number) => [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t];
    const ph = rand() * 6;
    for (let i = 0; i < n; i++) {
      const p0 = at((i + 0.1) / n);
      const p1 = at((i + 0.75) / n);
      const m = at((i + 0.425) / n);
      const tip = [m[0]!, m[1]! - 0.38, m[2]!];
      bunting.tri(p0, p1, tip, PENNANTS[i % PENNANTS.length]!, { hang: [0, 0, 1], phase: [ph + i * 0.37, ph + i * 0.37, ph + i * 0.37] });
    }
    for (let i = 0; i < 12; i++) lines.push(...at(i / 12), ...at((i + 1) / 12));
  };
  for (let b = road.cobblesFrom + 6; b < road.cobblesTo; b += 16) {
    const p = road.at(b, -(road.halfWidth + 0.4)).setY(5.7);
    const q = road.at(b, road.halfWidth + 0.4).setY(5.7);
    garland(p, q, 0.6);
  }
  // Sous l'avant-toit de la tribune, entre les poteaux.
  for (let x = -stand.length / 2; x < stand.length / 2 - 1; x += stand.length / 6) garland(home.at(x, stand.roofY - 0.9, 8.3), home.at(x + stand.length / 6, stand.roofY - 0.9, 8.3), 0.7);

  // --- Arche de ballons sur la porte des coureurs ------------------------------------------------------------------
  const balloons = new Batch();
  const balloon = (x: number, y: number, z: number, color: number, r = 0.42) => {
    const g = new THREE.IcosahedronGeometry(r, 1).scale(1, 1.12, 1);
    const pos = g.getAttribute('position');
    const ph = rand() * 6;
    for (let i = 0; i < pos.count; i += 3) {
      const v = [0, 1, 2].map((j) => [pos.getX(i + j) + x, pos.getY(i + j) + y, pos.getZ(i + j) + z]);
      balloons.tri(v[0]!, v[1]!, v[2]!, color, { phase: [ph, ph, ph] });
    }
  };
  {
    const a = track.point(ctx.gate.from, U_TOP + 0.12);
    const b = track.point(ctx.gate.to, U_TOP + 0.12);
    const base = track.height(ctx.gate.from, U_TOP) + 2.8;
    const half = Math.hypot(b.x - a.x, b.z - a.z) / 2;
    const f = track.frame(ctx.gate.from);
    const n = Math.round((Math.PI * half) / 0.75);
    for (let i = 0; i <= n; i++) {
      const th = (Math.PI * i) / n;
      const t = (1 - Math.cos(th)) / 2;
      const y = base + Math.sin(th) * 4.2;
      for (const [j, d] of [-0.36, 0, 0.36].entries()) {
        balloon(a.x + (b.x - a.x) * t + f.outX * d, y + (j === 1 ? 0.25 : 0), a.z + (b.z - a.z) * t + f.outZ * d, PENNANTS[(i + j) % 3]!);
      }
    }
  }

  // --- Portique d'arrivée, cloche du dernier tour --------------------------------------------------------------------
  const topF = track.height(ctx.finishS, U_TOP);
  const gantry = new Kit();
  const zIn = -ctx.apron + 0.4;
  const zOut = U_TOP + 0.75;
  gantry.box(0.5, 6.6, 0.5, 0, 0, zIn, 0x1d1f24).box(0.5, 6.6 - topF, 0.5, 0, topF + 0.2, zOut, 0x1d1f24);
  gantry.box(0.6, 1.1, zOut - zIn + 0.5, 0, 5.8, (zIn + zOut) / 2, 0xd8262f);
  for (let i = 0; i < 22; i++) {
    for (const [r, y] of [[0, 5.62], [1, 5.44]] as const) {
      const z = zIn + ((zOut - zIn) * (i + 0.5)) / 22;
      gantry.box(0.62, 0.18, (zOut - zIn) / 22, 0, y, z, (i + r) % 2 ? 0x1a1a1a : 0xf5f5f5);
    }
  }
  k.place(gantry, finish.origin.x, 0, finish.origin.z, finish.yaw);
  for (const side of [-1, 1]) {
    const banner = sign(['ARRIVÉE'], 7.2, 0.95, 0xd8262f);
    banner.position.copy(finish.at(side * 0.34, 6.35, (zIn + zOut) / 2));
    banner.rotation.y = finish.yaw - Math.PI / 2;
    group.add(banner);
  }
  // Tableau des tours et sa cloche, côté pelouse, juste avant la ligne.
  const bellAt = finish.at(-3, 0, -ctx.apron + 0.6);
  k.box(0.14, 2.95, 0.14, bellAt.x, 0, bellAt.z, 0x1d1f24);
  // Tableau des tours : le nombre de tours bouclés par le joueur, lisible des deux côtés (`setLaps`).
  let laps = 0;
  let lapCanvas: HTMLCanvasElement | undefined;
  let lapTex: THREE.CanvasTexture | undefined;
  const drawLaps = () => {
    if (!lapCanvas || !lapTex) return;
    const g = lapCanvas.getContext('2d')!;
    const { width: W, height: H } = lapCanvas;
    g.fillStyle = '#1d1f24';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 8;
    g.strokeRect(10, 10, W - 20, H - 20);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f2c230';
    g.font = '700 64px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
    g.fillText(laps === 1 ? 'TOUR' : 'TOURS', W / 2, 74);
    g.fillStyle = '#ffffff';
    g.font = '700 200px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
    g.fillText(String(laps), W / 2, 222, W - 60);
    lapTex.needsUpdate = true;
  };
  {
    const plain = new THREE.MeshStandardNodeMaterial({ color: 0x1d1f24, roughness: 0.7 });
    let face: THREE.Material = plain;
    if (typeof document !== 'undefined') {
      lapCanvas = document.createElement('canvas');
      lapCanvas.width = 384;
      lapCanvas.height = 320;
      lapTex = new THREE.CanvasTexture(lapCanvas);
      lapTex.colorSpace = THREE.SRGBColorSpace;
      lapTex.anisotropy = 8;
      face = new THREE.MeshStandardNodeMaterial({ map: lapTex, roughness: 0.7 });
      drawLaps();
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.25, 0.08), [plain, plain, plain, plain, face, face]);
    board.position.set(bellAt.x, 3.55, bellAt.z);
    board.rotation.y = finish.yaw - Math.PI / 2;
    board.castShadow = true;
    group.add(board);
  }
  /** Temps restant de la volée de cloche qui salue chaque tour, en s. */
  let ring = 0;
  const bell = new THREE.Group();
  const bellMesh = new Kit().add(new THREE.CylinderGeometry(0.08, 0.24, 0.34, 8, 1, true).translate(0, -0.2, 0), 0xd9a83a).add(new THREE.SphereGeometry(0.05, 6, 4).translate(0, -0.4, 0), 0x6e5236).mesh();
  (bellMesh.material as THREE.Material).side = THREE.DoubleSide;
  bell.add(bellMesh);
  bell.position.set(bellAt.x, 2.7, bellAt.z);
  bell.rotation.y = finish.yaw;
  group.add(bell);

  // --- Podium, pavé, photographes, confettis ------------------------------------------------------------------------
  const podium = new Kit();
  const pz = -ctx.apron - 13;
  const px = 22;
  podium.box(12, 0.5, 5.5, px, 0, pz, 0x2b3a55);
  podium.box(12, 3.6, 0.25, px, 0, pz - 2.9, 0x2b3a55);
  for (const [dx, h] of [[0, 1.1], [-1.9, 0.75], [1.9, 0.5]] as const) podium.box(1.8, h, 1.5, px + dx, 0.5, pz - 0.6, 0xf5f3ee);
  podium.box(0.55, 1.05, 0.55, px + 4, 0.5, pz + 1.4, 0x8a5c36);
  podium.add(lumpy(new THREE.BoxGeometry(0.34, 0.2, 0.26, 1, 1, 1), 0.08, 7), 0x8d8a84, px + 4, 1.65, pz + 1.4);
  k.place(podium, finish.origin.x, 0, finish.origin.z, finish.yaw);
  const backdrop = sign(['ROUBAIX', 'VÉLODROME ANDRÉ-PÉTRIEUX'], 11, 2.4, 0xd8262f);
  backdrop.position.copy(finish.at(px, 2.5, pz - 2.75));
  backdrop.rotation.y = finish.yaw;
  group.add(backdrop);
  for (const [dx, h, shirt] of [[0, 1.6, 0xf6d32a], [-1.9, 1.25, 0x24419a], [1.9, 1.0, 0xd8262f]] as const) {
    const p = finish.at(px + dx, 0, pz - 0.6);
    people.push({ x: p.x, y: h, z: p.z, yaw: finish.yaw, cheer: true, shirt, scale: 1, phase: rand() });
  }
  for (const sx of [-6, 6]) for (let i = 0; i < 7; i++) {
    const p = finish.at(px + sx + (rand() - 0.5) * 0.6, 0, pz - 2.4 + (rand() - 0.5) * 0.6);
    balloon(p.x, 0.9 + i * 0.62, p.z, PENNANTS[i % 3]!, 0.36);
  }
  // Photographes et officiels sur la bordure, après la ligne.
  for (let i = 0; i < 26; i++) {
    const p = finish.at(4 + rand() * 18, 0, -ctx.apron - 1 - rand() * 4);
    person(p.x, 0, p.z, finish.yaw + Math.PI, 0.15, rand() < 0.5 ? 0x1a1a1a : 0xf08a3c);
  }
  {
    const N = 700;
    const geo = new THREE.PlaneGeometry(0.11, 0.07);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, side: THREE.DoubleSide });
    const ph = asFloat(instancedBufferAttribute(new THREE.InstancedBufferAttribute(Float32Array.from({ length: N }, () => rand()), 1)));
    const H = 9;
    const fall = mod(time.mul(0.7).add(ph.mul(H)), H);
    mat.positionNode = asPos(positionLocal.add(vec3(sin(time.mul(2.3).add(ph.mul(40))).mul(0.35), fall.negate().add(H), cos(time.mul(1.9).add(ph.mul(31))).mul(0.35))));
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const p = finish.at(px + (rand() - 0.5) * 16, 0.5, pz + 1 + (rand() - 0.5) * 9);
      m.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6)), new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set([...PENNANTS, 0xf08a3c, 0x3a9b5c][Math.floor(rand() * 6)]!));
    }
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  // --- Fumigènes dans le public des virages ----------------------------------------------------------------------
  {
    const spots: { p: THREE.Vector3; color: number }[] = [];
    for (const [s0, s1] of ctx.bends) for (const t of [0.3, 0.7]) {
      const s = s0 + (s1 - s0) * t;
      const p = track.point(s, U_TOP + 0.9);
      spots.push({ p: new THREE.Vector3(p.x, track.height(s, U_TOP) + 2, p.z), color: rand() < 0.5 ? 0xe8443a : 0xf2c230 });
    }
    const PUFFS = 14;
    const geo = new THREE.IcosahedronGeometry(0.7, 0);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 1, flatShading: true });
    const ph = asFloat(instancedBufferAttribute(new THREE.InstancedBufferAttribute(Float32Array.from({ length: spots.length * PUFFS }, () => rand()), 1)));
    // Chaque bouffée a sa vitesse, sa taille et sa dérive : le panache s'effiloche au lieu de s'empiler.
    const life = fract(time.mul(fract(ph.mul(13.7)).mul(0.08).add(0.14)).add(ph));
    const grow = fract(ph.mul(37.1)).mul(0.7).add(0.6);
    const size = smoothstep(0, 0.1, life).mul(life.mul(2.2).add(0.3)).mul(grow).mul(smoothstep(0.7, 1, life).oneMinus());
    const spread = life.mul(2.2);
    const drift = vec3(life.mul(life).mul(6).add(sin(ph.mul(173.1)).mul(spread)), life.mul(fract(ph.mul(5.3)).mul(4).add(6)), life.mul(1.2).add(cos(ph.mul(91.7)).mul(spread)));
    const center = positionLocal.sub(positionGeometry);
    mat.positionNode = asPos(center.add(positionGeometry.mul(size)).add(drift));
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length * PUFFS);
    const c = new THREE.Color();
    spots.forEach((sp, j) => {
      for (let i = 0; i < PUFFS; i++) {
        mesh.setMatrixAt(j * PUFFS + i, new THREE.Matrix4().makeTranslation(sp.p.x, sp.p.y, sp.p.z));
        mesh.setColorAt(j * PUFFS + i, c.set(sp.color).lerp(new THREE.Color(0xffffff), rand() * 0.35));
      }
      pole(sp.p.x, sp.p.y - 0.4, sp.p.z, 0.4, 0xd8262f);
    });
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  // --- Écran géant, derrière le premier virage ---------------------------------------------------------------------
  let screen: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } | undefined;
  {
    const p = track.point(ctx.screenS, 27);
    const yaw = Math.atan2(-p.x, -p.z);
    const frame = new Kit();
    for (const sx of [-4, 4]) frame.box(0.5, 8, 0.5, sx, 0, -0.6, 0x5a6270);
    frame.box(11, 6.4, 0.5, 0, 6.8, 0, 0x1d1f24);
    k.place(frame, p.x, 0, p.z, yaw);
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 352;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      screen = { canvas, tex };
      const face = new THREE.Mesh(new THREE.PlaneGeometry(10.2, 5.6), new THREE.MeshBasicNodeMaterial({ map: tex, fog: false }));
      face.position.set(p.x + Math.sin(yaw) * 0.27, 10, p.z + Math.cos(yaw) * 0.27);
      face.rotation.y = yaw;
      group.add(face);
    }
  }
  let clock = 0;
  let drawn = -1;
  const drawScreen = () => {
    if (!screen) return;
    const ctx2 = screen.canvas.getContext('2d')!;
    const { width: W, height: H } = screen.canvas;
    const slide = Math.floor(clock / 6) % 3;
    ctx2.fillStyle = '#0e1726';
    ctx2.fillRect(0, 0, W, H);
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'middle';
    const font = (px: number) => `700 ${px}px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif`;
    if (slide === 0) {
      ctx2.fillStyle = '#d8262f';
      ctx2.fillRect(0, 0, W, 70);
      ctx2.fillStyle = '#ffffff';
      ctx2.font = font(46);
      ctx2.fillText('VÉLODROME ANDRÉ-PÉTRIEUX', W / 2, 36, W - 40);
      ctx2.font = font(150);
      ctx2.fillText('ROUBAIX', W / 2, 205);
    } else if (slide === 1) {
      // Les tours du joueur, comme le tableau au bord de la piste.
      ctx2.fillStyle = '#f2c230';
      ctx2.font = font(60);
      ctx2.fillText(laps === 1 ? 'TOUR BOUCLÉ' : 'TOURS BOUCLÉS', W / 2, 70);
      ctx2.fillStyle = '#ffffff';
      ctx2.font = font(170);
      ctx2.fillText(String(laps), W / 2, 190);
      ctx2.fillStyle = '#9fb3c8';
      ctx2.font = font(40);
      ctx2.fillText(`${(laps * 0.49975).toFixed(1).replace('.', ',')} km sur la piste`, W / 2, 284);
    } else {
      const t = 5 * 3600 + 38 * 60 + 12 + Math.floor(clock);
      const hms = `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      ctx2.fillStyle = '#9fb3c8';
      ctx2.font = font(50);
      ctx2.fillText('TEMPS DE COURSE', W / 2, 80);
      ctx2.fillStyle = '#ffffff';
      ctx2.font = font(150);
      ctx2.fillText(hms, W / 2, 210);
    }
    // Damier en bas d'écran.
    for (let i = 0; i < 32; i++) for (let j = 0; j < 2; j++) {
      ctx2.fillStyle = (i + j) % 2 ? '#ffffff' : '#1a1a1a';
      ctx2.fillRect(i * 20, H - 40 + j * 20, 20, 20);
    }
    screen.tex.needsUpdate = true;
  };

  // --- Bâches publicitaires sur le mur --------------------------------------------------------------------------
  if (typeof document !== 'undefined') {
    const msgs: [string, string, string][] = [
      ['ROUBAIX', '#d8262f', '#ffffff'],
      ["L'ENFER DU NORD", '#1a1a1a', '#f6d32a'],
      ['ARRIVÉE', '#f6d32a', '#1a1a1a'],
      ['PAVÉS DU NORD', '#2b3a55', '#ffffff'],
      ['HAUTS-DE-FRANCE', '#3a7d44', '#ffffff'],
      ['VÉLODROME', '#f5f3ee', '#2b3a55'],
    ];
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 128 * msgs.length;
    const g2 = canvas.getContext('2d')!;
    msgs.forEach(([text, bg, fg], i) => {
      g2.fillStyle = bg;
      g2.fillRect(0, i * 128, 1024, 128);
      g2.fillStyle = fg;
      g2.font = '700 96px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
      g2.textAlign = 'center';
      g2.textBaseline = 'middle';
      g2.fillText(text, 512, i * 128 + 66, 980);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const pos: number[] = [];
    const uv: number[] = [];
    let n = 0;
    for (let s = 2; s < track.lapM - 7; s += 7.5, n++) {
      if (s + 6.5 > ctx.gate.from && s < ctx.gate.to) continue;
      const row = n % msgs.length;
      const v0 = 1 - (row + 1) / msgs.length;
      const v1 = 1 - row / msgs.length;
      for (let i = 0; i < 3; i++) {
        const sa = s + i * 2;
        const sb = sa + 2;
        const [pa, pb] = [track.point(sa, U_TOP - 0.03), track.point(sb, U_TOP - 0.03)];
        const [ya, yb] = [track.height(sa, U_TOP), track.height(sb, U_TOP)];
        // Le texte se lit de gauche à droite depuis la piste, c'est-à-dire à rebours de `s`.
        const ua = 1 - i / 3;
        const ub = 1 - (i + 1) / 3;
        const A = [pa.x, ya + 0.12, pa.z];
        const B = [pa.x, ya + 1.0, pa.z];
        const Cc = [pb.x, yb + 0.12, pb.z];
        const D = [pb.x, yb + 1.0, pb.z];
        pos.push(...A, ...B, ...Cc, ...B, ...D, ...Cc);
        uv.push(ua, v0, ua, v1, ub, v0, ua, v1, ub, v1, ub, v0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.8 }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // --- Parvis : baraques à frites, tables, mâts de drapeaux --------------------------------------------------------
  const zF = stand.facadeZ;
  ['FRITES', 'GAUFRES', 'BUVETTE'].forEach((label, i) => {
    const x = -52 + i * 12;
    const z = zF + 15;
    const stall = new Kit();
    stall.box(4.2, 1.1, 1.1, 0, 0, -1.6, [0xd8262f, 0xf2c230, 0x24419a][i]!);
    stall.box(4.2, 2.6, 0.2, 0, 0, 1.7, 0xf5f3ee).box(0.2, 2.6, 3.4, -2.1, 0, 0, 0xf5f3ee).box(0.2, 2.6, 3.4, 2.1, 0, 0, 0xf5f3ee);
    for (let j = 0; j < 7; j++) stall.box(4.6 / 7, 0.14, 4.0, -2.3 + (4.6 / 7) * (j + 0.5), 2.7, 0, j % 2 ? 0xf5f5f5 : 0xd8262f);
    for (let j = 0; j < 7; j++) stall.add(new THREE.ConeGeometry(0.33, 0.35, 3).rotateX(Math.PI), j % 2 ? 0xf5f5f5 : 0xd8262f, -2.3 + (4.6 / 7) * (j + 0.5), 2.5, -2.0);
    const p = home.at(x, 0, z);
    k.place(stall, p.x, 0, p.z, home.yaw);
    const label3d = sign([label], 3.2, 0.7, 0x1d1f24);
    label3d.position.copy(home.at(x, 3.25, z - 1.9));
    label3d.rotation.y = home.yaw;
    group.add(label3d);
    // File d'attente et clients attablés.
    for (let q = 0; q < 6; q++) {
      const pp = home.at(x + (rand() - 0.5) * 3, 0, z - 3 - q * 0.7);
      person(pp.x, 0, pp.z, home.yaw, 0.05);
    }
  });
  for (let i = 0; i < 6; i++) {
    const t = new Kit();
    t.box(2.2, 0.08, 0.8, 0, 0.72, 0, 0xb08552);
    for (const z of [-0.65, 0.65]) t.box(2.2, 0.06, 0.3, 0, 0.42, z, 0xb08552);
    for (const x of [-0.9, 0.9]) t.box(0.08, 0.72, 0.08, x, 0, 0, 0x6e5236);
    const x = -50 + (i % 3) * 12;
    const z = zF + 6 + Math.floor(i / 3) * 3.4;
    const p = home.at(x, 0, z);
    k.place(t, p.x, 0, p.z, home.yaw);
    for (const dz of [-0.85, 0.85]) if (rand() < 0.8) {
      const pp = home.at(x + (rand() - 0.5) * 1.4, 0, z + dz);
      person(pp.x, -0.35, pp.z, home.yaw + (dz > 0 ? Math.PI : 0), 0.1);
    }
  }
  // Promeneurs sur le parvis.
  for (let i = 0; i < 110; i++) {
    const lx = -25 + rand() * 100;
    const lz = zF + 4 + rand() * 18;
    if (lx > 45 && lx < 67 && lz > zF + 11) continue; // les douches
    const p = home.at(lx, 0, lz);
    person(p.x, 0, p.z, rand() * Math.PI * 2, 0.15);
  }
  // Mâts de drapeaux devant la façade, et sur le toit de la tribune.
  for (let i = 0; i < 8; i++) {
    const p = home.at(-35 + i * 10, 0, zF + 3.5);
    pole(p.x, 0, p.z, 9.2, 0xeeeeee);
    flag(p.x, 9.1, p.z, home.yaw + (rand() - 0.5) * 0.4, 2.6, 1.7, ['france', 'flandre', 'belgique', 'damier'][i % 4]!);
  }
  for (let i = 0; i < 5; i++) {
    const p = home.at(-32 + i * 16, 0, zF - 0.9);
    pole(p.x, 13.8, p.z, 4.2, 0xeeeeee);
    flag(p.x, 17.9, p.z, home.yaw + Math.PI / 2, 2, 1.3, ['flandre', 'france', 'damier', 'belgique', 'flandre'][i]!);
  }

  // --- Bus et voitures des équipes ---------------------------------------------------------------------------------
  {
    const { x0, x1, z0, z1 } = ctx.parking;
    const lot = new Kit();
    lot.box(x1 - x0, 0.05, z1 - z0, (x0 + x1) / 2, 0, (z0 + z1) / 2, 0x7d8292);
    const liveries = [0x24419a, 0xf5f5f5, 0x1a1a1a, 0xd8262f, 0x3a9b5c];
    const wheel = (kk: Kit, x: number, z: number, r: number) => kk.add(new THREE.CylinderGeometry(r, r, 0.3, 8).rotateZ(Math.PI / 2), 0x1d1f24, x, r, z);
    let x = x0 + 4;
    for (let i = 0; i < 4; i++, x += 4.2) {
      const bus = new Kit();
      const c = liveries[i % liveries.length]!;
      bus.box(2.55, 3.1, 12, 0, 0.45, 0, c).box(2.6, 1.0, 11.2, 0, 2.2, 0.2, 0x2a3442).box(2.4, 1.6, 0.06, 0, 1.6, 6.02, 0x2a3442);
      bus.box(2.6, 0.35, 12.05, 0, 0.9, 0, liveries[(i + 2) % liveries.length]!);
      for (const z of [-4, -2.8, 4]) for (const sx of [-1.15, 1.15]) wheel(bus, sx, z, 0.5);
      const p = back.at(x, 0, (z0 + z1) / 2 - 2);
      k.place(bus, p.x, 0, p.z, back.yaw);
    }
    for (let i = 0; i < 6; i++, x += 3.2) {
      const car = new Kit();
      const c = liveries[(i + 1) % liveries.length]!;
      car.box(1.85, 0.8, 4.7, 0, 0.3, 0, c).box(1.7, 0.6, 2.8, 0, 1.1, -0.3, 0x2a3442).box(1.6, 0.06, 2.6, 0, 1.75, -0.3, 0x8e959e);
      for (const z of [-1.5, 1.5]) for (const sx of [-0.95, 0.95]) wheel(car, sx, z, 0.33);
      // Vélos sur le toit.
      for (const sx of [-0.55, 0, 0.55]) {
        for (const z of [-0.85, 0.5]) car.add(new THREE.TorusGeometry(0.34, 0.03, 4, 10).rotateY(Math.PI / 2), 0x1d1f24, sx, 2.15, z - 0.2);
        car.box(0.04, 0.04, 1.2, sx, 2.25, -0.35, liveries[(i + 3) % liveries.length]!);
      }
      const p = back.at(x, 0, (z0 + z1) / 2 + 3);
      k.place(car, p.x, 0, p.z, back.yaw);
    }
    const o = back.at(0, 0, 0);
    k.place(lot, o.x, 0, o.z, back.yaw);
    // Mécaniciens et curieux autour des bus.
    for (let i = 0; i < 40; i++) {
      const p = back.at(x0 + rand() * (x1 - x0), 0, z0 + 2 + rand() * (z1 - z0 - 4));
      person(p.x, 0, p.z, rand() * 6, 0.1);
    }
  }

  // --- Hélicoptère de la télévision ------------------------------------------------------------------------------
  const heli = new THREE.Group();
  const rotor = new Kit().box(11, 0.05, 0.32, 0, 0, 0, 0x2a2a2a).box(0.32, 0.05, 11, 0, 0, 0, 0x2a2a2a).mesh();
  {
    const body = new Kit();
    body.add(new THREE.IcosahedronGeometry(1.3, 0).scale(1, 0.85, 1.9), 0xf5f5f5);
    body.add(new THREE.IcosahedronGeometry(1.05, 0).scale(1, 0.6, 1.2), 0x2a3442, 0, 0.25, 1.1);
    body.box(0.35, 0.4, 5, 0, 0.25, -3.6, 0xf5f5f5).box(0.12, 1.3, 0.8, 0, 0.3, -6, 0xd8262f);
    for (const sx of [-0.8, 0.8]) body.box(0.1, 0.1, 3.4, sx, -1.35, 0.2, 0x5a6270);
    body.box(0.3, 0.4, 0.3, 0, 1.0, 0, 0x5a6270);
    body.add(new THREE.SphereGeometry(0.28, 6, 4), 0x1d1f24, 0, -1.0, 1.6); // caméra
    heli.add(body.mesh());
    rotor.position.y = 1.25;
    heli.add(rotor);
  }
  group.add(heli);
  let heliA = 0;

  // --- Assemblage ----------------------------------------------------------------------------------------------
  group.add(k.mesh());
  for (const m of crowdMeshes(people)) group.add(m);
  group.add(
    flags.mesh((a, v) => {
      const u = a('flagU');
      return positionLocal.add(v('flagN').mul(sin(time.mul(6).sub(u.mul(5)).add(a('phase').mul(6.28))).mul(u)));
    }),
  );
  group.add(
    bunting.mesh((a) => {
      const h = a('hang');
      const ph = a('phase');
      return positionLocal.add(vec3(sin(time.mul(2.4).add(ph)).mul(0.12).mul(h), 0, cos(time.mul(1.9).add(ph.mul(1.3))).mul(0.12).mul(h)));
    }),
  );
  group.add(
    balloons.mesh((a) => {
      const ph = a('phase');
      return positionLocal.add(vec3(sin(time.mul(1.1).add(ph)).mul(0.06), sin(time.mul(1.4).add(ph)).mul(0.1), cos(time.mul(0.9).add(ph)).mul(0.06)));
    }, THREE.FrontSide),
  );
  const cable = new THREE.BufferGeometry();
  cable.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  group.add(new THREE.LineSegments(cable, new THREE.LineBasicNodeMaterial({ color: 0x3a3a3a })));

  const sky = (a: number) => new THREE.Vector3(Math.cos(a) * 190, 85 + Math.sin(a * 2) * 6, Math.sin(a) * 150);
  return {
    group,
    setLaps(n) {
      if (n === laps) return;
      if (n > laps) ring = 3; // la cloche salue le tour bouclé
      laps = n;
      drawLaps();
      drawn = -1; // l'écran géant aussi
    },
    update(dtS) {
      clock += dtS;
      ring = Math.max(0, ring - dtS);
      bell.rotation.z = Math.sin(clock * 9) * 0.6 * Math.min(1, ring);
      heliA += dtS * 0.11;
      const p = sky(heliA);
      const ahead = sky(heliA + 0.01);
      heli.position.copy(p);
      heli.rotation.set(0, Math.atan2(ahead.x - p.x, ahead.z - p.z), 0);
      heli.rotateZ(-0.18);
      heli.rotateX(0.08);
      rotor.rotation.y += dtS * 38;
      const frame = Math.floor(clock * 2);
      if (frame !== drawn) {
        drawn = frame;
        drawScreen();
      }
    },
  };
}
