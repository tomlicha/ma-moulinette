import * as THREE from 'three/webgpu';
import { lumpy } from './geometry-utils';
import { mulberry32 } from './noise';
import { Kit, sign } from './places';
import { buildFestivities } from './velodrome-fete';
import { ACCESS_M, bermEnd, FINISH_S, GATE_A, RAMP_W, rampHeight, U_MEASURING, U_TOP, U_TRACK, VELODROME, VelodromeTrack } from '../sim/velodrome-track';

/**
 * Le vélodrome André-Pétrieux de Roubaix, en formes simples à facettes : la piste en béton relevée dans les virages,
 * sa bande bleue et ses lignes (mesure, sprinteurs, stayers), la ligne d'arrivée devant la tribune couverte à façade
 * Art déco, les gradins découverts de la ligne droite opposée, les talus d'herbe des virages, la pelouse de rugby,
 * la porte par laquelle les coureurs entrent sur la piste, les douches, les mâts d'éclairage et les peupliers du parc.
 * La fête d'un jour d'arrivée (public, drapeaux, podium…) est dans `velodrome-fete.ts`.
 *
 * Repère local du vélodrome (voir `VelodromeTrack`) : origine au centre de la pelouse, au niveau de la pelouse.
 */

export interface Velodrome {
  group: THREE.Group;
  track: VelodromeTrack;
  /** Ligne d'arrivée, en m le long de la ligne de mesure. */
  finishS: number;
  /** Porte d'entrée des coureurs : là où la rampe touche le haut de la piste (`s`), et le début de la route d'accès. */
  gate: { s: number; road: { x: number; z: number } };
  /** Anime ce qui ne tourne pas dans la carte graphique : hélicoptère, cloche, écran géant. */
  update(dtS: number): void;
  /** Tours bouclés par le joueur (tableau au bord de la piste, écran géant, cloche). */
  setLaps(n: number): void;
}

const C = {
  track: 0xc9c5bb,
  blue: 0x4d9ad6,
  apron: 0xdcd8ce,
  black: 0x1e2026,
  red: 0xd23b30,
  stayer: 0x2f5fc4,
  white: 0xf5f3ee,
  wall: 0xefebe2,
  wallCap: 0x2b3a55,
  walkway: 0xbdb8ad,
  bank: 0x6aa84a,
  infield: 0x64a646,
  stripe: 0x77b852,
  brick: 0xa5553b,
  brickDark: 0x84412f,
  deco: 0xecdfc6,
  roof: 0xc3c8ce, // clair : le dessous n'est éclairé que par le sol
  bench: 0x3a5f96,
  terrace: [0xbab5aa, 0xc7c2b7],
  steel: 0x8e959e,
  glass: 0x9ccbe6,
  door: 0x3d3a3a,
  lamp: 0xfff4c8,
  asphalt: 0x6e7488,
  plaza: 0xcfcac0,
  pad: 0x2f5fc4,
  poplar: [0x5b9a42, 0x6aa84d, 0x4f8f3e],
  tree: [0x78c452, 0x63ad48, 0x8cc65a],
  trunk: 0x8a5c36,
};

type V = [number, number, number];

