import * as THREE from 'three/webgpu';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, cameraPosition, color, dot, exp, float, floor, fract, mix, normalWorld, normalize, positionLocal, positionWorld, pow, sin, smoothstep as tslSmoothstep, time, transformNormalToView, vec3 } from 'three/tsl';
import type { Edge } from '../../domain/course/network';
import { createTones, DAY, type Ambiance, type Tones } from '../core/ambiance';
import type { RiderAssets } from '../core/assets';
import { drain, type Steps } from '../../shared/util/background';
import { Decor, DECOR_HIGH, DECOR_LOW, type DecorOptions } from './decor';
import { faceted, instanced, merge } from '../core/geometry-utils';
import { buildMarie } from './marie';
import { buildRichard } from './richard';
import { fbm, mulberry32, smoothstep, valueNoise } from '../core/noise';
import { PALETTE } from '../core/palette';
import { buildPlaces } from './places';
import { buildRoadside } from './roadside';
import { buildSkyRoad } from './sky-road';
import { asphaltGrain, cloudShade } from '../core/shade';
import { Terrain } from './terrain';
import { forestCover } from './vegetation';
import { FAR_MARGIN_M, ROAD_HALF, sideOf, type WaterHit, type WorldLayout } from './world-layout';

/**
 * Portée de la caméra, en m : les montagnes et les nuages du côté opposé du réseau sont à plus de 15 km. La précision
 * de profondeur dépend du plan proche, pas de celui-ci.
 */
export const CAMERA_FAR_M = 20000;

export interface World {
  group: THREE.Group;
  sky: THREE.Mesh;
  sun: SunLight;
  /** Construit d'un coup le décor autour de (x, z) : à l'ouverture de la vue. */
  prime(x: number, z: number): void;
  /**
   * `prime` par étapes, un morceau de terrain ou de décor à la fois : à dérouler avec `Background.run`. `nearOnly` :
   * seulement les abords (assez pour la première image) ; le reste se complète avec `fillSteps`.
   */
  primeSteps(x: number, z: number, nearOnly?: boolean): Steps;
  /**
   * Complète en tâche de fond ce que `primeSteps(x, z, true)` a laissé. Tant qu'elle tourne, `update` ne construit rien
   * (les deux construiraient les mêmes morceaux) ; elle peut tourner pendant qu'on roule.
   */
  fillSteps(x: number, z: number): Steps;
  /** Change la lumière, le ciel et la brume : l'ambiance du parcours choisi. */
  setAmbiance(a: Ambiance): void;
  /**
   * Anime les éléments vivants du décor (Marie et sa roue, Richard et son escalier) et peuple le terrain et le décor autour du cycliste.
   * Marie disparaît quand le cycliste en est loin.
   */
  update(dtS: number, rider?: { x: number; z: number }): void;
  /** Tours de piste bouclés par le joueur : le vélodrome les affiche (tableau, écran géant) et sonne la cloche. */
  setVelodromeLaps(n: number): void;
  /**
   * La vitesse du cycliste fait courir la lumière sur la Route arc-en-ciel ; `cabinY` (hauteur à l'image) monte la
   * plateforme de l'ascenseur pendant qu'il y est.
   */
  setRide(speedMs: number, cabinY?: number): void;
  /** Ce qui est construit en ce moment, pour les mesures. */
  stats(): { chunks: number; decorInstances: number; coarseNearRoad: number };
}

/**
 * Abords construits avant la première image quand le reste peut suivre en tâche de fond (`primeSteps(x, z, true)`) :
 * la route et ses deux virages devant soi. Au-delà, le relief lointain grossier tient lieu de sol le temps que les
 * morceaux arrivent, en une ou deux secondes.
 */
const NEAR_TERRAIN_M = 400;
const NEAR_DECOR_M = 300;

export interface WorldOptions {
  decor: DecorOptions;
  /** Rayon de relief et de décor construits autour du cycliste, en m. */
  terrainRadiusM: number;
  decorRadiusM: number;
  /** Nombre de nuages. */
  clouds: number;
  /** Découpage de l'anneau de montagnes autour du réseau. */
  mountainSegments: number;
  /** Définition de chaque cascade d'ombre. */
  shadowMapSize: number;
}

export const WORLD_HIGH: WorldOptions = {
  decor: DECOR_HIGH,
  terrainRadiusM: 1200,
  decorRadiusM: 800,
  clouds: 60,
  mountainSegments: 256,
  shadowMapSize: 2048,
};
export const WORLD_LOW: WorldOptions = {
  decor: DECOR_LOW,
  terrainRadiusM: 800,
  decorRadiusM: 480,
  clouds: 30,
  mountainSegments: 192,
  shadowMapSize: 1024,
};

/* ---------- Routes ---------- */

/** Une route est tenue à l'écart des bouts : pas de tirets ni de lignes dans la zone d'un carrefour, en m. */
const JUNCTION_CLEAR_M = 12;
/** Largeur du bas-côté sableux, mesurée depuis l'axe de la route, en m. */
const SHOULDER_OUT_M = 4.5;
/** Rayon de la plaque d'asphalte posée à chaque carrefour, en m. */
const JUNCTION_RADIUS_M = 12;

type Keep = (e: Edge, i: number, s0: number, s1: number) => boolean;

/**
 * Bande de largeur variable le long de chaque route, de `latA` à `latB` (positif = à gauche), en pas de `stepM`.
 * Un seul maillage pour toutes les routes : quelques appels de dessin pour tout le réseau.
 */