/** Bande de quadrilatères : `rows[i][j]`, rangées le long du tracé, colonnes en travers. */
function ribbon(rows: V[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const r0 = rows[i]!;
    const r1 = rows[i + 1]!;
    for (let j = 0; j + 1 < r0.length; j++) pos.push(...r0[j]!, ...r0[j + 1]!, ...r1[j]!, ...r0[j + 1]!, ...r1[j + 1]!, ...r1[j]!);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/**
 * Normales adoucies : un sommet prend la moyenne des faces voisines qui ne s'écartent pas de la sienne de plus de
 * `creaseDeg`. Le sol du vélodrome (maillage à facettes, deux triangles par bande) montrait sinon une bande d'ombrage
 * à chaque pas du maillage ; les vraies arêtes (piste relevée contre la bordure plate, talus) restent nettes.
 */
function softenNormals(g: THREE.BufferGeometry, creaseDeg: number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const tris = pos.count / 3;
  const face = new Float32Array(tris * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1).sub(a);
    c.fromBufferAttribute(pos, t * 3 + 2).sub(a);
    b.cross(c); // longueur = 2 × aire : les grandes faces pèsent plus
    face.set([b.x, b.y, b.z], t * 3);
  }
  const key = (i: number) => `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
  const at = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const kk = key(i);
    const list = at.get(kk);
    if (list) list.push((i / 3) | 0);
    else at.set(kk, [(i / 3) | 0]);
  }
  const cos = Math.cos((creaseDeg * Math.PI) / 180);
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const own = (i / 3) | 0;
    const ol = Math.hypot(face[own * 3]!, face[own * 3 + 1]!, face[own * 3 + 2]!) || 1;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const t of at.get(key(i))!) {
      const tl = Math.hypot(face[t * 3]!, face[t * 3 + 1]!, face[t * 3 + 2]!) || 1;
      const d = (face[t * 3]! * face[own * 3]! + face[t * 3 + 1]! * face[own * 3 + 1]! + face[t * 3 + 2]! * face[own * 3 + 2]!) / (tl * ol);
      if (d >= cos) {
        x += face[t * 3]!;
        y += face[t * 3 + 1]!;
        z += face[t * 3 + 2]!;
      }
    }
    const l = Math.hypot(x, y, z) || 1;
    out.set([x / l, y / l, z / l], i * 3);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

/** Pas du maillage de la piste, de son mur et de ses traits peints, en m. */
const LAP_STEP_M = 0.5;

/** Abscisses de `a` à `b` par pas d'au plus `step`, extrémités comprises. */
function span(a: number, b: number, step: number): number[] {
  const n = Math.max(1, Math.ceil((b - a) / step));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

/** Repère d'une ligne droite à `s` : place un `Kit` dont x suit la piste et z part vers l'extérieur. */
function straightFrame(track: VelodromeTrack, s: number) {
  const f = track.frame(s);
  const o = track.point(s, 0);
  const yaw = Math.atan2(-f.dirZ, f.dirX);
  return {
    yaw,
    origin: o,
    /** Position monde d'un point local. */
    at: (x: number, y: number, z: number) => new THREE.Vector3(o.x + f.dirX * x + f.outX * z, y, o.z + f.dirZ * x + f.outZ * z),
  };
}

export function buildVelodrome(): Velodrome {
  const track = new VelodromeTrack();
  const L = track.lapM;
  const k = new Kit();
  // Surfaces au sol (piste, pelouse, talus, rampe) : elles reçoivent les ombres sans en projeter. Projetées, elles
  // s'ombrent elles-mêmes en moiré avec les biais d'ombre du monde.
  const flat = new Kit();
  const group = new THREE.Group();
  const rand = mulberry32(1936);
  const P = (s: number, u: number, y = track.height(s, u)): V => {
    const p = track.point(s, u);
    return [p.x, y, p.z];
  };
  // Pas du maillage le long de la piste : à 2 m, le cap change de 2,7° d'une bande à l'autre dans les virages (rayon de
  // 43 m) et les traits peints, vus de près, montrent des cassures ; à 0,5 m elles disparaissent (0,7°).
  const lap = span(0, L, LAP_STEP_M);

  // --- Piste : bande bleue, béton, lignes peintes -------------------------------------------------------------------
  flat.add(ribbon(lap.map((s) => [P(s, 0), P(s, U_TRACK)])), C.blue);
  flat.add(ribbon(lap.map((s) => [P(s, U_TRACK), P(s, U_TOP)])), C.track);
  const paint = (u: number, w: number, color: number) =>
    flat.add(ribbon(lap.map((s) => [P(s, u - w / 2, track.height(s, u - w / 2) + 0.015), P(s, u + w / 2, track.height(s, u + w / 2) + 0.015)])), color);
  paint(U_MEASURING, 0.05, C.black); // ligne de mesure, 20 cm au-dessus du bord intérieur
  paint(U_TRACK + 0.85, 0.05, C.red); // ligne des sprinteurs
  paint(U_MEASURING + 2.45, 0.05, C.stayer); // ligne des stayers

  // Bordure intérieure en béton clair, puis la pelouse.
  const APRON = 2.5;
  flat.add(ribbon(lap.map((s) => [P(s, -APRON, 0), P(s, 0, 0)])), C.apron);
  {
    const pos: number[] = [];
    for (let i = 0; i + 1 < lap.length; i++) pos.push(0, 0, 0, ...P(lap[i]!, -APRON, 0), ...P(lap[i + 1]!, -APRON, 0));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    flat.add(g, C.infield);
  }

  // Ligne d'arrivée devant la tribune : bande blanche, trait noir au milieu.
  const finishS = FINISH_S;
  const across = span(0, U_TOP, 0.5);
  const band = (w: number, lift: number, color: number) =>
    flat.add(ribbon([finishS - w / 2, finishS + w / 2].map((s) => across.map((u) => P(s, u, track.height(s, u) + lift)))), color);
  band(0.72, 0.02, C.white);
  band(0.06, 0.03, C.black);

  // --- Mur, coursive, talus ----------------------------------------------------------------------------------------
  // Porte des coureurs sur la ligne droite opposée, à 22 m avant son milieu.
  const sBack = L / 2;
  const gateA = GATE_A;
  // Porte perpendiculaire à la piste : on entre comme on sort, par un virage à droite.
  const PHI = Math.PI / 2;
  const topStraight = track.height(sBack, U_TOP);
  const gapFrom = sBack + gateA - RAMP_W / 2 / Math.sin(PHI) - (bermEnd(topStraight) - U_TOP) / Math.tan(PHI) - 0.5;
  const gapTo = sBack + gateA + RAMP_W / 2 / Math.sin(PHI) + 0.5;

  /** Coupe du bord extérieur, de la piste vers le dehors : (u, hauteur) et la couleur de chaque pan. */
  const profile = (s: number): { pts: [number, number][]; colors: number[] } => {
    const top = track.height(s, U_TOP);
    return {
      pts: [
        [U_TOP, top],
        [U_TOP, top + 1.1],
        [U_TOP + 0.25, top + 1.1],
        [U_TOP + 0.25, top + 0.2],
        [9.5, top + 0.2],
        [bermEnd(top), 0],
        [bermEnd(top) + 1.6, -0.4], // sous le sol aplani, qui passe un peu sous le modèle
      ],
      colors: [C.wall, C.wallCap, C.wall, C.walkway, C.bank, C.bank],
    };
  };
  const ring = span(gapTo, gapFrom + L, LAP_STEP_M);
  const profiles = ring.map((s) => profile(s).pts.map(([u, y]) => P(s, u, y)));
  // Le mur projette son ombre sur la piste ; la coursive et le talus, non.
  profile(0).colors.forEach((color, j) => (j < 3 ? k : flat).add(ribbon(profiles.map((row) => [row[j]!, row[j + 1]!])), color));
  // Bouts du talus de part et d'autre de la porte, et flanc de la piste dans l'ouverture.
  for (const [s, flip] of [[gapFrom, false], [gapTo, true]] as const) {
    const pts = profile(s).pts.map(([u, y]) => P(s, u, y));
    const base = P(s, U_TOP, 0);
    const pos: number[] = [];
    for (let j = 0; j + 1 < pts.length; j++) pos.push(...base, ...(flip ? pts[j + 1]! : pts[j]!), ...(flip ? pts[j]! : pts[j + 1]!));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    k.add(g, C.walkway);
  }
  k.add(ribbon(span(gapFrom, gapTo, 2).map((s) => [P(s, U_TOP), P(s, U_TOP, 0)])), C.walkway);

  // Rampe et route d'accès, en enrobé : à plat dehors, elle monte au niveau du haut de la piste en arrivant.
  const back = straightFrame(track, sBack);
  const ROAD_B = ACCESS_M;
  const rampRows: V[][] = [];
  for (let i = 0; i <= 24; i++) {
    const row: V[] = [];
    for (const o of [-RAMP_W / 2, RAMP_W / 2]) {
      const t0 = (U_TOP + o * Math.cos(PHI) - ROAD_B) / Math.sin(PHI);
      const t1 = (o * Math.cos(PHI)) / Math.sin(PHI);
      const t = t0 + ((t1 - t0) * i) / 24;
      const a = gateA + o * Math.sin(PHI) + t * Math.cos(PHI);
      const b = U_TOP + o * Math.cos(PHI) - t * Math.sin(PHI);
      const lift = rampHeight(track, b);
      const p = back.at(a, 0, b);
      row.push([p.x, lift, p.z]);
    }
    rampRows.push(row);
  }
  flat.add(ribbon(rampRows), C.asphalt);
  for (const j of [0, 1]) k.add(ribbon(rampRows.map((r) => [r[j]!, [r[j]![0], -0.4, r[j]![2]]])), C.walkway);
  const roadStart = rampRows[0]!;
  // Piliers de la porte.
  for (const s of [gapFrom, gapTo]) {
    const p = track.point(s, U_TOP + 0.12);
    k.box(0.7, track.height(s, U_TOP) + 2.6, 0.7, p.x, 0, p.z, C.brick, back.yaw);
    k.box(0.9, 0.25, 0.9, p.x, track.height(s, U_TOP) + 2.6, p.z, C.deco, back.yaw);
  }

  // --- Tribune couverte, ligne droite d'arrivée --------------------------------------------------------------------
  const home = straightFrame(track, 0);
  const stand = new Kit();
  const ROWS = 14;
  const STAND_L = 80;
  stand.box(STAND_L, 1.9, 0.3, 0, 0, 9.65, C.wall);
  for (let i = 0; i < ROWS; i++) {
    const z = 9.8 + i * 0.8;
    const top = 1.6 + i * 0.42;
    stand.box(STAND_L, top, 0.8, 0, 0, z + 0.4, C.terrace[i % 2]!);
    stand.box(STAND_L, 0.42, 0.34, 0, top, z + 0.5, C.bench);
  }
  const zBack = 9.8 + ROWS * 0.8;
  stand.box(STAND_L + 1, 13.2, 0.6, 0, 0, zBack + 0.3, C.brick);
  stand.box(STAND_L, 12.4, 0.1, 0, 0, zBack - 0.05, C.wall); // enduit clair côté gradins
  // Toit en pente vers la piste, sur poteaux.
  const roofDrop = 1.6;
  const roofDepth = zBack + 0.6 - 8.6;
  const roof = new THREE.BoxGeometry(STAND_L + 2, 0.35, Math.hypot(roofDepth, roofDrop)).rotateX(-Math.atan2(roofDrop, roofDepth));
  stand.add(roof, C.roof, 0, 11.4 + roofDrop / 2 + 0.1, 8.6 + roofDepth / 2);
  stand.box(STAND_L + 2, 0.9, 0.25, 0, 10.6, 8.5, C.wallCap);
  for (let x = -STAND_L / 2 + 6; x <= STAND_L / 2 - 6; x += (STAND_L - 12) / 5) stand.box(0.32, 11.4, 0.32, x, 0, 9.65, C.white);
  for (const sx of [-1, 1]) stand.box(0.5, 11.4, zBack - 9.8, sx * (STAND_L / 2 + 0.25), 0, (zBack + 9.8) / 2, C.wall);
  // Façade Art déco côté ville : brique, bandeaux et pilastres clairs, pavillon d'entrée à gradins.
  const zF = zBack + 0.6;
  stand.box(STAND_L + 2, 0.7, 0.9, 0, 13.2, zF - 0.3, C.deco);
  for (const y of [3.6, 9.4]) stand.box(STAND_L + 1.2, 0.45, 0.3, 0, y, zF + 0.1, C.deco);
  for (let x = -STAND_L / 2; x <= STAND_L / 2; x += 10) stand.box(0.9, 13.2, 0.5, x, 0, zF + 0.2, C.deco);
  for (let x = -35; x <= 35; x += 10) {
    if (Math.abs(x) < 8) continue;
    stand.box(3.4, 1.7, 0.1, x, 1.1, zF + 0.06, C.glass);
    stand.box(3.4, 2.4, 0.1, x, 5.6, zF + 0.06, C.glass);
  }
  const zP = zF + 1.5;
  stand.box(14, 16, 3, 0, 0, zP, C.brick);
  stand.box(10, 1.3, 3.2, 0, 16, zP, C.deco);
  stand.box(5, 1.3, 3.4, 0, 17.3, zP, C.brick);
  for (const x of [-5.6, -2, 2, 5.6]) stand.box(0.6, 4.4, 0.4, x, 5.6, zP + 1.6, C.deco);
  stand.box(12, 0.5, 0.5, 0, 10.2, zP + 1.6, C.deco);
  stand.box(6.4, 4.2, 0.12, 0, 0, zP + 1.52, C.door);
  stand.box(6.4, 1.1, 0.12, 0, 4.3, zP + 1.52, C.glass);
  // Les douches, derrière la tribune : un bâtiment bas de brique.
  const dX = 56;
  const dZ = zF + 16;
  stand.box(18, 3.8, 8, dX, 0, dZ, C.brickDark);
  stand.box(19, 0.4, 9, dX, 3.8, dZ, C.deco);
  stand.box(1.4, 2.3, 0.1, dX, 0, dZ - 4.03, C.door);
  for (const x of [-7, -4.5, 4.5, 7]) stand.box(1.4, 0.55, 0.1, x + dX, 2.7, dZ - 4.03, C.glass);
  // Parvis.
  stand.box(150, 0.06, 26, 10, 0, zF + 12, C.plaza);
  k.place(stand, home.origin.x, 0, home.origin.z, home.yaw);

  const signAt = (lines: string[], w: number, h: number, bg: number, x: number, y: number, z: number) => {
    const m = sign(lines, w, h, bg);
    m.position.copy(home.at(x, y, z));
    m.rotation.y = home.yaw;
    group.add(m);
  };
  signAt(['VÉLODROME ANDRÉ-PÉTRIEUX'], 26, 0.8, C.wallCap, 0, 11.05, 8.33);
  signAt(['VÉLODROME', 'ANDRÉ-PÉTRIEUX'], 10, 3.4, C.wallCap, 0, 12.6, zP + 1.62);
  signAt(['DOUCHES'], 3.6, 0.9, C.wallCap, dX, 2.75, dZ - 4.1);

  // Cabine des juges, à l'intérieur, face à la ligne.
  const judge = straightFrame(track, finishS);
  const booth = new Kit();
  for (const sx of [-1.1, 1.1]) for (const sz of [-1.1, 1.1]) booth.box(0.16, 2.4, 0.16, sx, 0, sz, C.steel);
  booth.box(2.6, 2.2, 2.6, 0, 2.4, 0, C.white).box(3, 0.2, 3, 0, 4.6, 0, C.wallCap).box(2.2, 0.9, 0.1, 0, 3.3, 1.31, C.glass);
  const boothAt = judge.at(0, 0, -APRON - 3);
  k.place(booth, boothAt.x, 0, boothAt.z, judge.yaw);

  // --- Gradins découverts, ligne droite opposée, après la porte --------------------------------------------------
  const terr = new Kit();
  const T_ROWS = 9;
  const tX = 16;
  const tL = 48;
  terr.box(tL, 1.6, 0.3, tX, 0, 9.65, C.wall);
  for (let i = 0; i < T_ROWS; i++) {
    const top = 1.3 + i * 0.36;
    terr.box(tL, top, 0.8, tX, 0, 9.8 + i * 0.8 + 0.4, C.terrace[i % 2]!);
    if (i % 3 === 2) {
      terr.box(tL, 0.07, 0.07, tX, top + 1.0, 9.8 + i * 0.8 + 0.1, C.steel);
      for (let x = tX - tL / 2 + 2; x <= tX + tL / 2 - 2; x += 4) terr.box(0.07, 1.0, 0.07, x, top, 9.8 + i * 0.8 + 0.1, C.steel);
    }
  }
  terr.box(tL, 1.3 + T_ROWS * 0.36 + 1.1, 0.3, tX, 0, 9.8 + T_ROWS * 0.8 + 0.15, C.wall);
  k.place(terr, back.origin.x, 0, back.origin.z, back.yaw);

  // --- Pelouse de rugby ------------------------------------------------------------------------------------------
  const inside = (x: number, z: number) => {
    // La pelouse est convexe : on compare au bord intérieur le plus proche en angle.
    const a = Math.atan2(z, x);
    let best = Infinity;
    let r = 0;
    for (let s = 0; s < L; s += 1) {
      const p = track.point(s, -APRON);
      const d = Math.abs(Math.atan2(Math.sin(Math.atan2(p.z, p.x) - a), Math.cos(Math.atan2(p.z, p.x) - a)));
      if (d < best) {
        best = d;
        r = Math.hypot(p.x, p.z);
      }
    }
    return Math.hypot(x, z) < r - 2;
  };
  let pitchW = 70;
  while (!inside(0, pitchW / 2) && pitchW > 40) pitchW -= 2;
  let pitchL = 120;
  while (!(inside(pitchL / 2, pitchW / 2) && inside(-pitchL / 2, -pitchW / 2)) && pitchL > 60) pitchL -= 2;
  const ingoal = Math.min(10, (pitchL - 94) / 2);
  const tryX = pitchL / 2 - ingoal;
  for (let i = 0; i < 12; i += 2) {
    const w = (2 * tryX) / 12;
    flat.box(w, 0.02, pitchW + 6, -tryX + w * (i + 0.5), 0, 0, C.stripe);
  }
  const lineW = 0.12;
  const line = (x: number, z: number, w: number, d: number) => flat.box(w, 0.03, d, x, 0.01, z, C.white);
  for (const sz of [-1, 1]) line(0, (sz * pitchW) / 2, pitchL, lineW);
  for (const x of [-pitchL / 2, -tryX, tryX, pitchL / 2, 0]) line(x, 0, lineW, pitchW);
  for (const x of [-tryX + 22, tryX - 22]) line(x, 0, lineW, pitchW);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.box(0.2, 9, 0.2, sx * tryX, 0, sz * 2.8, C.white);
      k.box(0.7, 1.6, 0.7, sx * tryX, 0, sz * 2.8, C.pad);
    }
    k.box(0.15, 0.15, 5.6, sx * tryX, 3, 0, C.white);
  }

  // --- Mâts d'éclairage, aux quatre coins ---------------------------------------------------------------------
  const { straightM: S, transitionM: T } = VELODROME;
  const S_HALF = S / 2;
  for (const s of [S / 2 + 14, S / 2 + 2 * T + track.arcM - 14, L / 2 + S / 2 + 14, L / 2 + S / 2 + 2 * T + track.arcM - 14]) {
    const p = track.point(s, 21);
    k.add(new THREE.CylinderGeometry(0.3, 0.7, 26, 4, 1), C.steel, p.x, 13, p.z, Math.PI / 4);
    const head = new Kit();
    head.add(new THREE.BoxGeometry(5.2, 3, 0.4).rotateX(-0.35), C.wallCap, 0, 0, 0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) head.add(new THREE.BoxGeometry(1.2, 0.9, 0.1).translate(-1.6 + i * 1.6, -0.6 + j * 1.2, 0.25).rotateX(-0.35), C.lamp);
    k.place(head, p.x, 26.5, p.z, Math.atan2(-p.x, -p.z));
  }

  // --- La fête : public, drapeaux, podium, écran, pavés… (velodrome-fete.ts) -----------------------------------------
  const screenS = S_HALF + VELODROME.transitionM + track.arcM / 2;
  const parking = { x0: -5, x1: 45, z0: 22, z1: 46 };
  const sinP = Math.sin(PHI);
  const cosP = Math.cos(PHI);
  const bf = track.frame(sBack);
  const roadDX = bf.dirX * cosP - bf.outX * sinP;
  const roadDZ = bf.dirZ * cosP - bf.outZ * sinP;
  const fete = buildFestivities({
    track,
    finishS,
    apron: APRON,
    home,
    back,
    finish: judge,
    stand: { rows: ROWS, length: STAND_L, rowZ: (i) => 9.8 + i * 0.8, rowTop: (i) => 1.6 + i * 0.42, facadeZ: zF, roofY: 11.4 },
    terraces: { rows: T_ROWS, x: tX, length: tL, rowZ: (i) => 9.8 + i * 0.8, rowTop: (i) => 1.3 + i * 0.36 },
    road: {
      at: (b, o) => back.at(gateA + o * sinP + ((U_TOP + o * cosP - b) / sinP) * cosP, 0, b),
      yaw: Math.atan2(-roadDZ, roadDX),
      halfWidth: RAMP_W / 2,
      cobblesFrom: 26,
      cobblesTo: ROAD_B - 2,
    },
    gate: { from: gapFrom, to: gapTo },
    screenS,
    parking,
    bends: [
      [S_HALF + 4, gapFrom - 1],
      [gapTo + 1, sBack + tX - tL / 2 - 1],
      [sBack + tX + tL / 2 + 1, L - STAND_L / 2 - 2],
    ],
  });
  group.add(fete.group);

  // --- Arbres du parc : peupliers d'Italie et feuillus ----------------------------------------------------------
  /** Distance à l'axe de la route d'accès, et position dans le repère de la ligne droite opposée. */
  const clearOf = (x: number, z: number) => {
    const a = (x - back.origin.x) * bf.dirX + (z - back.origin.z) * bf.dirZ;
    const b = (x - back.origin.x) * bf.outX + (z - back.origin.z) * bf.outZ;
    const road = b > U_TOP - 2 && b < ROAD_B + 6 && Math.abs((a - gateA) * sinP + (b - U_TOP) * cosP) < 11;
    const lot = a > parking.x0 - 6 && a < parking.x1 + 6 && b > parking.z0 - 4 && b < parking.z1 + 4;
    return !road && !lot;
  };
  for (let s = 0; s < L; s += 7) {
    if (s < 62 || s > L - 62) continue; // parvis de la tribune
    if (Math.abs(s - screenS) < 18) continue; // écran géant
    for (const [u0, du, keep] of [[26, 10, 0.85], [42, 18, 0.5]] as const) {
      if (rand() > keep) continue;
      const p = track.point(s + rand() * 5, u0 + rand() * du);
      if (!clearOf(p.x, p.z)) continue;
      if (rand() < 0.6) {
        const h = 13 + rand() * 6;
        k.add(lumpy(new THREE.ConeGeometry(1.7 + rand() * 0.6, h, 6, 2), 0.08, Math.floor(rand() * 1e6)), C.poplar[Math.floor(rand() * 3)]!, p.x, 1.4 + h / 2, p.z, rand() * 3);
        k.box(0.4, 1.6, 0.4, p.x, 0, p.z, C.trunk);
      } else {
        const r = 2.8 + rand() * 1.6;
        k.add(lumpy(new THREE.IcosahedronGeometry(r, 0), 0.15, Math.floor(rand() * 1e6)), C.tree[Math.floor(rand() * 3)]!, p.x, 2.6 + r, p.z, rand() * 3);
        k.box(0.5, 3, 0.5, p.x, 0, p.z, C.trunk);
      }
    }
  }
  // Une rangée de platanes au bord du parvis.
  for (let x = -60; x <= 75; x += 12) {
    const p = home.at(x, 0, zF + 26);
    k.add(lumpy(new THREE.IcosahedronGeometry(3.4, 0), 0.15, x + 500), C.tree[1]!, p.x, 6.2, p.z, x);
    k.box(0.5, 3.4, 0.5, p.x, 0, p.z, C.trunk);
  }

  const mesh = k.mesh();
  const mat = mesh.material as THREE.Material;
  mat.side = THREE.DoubleSide;
  // Dans la carte d'ombre, les faces arrière des volumes : pas d'acné sur leurs faces éclairées.
  mat.shadowSide = THREE.BackSide;
  const ground = flat.mesh();
  softenNormals(ground.geometry, 5);
  (ground.material as THREE.Material).side = THREE.DoubleSide;
  ground.castShadow = false;
  group.add(mesh, ground);
  return {
    group,
    track,
    finishS,
    gate: { s: sBack + gateA, road: { x: roadStart[0]![0] / 2 + roadStart[1]![0] / 2, z: roadStart[0]![2] / 2 + roadStart[1]![2] / 2 } },
    update: fete.update,
    setLaps: fete.setLaps,
  };
}