function ribbon(layout: WorldLayout, latA: number, latB: number, lift: number, stepM: number, keep: Keep = () => true): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const e of layout.edges) {
    const n = Math.max(1, Math.round(e.lengthM / stepM));
    const pos: number[] = [];
    const idx: number[] = [];
    const drawn = e.def.surface !== 'track';
    for (let i = 0; i < n; i++) {
      const s0 = (i * e.lengthM) / n;
      const s1 = ((i + 1) * e.lengthM) / n;
      if (!drawn || !keep(e, i, s0, s1)) continue;
      // Le vélodrome dessine lui-même sa piste et sa route d'accès.
      const mid = e.pointAt((s0 + s1) / 2);
      if (layout.underVelodrome(mid.x, mid.z)) continue;
      const base = pos.length / 3;
      for (const s of [s0, s1]) {
        const p = e.pointAt(s);
        const side = sideOf(e.headingAt(s));
        const y = layout.y(e.altitudeAt(s)) + lift;
        pos.push(p.x + side.x * latA, y, p.z + side.z * latA, p.x + side.x * latB, y, p.z + side.z * latB);
      }
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    if (!idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

/** La route par étapes : une bande (chaussée, bas-côté, ligne) à la fois. */
function* buildRoad(layout: WorldLayout): Steps<THREE.Group> {
  const out = new THREE.Group();
  const asphaltMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92 });
  asphaltMat.colorNode = color(PALETTE.road).mul(asphaltGrain()).mul(cloudShade()) as unknown as NonNullable<THREE.MeshStandardNodeMaterial['colorNode']>;
  const asphalt = new THREE.Mesh(ribbon(layout, -ROAD_HALF, ROAD_HALF, 0.04, 4), asphaltMat);
  asphalt.receiveShadow = true;
  out.add(asphalt);
  yield;

  // Bas-côté sableux : une bande de chaque côté, posée sous la chaussée, qui donne un bord net au gazon.
  const sandMat = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  sandMat.colorNode = color(PALETTE.sand).mul(cloudShade()) as unknown as NonNullable<THREE.MeshStandardNodeMaterial['colorNode']>;
  for (const [a, b] of [[-SHOULDER_OUT_M, -ROAD_HALF + 0.2], [ROAD_HALF - 0.2, SHOULDER_OUT_M]] as const) {
    const shoulder = new THREE.Mesh(ribbon(layout, a, b, 0.025, 4), sandMat);
    shoulder.receiveShadow = true;
    out.add(shoulder);
    yield;
  }

  // Plaque d'asphalte à chaque carrefour : elle couvre l'angle entre deux routes qui ne se prolongent pas.
  const discs: THREE.BufferGeometry[] = [];
  for (const n of layout.network.nodes.values()) {
    if (layout.underVelodrome(n.x, n.z) || layout.skyNodes.has(n.id)) continue;
    discs.push(new THREE.CircleGeometry(JUNCTION_RADIUS_M, 28).rotateX(-Math.PI / 2).translate(n.x, layout.y(n.altitude) + 0.035, n.z));
  }
  const junctions = new THREE.Mesh(merge(discs), asphaltMat);
  junctions.receiveShadow = true;
  out.add(junctions);

  // Ligne centrale jaune en tirets (3 m peints, 6 m de vide), bords blancs continus, hors de la zone des carrefours.
  const yellow = new THREE.MeshStandardNodeMaterial({ color: PALETTE.centerLine, roughness: 0.7 });
  const white = new THREE.MeshStandardNodeMaterial({ color: PALETTE.edgeLine, roughness: 0.75 });
  const inside: Keep = (e, _i, s0, s1) => s0 > JUNCTION_CLEAR_M && s1 < e.lengthM - JUNCTION_CLEAR_M;
  yield;
  const dashes = new THREE.Mesh(ribbon(layout, -0.08, 0.08, 0.06, 3, (e, i, s0, s1) => i % 3 === 0 && inside(e, i, s0, s1)), yellow);
  yield;
  const edgeL = new THREE.Mesh(ribbon(layout, -ROAD_HALF + 0.25, -ROAD_HALF + 0.4, 0.06, 4, inside), white);
  yield;
  const edgeR = new THREE.Mesh(ribbon(layout, ROAD_HALF - 0.4, ROAD_HALF - 0.25, 0.06, 4, inside), white);
  for (const m of [dashes, edgeL, edgeR]) {
    m.receiveShadow = true;
    out.add(m);
  }
  return out;
}

/* ---------- Clôture ---------- */

/** Clôture en bois sur le bord droit, par tronçons : piquets tous les 2,6 m et deux lisses. */
function buildFence(layout: WorldLayout): THREE.Group {
  const lat = -(ROAD_HALF + 2.3); // côté négatif : à droite dans le sens de définition de la route
  const step = 2.6;
  const posts: THREE.Vector3[][] = [];
  for (const l of layout.network.landmarks) {
    if (l.kind !== 'fence') continue;
    const e = layout.network.edges.get(l.edge)!;
    const out: THREE.Vector3[] = [];
    for (let s = l.from; s <= l.to; s += step) {
      const p = e.pointAt(s);
      const side = sideOf(e.headingAt(s));
      const x = p.x + side.x * lat;
      const z = p.z + side.z * lat;
      out.push(new THREE.Vector3(x, layout.groundY(x, z), z));
    }
    posts.push(out);
  }
  const g = new THREE.Group();
  const nPosts = posts.reduce((n, l) => n + l.length, 0);
  if (!nPosts) return g;
  const nRails = posts.reduce((n, l) => n + 2 * Math.max(0, l.length - 1), 0);
  const postGeo = faceted(new THREE.CylinderGeometry(0.075, 0.085, 1.25, 7).translate(0, 0.55, 0));
  const railGeo = new THREE.BoxGeometry(0.07, 0.11, 1); // le long de z, longueur 1 (étirée par instance)
  const postMesh = instanced(postGeo, nPosts, { color: PALETTE.wood, roughness: 0.9 });
  const railMesh = instanced(railGeo, Math.max(1, nRails), { color: PALETTE.wood, roughness: 0.9 });
  const dummy = new THREE.Object3D();
  const mid = new THREE.Vector3();
  let ip = 0;
  let ir = 0;
  for (const line of posts) {
    line.forEach((q, k) => {
      dummy.position.copy(q);
      dummy.rotation.set(0, k * 1.7, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      postMesh.setMatrixAt(ip++, dummy.matrix);
      const next = line[k + 1];
      if (!next) return;
      for (const h of [0.5, 0.95]) {
        mid.copy(q).add(next).multiplyScalar(0.5);
        dummy.position.set(mid.x, mid.y + h, mid.z);
        dummy.scale.set(1, 1, q.distanceTo(next) + 0.12);
        dummy.lookAt(next.x, next.y + h, next.z);
        dummy.updateMatrix();
        railMesh.setMatrixAt(ir++, dummy.matrix);
      }
    });
  }
  railMesh.count = ir;
  g.add(postMesh, railMesh);
  return g;
}

/* ---------- Arches ---------- */

function bannerTexture(text: string): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `#${PALETTE.gantry.getHexString()}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = PALETTE.accent;
  ctx.fillRect(0, canvas.height - 10, canvas.width, 10);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 64px "Barlow Condensed", "Arial Narrow", "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 4, canvas.width - 60);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Portique au-dessus de la route à l'abscisse `s`, avec une banderole lisible des deux côtés. */
function buildArch(layout: WorldLayout, edge: Edge, s: number, text: string): THREE.Group {
  const g = new THREE.Group();
  const navy = new THREE.MeshStandardNodeMaterial({ color: PALETTE.gantry, roughness: 0.6 });
  const span = ROAD_HALF + 0.9;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.6, 0.4).translate(0, 2.8, 0), navy);
    post.position.x = side * span;
    post.castShadow = true;
    g.add(post);
  }
  const tex = bannerTexture(text);
  const face = tex ? new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.7 }) : navy;
  const width = 2 * span + 0.6;
  const banner = new THREE.Mesh(new THREE.BoxGeometry(width, width / 8, 0.25), [navy, navy, navy, navy, face, face]);
  banner.position.y = 5.6 - width / 16;
  banner.castShadow = true;
  g.add(banner);

  const p = edge.pointAt(s);
  const h = edge.headingAt(s);
  const y = layout.y(edge.altitudeAt(s));
  g.position.set(p.x, y, p.z);
  g.lookAt(p.x + Math.cos(h), y, p.z + Math.sin(h));
  return g;
}

function buildArches(layout: WorldLayout): THREE.Group {
  const g = new THREE.Group();
  for (const l of layout.network.landmarks) {
    if (l.kind === 'arch') g.add(buildArch(layout, layout.network.edges.get(l.edge)!, l.s, l.text));
  }
  return g;
}

/* ---------- Lacs ---------- */

/** Maille de la surface d'un lac, en m. */
const WATER_CELL_M = 10;
/** La surface déborde de la rive de cette distance : son bord se perd dans la berge, en m. */
const WATER_OVERLAP_M = 12;
/** Distance à la rive à laquelle l'eau prend sa couleur du large, en m. */
const WATER_DEEP_M = 45;

/**
 * Eau d'un lac : claire près de la rive, sombre au large, teintée par le ciel aux angles rasants, avec deux trains de
 * vaguelettes qui se croisent pour accrocher le soleil.
 */
function waterMaterial(tones: Tones): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.2, metalness: 0 });
  const base = mix(color(PALETTE.waterShallow), color(PALETTE.waterDeep), attribute('depth', 'float'));
  // La surface est horizontale : l'angle du regard se lit sur sa seule composante verticale.
  const facing = normalize(cameraPosition.sub(positionWorld)).y.max(0);
  mat.colorNode = mix(base, tones.horizon, pow(float(1).sub(facing), 3).mul(0.6)) as unknown as NonNullable<THREE.MeshStandardNodeMaterial['colorNode']>;
  const p = positionWorld;
  const dx = sin(p.x.mul(0.31).add(p.z.mul(0.17)).add(time.mul(1.1))).mul(0.045).add(sin(p.x.mul(-0.83).add(p.z.mul(0.49)).add(time.mul(1.7))).mul(0.03));
  const dz = sin(p.z.mul(0.27).sub(p.x.mul(0.21)).add(time.mul(0.9))).mul(0.045).add(sin(p.z.mul(0.91).add(p.x.mul(0.37)).add(time.mul(1.5))).mul(0.03));
  mat.normalNode = transformNormalToView(normalize(vec3(dx, 1, dz))) as unknown as NonNullable<THREE.MeshStandardNodeMaterial['normalNode']>;
  return mat;
}

/**
 * Surface des lacs : une grille plane au niveau de chaque lac, réduite aux mailles qui touchent l'eau. Elle suit la
 * même rive que le terrain (`WorldLayout.waterAt`) et la déborde un peu, pour que son bord soit pris dans la berge.
 */
function buildWater(layout: WorldLayout, tones: Tones): THREE.Group {
  const out = new THREE.Group();
  const hit: WaterHit = { sd: Infinity, level: 0, beach: 0 };
  const mat = waterMaterial(tones);
  for (const lake of layout.lakes) {
    const x0 = Math.min(...lake.shore.map((q) => q[0])) - 3 * WATER_CELL_M;
    const z0 = Math.min(...lake.shore.map((q) => q[1])) - 3 * WATER_CELL_M;
    const nx = Math.ceil((Math.max(...lake.shore.map((q) => q[0])) + 3 * WATER_CELL_M - x0) / WATER_CELL_M);
    const nz = Math.ceil((Math.max(...lake.shore.map((q) => q[1])) + 3 * WATER_CELL_M - z0) / WATER_CELL_M);
    const cols = nx + 1;
    const sd = new Float32Array(cols * (nz + 1));
    for (let b = 0; b <= nz; b++) for (let a = 0; a <= nx; a++) sd[b * cols + a] = layout.waterAt(x0 + a * WATER_CELL_M, z0 + b * WATER_CELL_M, hit).sd;

    const y = layout.y(lake.level);
    const slot = new Int32Array(cols * (nz + 1)).fill(-1);
    const pos: number[] = [];
    const depth: number[] = [];
    const idx: number[] = [];
    const vertex = (a: number, b: number) => {
      const k = b * cols + a;
      if (slot[k]! < 0) {
        slot[k] = pos.length / 3;
        pos.push(x0 + a * WATER_CELL_M, y, z0 + b * WATER_CELL_M);
        depth.push(Math.min(1, Math.max(0, -sd[k]! / WATER_DEEP_M)));
      }
      return slot[k]!;
    };
    for (let b = 0; b < nz; b++) {
      for (let a = 0; a < nx; a++) {
        const k = b * cols + a;
        if (Math.min(sd[k]!, sd[k + 1]!, sd[k + cols]!, sd[k + cols + 1]!) > WATER_OVERLAP_M) continue;
        const v00 = vertex(a, b);
        const v10 = vertex(a + 1, b);
        const v01 = vertex(a, b + 1);
        const v11 = vertex(a + 1, b + 1);
        idx.push(v00, v01, v10, v10, v01, v11); // faces vers le haut
      }
    }
    if (!idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

/* ---------- Horizon : montagnes, nuages et ciel ---------- */

/** Exposant du dégradé du ciel : plus il est petit, plus le bleu du zénith descend vers l'horizon. */
const SKY_CURVE = 0.5;
/** Finesse du semis d'étoiles : cases du ciel par rayon (une étoile occupe une case). */
const STAR_GRID = 420;
/** Axe du grand cercle de la Voie lactée. */
const MILKY_WAY = new THREE.Vector3(0.35, 0.45, 0.82).normalize();
/** Cosinus du rayon apparent du disque du soleil (2,2°, plus gros que le vrai : style des maquettes). */
const SUN_DISC_COS = Math.cos((2.2 * Math.PI) / 180);
/** Portée des ombres portées autour de la caméra, en m. */
const SHADOW_RANGE_M = 80;
/**
 * Rayon du pied des montagnes dans la direction `a` (rad), depuis le centre du réseau : un rectangle arrondi qui suit
 * la boîte du réseau à `FAR_MARGIN_M` près. Un cercle laisserait les montagnes deux fois plus loin sur les petits côtés.
 */
function horizonRadius(layout: WorldLayout, a: number): number {
  const b = layout.bounds;
  const hx = (b.maxX - b.minX) / 2 + FAR_MARGIN_M + 150;
  const hz = (b.maxZ - b.minZ) / 2 + FAR_MARGIN_M + 150;
  return Math.pow(Math.pow(Math.abs(Math.cos(a)) / hx, 4) + Math.pow(Math.abs(Math.sin(a)) / hz, 4), -0.25);
}

/** Dérive des nuages autour du centre du réseau, en rad/s : 8 m/s à 3 km du centre. */
const CLOUD_DRIFT_RAD_S = 0.0027;
/** Profondeur de la chaîne, du pied aux derniers sommets, en m. */
const MOUNTAIN_DEPTH_M = 3200;
/** Altitude de la limite des neiges sur la chaîne, en m. */
const SNOW_LINE_M = 880;

/**
 * Chaîne de montagnes autour du réseau, à facettes nettes, en deux plans : des contreforts boisés, puis des sommets
 * découpés et enneigés. Elle ferme l'horizon que le relief proche (qui retombe à plat à `FAR_MARGIN_M` des routes)
 * laisserait plat.
 */
function buildMountains(layout: WorldLayout, segments: number): THREE.Mesh {
  const { x: cx, z: cz } = layout.center;
  const rings = 26;
  const pos = new Float32Array(segments * (rings + 1) * 3);
  const col = new Float32Array(segments * (rings + 1) * 3);
  const c = new THREE.Color();
  const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.pow(Math.sin((Math.PI * (t - a)) / (b - a)), 1.4));
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const r0 = horizonRadius(layout, a);
    // Grands massifs (basse fréquence) découpés en sommets et en cols (haute fréquence, en crêtes).
    const massif = 620 + 900 * smoothstep(-0.5, 0.4, fbm(ca * 2.2 + 7, sa * 2.2 + 3, 4));
    const crest = 0.55 + 0.65 * Math.pow(1 - Math.abs(fbm(ca * 9 + 2, sa * 9 + 5, 2)), 2);
    const peak = massif * crest;
    const foot = 230 + 190 * (0.5 + 0.5 * fbm(ca * 5 + 1, sa * 5 + 9, 3));
    // La ligne de crête n'est pas un cercle : elle avance et recule d'un massif à l'autre.
    const crestAt = 0.26 + 0.1 * fbm(ca * 3 + 11, sa * 3 + 4, 2);
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const r = r0 + MOUNTAIN_DEPTH_M * t;
      const x = cx + r * ca;
      const z = cz + r * sa;
      const detail = 0.82 + 0.36 * fbm(x * 0.004, z * 0.004, 3);
      const h = (foot * bump(t, -0.05, 0.46) + peak * bump(t, crestAt, 1)) * detail;
      const k = (i * (rings + 1) + j) * 3;
      pos[k] = x;
      pos[k + 1] = h - 2;
      pos[k + 2] = z;
      const snowLine = SNOW_LINE_M + 90 * valueNoise(x * 0.004, z * 0.004);
      c.copy(PALETTE.mountainGrass).lerp(PALETTE.forestFloor, 0.75 * forestCover(x, z) * (1 - smoothstep(280, 520, h)));
      c.lerp(PALETTE.mountainRock, smoothstep(0.42 * snowLine, 0.8 * snowLine, h));
      c.lerp(PALETTE.snow, smoothstep(snowLine - 40, snowLine + 40, h));
      col.set([c.r, c.g, c.b], k);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    const i2 = (i + 1) % segments;
    for (let j = 0; j < rings; j++) {
      const a = i * (rings + 1) + j;
      const b = i2 * (rings + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1); // normales vers le haut
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(faceted(g), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1 }));
  m.receiveShadow = false;
  m.frustumCulled = false;
  return m;
}

/**
 * Nuages : grappes de boules lisses aplaties. `count` nuages moyens au-dessus du pays, et moitié autant de gros cumulus
 * posés derrière les montagnes, bas sur l'horizon. Ils ne reçoivent ni la lumière de la scène (le vert du sol les
 * teintait) ni la brume (elle effacerait ceux de l'horizon) : blancs dessus, gris-bleu dessous, d'après leur orientation.
 */
function buildClouds(layout: WorldLayout, count: number, tones: Tones): THREE.InstancedMesh {
  const rand = mulberry32(99);
  const puffs: [number, number, number, number][] = [
    [0, 0, 0, 1],
    [1.15, -0.15, 0.2, 0.8],
    [-1.1, -0.2, -0.1, 0.75],
    [0.4, 0.45, -0.3, 0.7],
    [-0.45, 0.3, 0.45, 0.6],
  ];
  const geo = merge(puffs.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 3).translate(x, y, z)));
  geo.scale(1, 0.62, 0.8);
  const mat = new THREE.MeshBasicNodeMaterial({ fog: false });
  mat.colorNode = mix(tones.cloudUnder, tones.cloudTop, tslSmoothstep(-0.55, 0.45, normalWorld.y)) as unknown as NonNullable<THREE.MeshBasicNodeMaterial['colorNode']>;
  const far = Math.round(count / 2);
  const clouds = new THREE.InstancedMesh(geo, mat, count + far);
  clouds.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const top = layout.y(layout.edges.reduce((m, e) => Math.max(m, e.to.altitude, e.from.altitude), 0));
  for (let i = 0; i < count + far; i++) {
    const a = rand() * Math.PI * 2;
    const horizon = i >= count;
    // Les cumulus de l'horizon sont derrière la ligne de crête : ils dépassent des cols et des sommets bas.
    const r = horizon ? horizonRadius(layout, a) + 2600 + rand() * 2800 : layout.radius * (0.1 + rand() * 1.6);
    const size = horizon ? 220 + rand() * 260 : 40 + rand() * 50;
    const y = horizon ? 750 + rand() * 650 : top + 180 + rand() * 260;
    dummy.position.set(r * Math.cos(a), y, r * Math.sin(a));
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(size, size * (horizon ? 0.6 + rand() * 0.25 : 0.8 + rand() * 0.4), size);
    dummy.updateMatrix();
    clouds.setMatrixAt(i, dummy.matrix);
  }
  // Les positions sont comptées depuis le centre du réseau : tourner l'ensemble fait dériver les nuages.
  clouds.position.set(layout.center.x, 0, layout.center.z);
  return clouds;
}

/**
 * Ciel calculé par pixel : dégradé de l'horizon au zénith, lueur large vers le soleil et disque du soleil. Ses
 * couleurs et la direction du soleil viennent de l'ambiance (`tones`).
 */
function buildSky(tones: Tones): THREE.Mesh {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  const dir = normalize(positionLocal);
  const base = mix(tones.horizon, tones.zenith, pow(dir.y.max(0), SKY_CURVE));
  const toSun = dir.dot(tones.sunDirection).max(0);
  const halo = pow(toSun, 5).mul(tones.haloWide).add(pow(toSun, 90).mul(tones.haloTight));
  const disc = tslSmoothstep(SUN_DISC_COS, SUN_DISC_COS + 0.0003, toSun);
  // De nuit (`tones.stars`) : des étoiles, une sur trois cents cases de ciel environ, qui scintillent, et la bande
  // pâle de la Voie lactée en travers du ciel. Rien sous l'horizon.
  const cell = floor(dir.mul(STAR_GRID));
  const h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const twinkle = float(0.65).add(sin(time.mul(2.3).add(h.mul(90))).mul(0.35));
  const star = tslSmoothstep(0.9968, 0.9995, h).mul(twinkle);
  // Une bande douce, plus dense par endroits le long du grand cercle (variation lente : pas de taches).
  const band = exp(dot(dir, vec3(MILKY_WAY.x, MILKY_WAY.y, MILKY_WAY.z)).pow(2).mul(-34)).mul(float(0.7).add(sin(dot(dir, vec3(3.1, 1.3, -2.2)).mul(4)).mul(0.3)));
  const night = vec3(0.8, 0.85, 1).mul(star.mul(1.6).add(band.mul(0.1))).mul(tones.stars).mul(tslSmoothstep(0, 0.12, dir.y));
  mat.colorNode = base.add(tones.glow.mul(halo.add(disc.mul(2.5)))).add(night) as unknown as NonNullable<THREE.MeshBasicNodeMaterial['colorNode']>;
  const m = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 16), mat);
  m.renderOrder = -1;
  return m;
}

export function buildWorld(layout: WorldLayout, scene: THREE.Scene, opts: WorldOptions = WORLD_HIGH, assets?: RiderAssets): World {
  return drain(buildWorldSteps(layout, scene, opts, assets));
}

/**
 * `buildWorld` par étapes, un élément du monde à la fois (et le relief lointain, la route, par morceaux) : à dérouler
 * avec `Background.run` pour ne pas bloquer la page. Rien n'est ajouté à `scene` avant la dernière étape.
 */
export function* buildWorldSteps(layout: WorldLayout, scene: THREE.Scene, opts: WorldOptions = WORLD_HIGH, assets?: RiderAssets): Steps<World> {
  const group = new THREE.Group();
  const tones = createTones(DAY);
  const clouds = buildClouds(layout, opts.clouds, tones);
  yield;
  const terrain = yield* Terrain.build(layout, opts.terrainRadiusM);
  const places = yield* buildPlaces(layout);
  yield;
  const skyRoad = buildSkyRoad(layout, tones);
  yield;
  const decor = new Decor(layout, opts.decor, opts.decorRadiusM, SHADOW_RANGE_M, [...places.clearings, ...skyRoad.clearings]);
  yield;
  const road = yield* buildRoad(layout);
  yield;
  const fence = buildFence(layout);
  yield;
  const arches = buildArches(layout);
  yield;
  const mountains = buildMountains(layout, opts.mountainSegments);
  yield;
  group.add(terrain.group, road, decor.group, fence, arches, mountains, clouds);

  // Sol de fond sous tout : une grille de cellules de 100 m, posée sous le relief lointain (qui ne descend jamais sous zéro).
  const size = 2 * (layout.radius + FAR_MARGIN_M + 4000);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size, Math.round(size / 100), Math.round(size / 100)).rotateX(-Math.PI / 2),
    new THREE.MeshStandardNodeMaterial({ color: PALETTE.grassDark, roughness: 1 }),
  );
  plane.position.set(layout.center.x, -3, layout.center.z);
  plane.receiveShadow = true;
  const water = buildWater(layout, tones);
  yield;
  const roadside = yield* buildRoadside(layout);
  yield;
  group.add(plane, water, places.group, roadside, skyRoad.group);

  // Soleil et ciel à parts presque égales : les faces à l'ombre restent colorées, comme sur les maquettes.
  const sun = new SunLight(DAY.sunColor, DAY.sunIntensity);
  sun.position.copy(DAY.sunDirection);
  sun.castShadow = true;
  sun.shadow.mapSize.set(opts.shadowMapSize, opts.shadowMapSize);
  // Ombres portées sur 80 m seulement : la première cascade s'arrête vers 22 m, ce qui garde l'ombre du cycliste
  // (au centre de l'écran) nette. Plus loin, les arbres tiennent au sol par leur ombre de contact (`decor.ts`).
  sun.shadow.camera.far = SHADOW_RANGE_M;
  const fill = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiIntensity);

  const sky = buildSky(tones);
  const backdrop = DAY.horizon.clone();
  scene.background = backdrop;
  // Brume de la couleur de l'horizon : elle bleuit les plans lointains, qui se fondent dans le bas du ciel.
  const fog = new THREE.FogExp2(DAY.horizon.getHex(), DAY.fogDensity);
  scene.fog = fog;
  const marieSpot = layout.network.landmarks.find((l) => l.kind === 'marie');
  const marie =
    assets && marieSpot ? buildMarie(layout, assets, layout.network.edges.get(marieSpot.edge)!, marieSpot.s) : undefined;
  if (marie) group.add(marie.group);
  const richardSpot = layout.network.landmarks.find((l) => l.kind === 'richard');
  const richard =
    assets && richardSpot ? buildRichard(layout, assets, layout.network.edges.get(richardSpot.edge)!, richardSpot.s) : undefined;
  if (richard) group.add(richard.group);

  scene.add(group, sky, sun, fill);
  let lastRider: { x: number; z: number } | undefined;
  let filling = false;
  let rideSpeed = 0;
  let cabinY: number | undefined;
  return {
    group,
    sky,
    sun,
    setAmbiance(a) {
      tones.apply(a);
      sun.color.set(a.sunColor);
      sun.intensity = a.sunIntensity;
      sun.position.copy(a.sunDirection);
      fill.color.set(a.hemiSky);
      fill.groundColor.set(a.hemiGround);
      fill.intensity = a.hemiIntensity;
      fog.color.copy(a.horizon);
      fog.density = a.fogDensity;
      backdrop.copy(a.horizon);
    },
    prime(x, z) {
      terrain.prime(x, z);
      decor.prime(x, z);
    },
    *primeSteps(x, z, nearOnly = false) {
      yield* terrain.primeSteps(x, z, nearOnly ? NEAR_TERRAIN_M : Infinity);
      yield* decor.primeSteps(x, z, nearOnly ? NEAR_DECOR_M : Infinity);
    },
    *fillSteps(x, z) {
      filling = true;
      try {
        yield* terrain.primeSteps(x, z);
        yield* decor.primeSteps(x, z);
      } finally {
        filling = false;
      }
    },
    update(dtS, rider) {
      if (rider) lastRider = { x: rider.x, z: rider.z };
      if (rider && !filling) {
        terrain.update(rider.x, rider.z);
        decor.update(rider.x, rider.z);
      }
      marie?.update(dtS, rider);
      richard?.update(dtS, rider);
      clouds.rotation.y += dtS * CLOUD_DRIFT_RAD_S;
      places.update(dtS);
      skyRoad.update(dtS, rideSpeed, cabinY);
    },
    setVelodromeLaps: (n) => places.setVelodromeLaps(n),
    setRide(speedMs, y) {
      rideSpeed = speedMs;
      cabinY = y;
    },
    stats: () => ({ chunks: terrain.chunkCount, decorInstances: decor.instanceCount, coarseNearRoad: lastRider ? terrain.coarseNear(lastRider.x, lastRider.z, 300) : 0 }),
  };
}
