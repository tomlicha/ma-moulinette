import * as THREE from 'three/webgpu';
import type { Steps } from './background';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bends, ramps } from '../sim/road-features';
import { sign } from './places';
import { forwardOf, ROAD_HALF, sideOf, type WorldLayout } from './world-layout';

/**
 * Le mobilier du bord de route : des piquets réguliers qui donnent la vitesse à l'œil, une borne à chaque kilomètre,
 * à chaque carrefour un poteau qui nomme les routes qui en partent, un panneau de pente au pied de chaque rampe et un
 * parapet de pierre à l'extérieur des virages serrés.
 */

/** Écart entre deux piquets, et entre deux bornes, en m. */
const POST_EVERY_M = 50;
const STONE_EVERY_M = 1000;
/** Rien dans la zone d'un carrefour, en m depuis le nœud. */
const JUNCTION_CLEAR_M = 22;
/** Distance du poteau indicateur au centre du carrefour, en m. */
const SIGNPOST_M = 16.5;
/** Distance des piquets à l'axe de la route, en m. */
const POST_LAT_M = ROAD_HALF + 1.5;

/** Parapet : distance à l'axe, pas entre deux blocs le long de l'axe, et débord avant et après le virage, en m. */
const WALL_LAT_M = ROAD_HALF + 1.7;
const WALL_STEP_M = 2.4;
const WALL_LEAD_M = 20;
/** Panneau de pente : distance à l'axe, en m. */
const GRADE_SIGN_LAT_M = ROAD_HALF + 2.6;

const COLORS = {
  post: 0xf4f4f0,
  band: 0x20242c,
  stone: 0xf1efe6,
  cap: 0xf2c230,
  pole: 0x6e7480,
  panel: 0x1f3a5f,
  grade: 0x9c3b2a,
  wall: 0xcbc4b4,
  coping: 0xe8e2d4,
};

/** Fond des formes colorées en une seule géométrie : la couleur est portée par les sommets. */
function colored(parts: [THREE.BufferGeometry, number][]): THREE.BufferGeometry {
  return mergeGeometries(
    parts.map(([geo, hex]) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      g.deleteAttribute('uv');
      const c = new THREE.Color(hex);
      const n = g.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    }),
  )!;
}

function lot(geo: THREE.BufferGeometry, count: number, shadows: boolean): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8 }), Math.max(1, count));
  m.castShadow = shadows;
  m.receiveShadow = true;
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

/** Un tronçon de parapet : de `from` à `to` sur la route, du côté `side` (+1 à gauche dans le sens de la route). */
interface Wall {
  from: number;
  to: number;
  side: 1 | -1;
}

/** Le bord des routes par étapes, une route (ou un carrefour) à la fois. */
export function* buildRoadside(layout: WorldLayout): Steps<THREE.Group> {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  // La piste d'un vélodrome n'a ni piquets, ni bornes, ni parapets : elle a son mur.
  const edges = layout.edges.filter((e) => e.def.surface !== 'track');
  /** La route `e` passe-t-elle dans un vélodrome en `s` (sa rampe d'accès) ? On n'y pose rien. */
  const inVelodrome = (e: (typeof edges)[number], s: number) => {
    const p = e.pointAt(s);
    return layout.underVelodrome(p.x, p.z);
  };

  // Parapets : à l'extérieur de chaque virage serré, là où l'on sortirait de la route. Une route qui tourne à droite a
  // son extérieur à gauche.
  const walls = new Map<string, Wall[]>();
  for (const e of edges) {
    walls.set(
      e.id,
      bends(e)
        .map((b): Wall => ({
          from: Math.max(JUNCTION_CLEAR_M, b.from - WALL_LEAD_M),
          to: Math.min(e.lengthM - JUNCTION_CLEAR_M, b.to + WALL_LEAD_M),
          side: b.turn,
        }))
        .filter((w) => w.to > w.from),
    );
  }
  const walled = (id: string, s: number, side: number) => walls.get(id)!.some((w) => w.side === side && s >= w.from - 2 && s <= w.to + 2);

  // Piquets blancs à bande sombre, des deux côtés.
  const postGeo = colored([
    [new THREE.BoxGeometry(0.12, 1.0, 0.06).translate(0, 0.5, 0), COLORS.post],
    [new THREE.BoxGeometry(0.125, 0.16, 0.065).translate(0, 0.74, 0), COLORS.band],
  ]);
  // Borne kilométrique : un corps blanc, une tête jaune arrondie.
  const stoneGeo = colored([
    [new THREE.BoxGeometry(0.5, 0.5, 0.3).translate(0, 0.25, 0), COLORS.stone],
    [new THREE.CylinderGeometry(0.25, 0.25, 0.3, 10, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 0.5, 0), COLORS.cap],
  ]);
  const posts = lot(postGeo, edges.reduce((n, e) => n + 2 * (Math.floor(e.lengthM / POST_EVERY_M) + 1), 0), false);
  const stones = lot(stoneGeo, edges.reduce((n, e) => n + Math.floor(e.lengthM / STONE_EVERY_M) + 1, 0), true);
  const put = (mesh: THREE.InstancedMesh, e: (typeof edges)[number], s: number, lat: number) => {
    if (inVelodrome(e, s)) return;
    const p = e.pointAt(s);
    const h = e.headingAt(s);
    const side = sideOf(h);
    dummy.position.set(p.x + side.x * lat, layout.y(e.altitudeAt(s)) - 0.04, p.z + side.z * lat);
    dummy.rotation.set(0, Math.PI / 2 - h, 0); // la face large regarde le long de la route
    dummy.updateMatrix();
    mesh.setMatrixAt(mesh.count++, dummy.matrix);
  };
  for (const e of edges) {
    yield;
    for (let s = JUNCTION_CLEAR_M; s <= e.lengthM - JUNCTION_CLEAR_M; s += POST_EVERY_M) {
      // Le parapet remplace le piquet de son côté.
      if (!walled(e.id, s, 1)) put(posts, e, s, POST_LAT_M);
      if (!walled(e.id, s, -1)) put(posts, e, s, -POST_LAT_M);
    }
    for (let s = STONE_EVERY_M; s <= e.lengthM - JUNCTION_CLEAR_M; s += STONE_EVERY_M) put(stones, e, s + 12, -(ROAD_HALF + 2.1));
  }
  group.add(posts, stones);

  // Blocs du parapet : une pierre taillée et son couronnement plus clair, posés bout à bout avec un jour entre deux.
  const blockGeo = colored([
    [new THREE.BoxGeometry(2.05, 0.74, 0.46).translate(0, 0.25, 0), COLORS.wall],
    [new THREE.BoxGeometry(2.15, 0.12, 0.56).translate(0, 0.68, 0), COLORS.coping],
  ]);
  const blockCount = [...walls.values()].reduce((n, list) => n + list.reduce((k, w) => k + Math.floor((w.to - w.from) / WALL_STEP_M) + 1, 0), 0);
  const blocks = lot(blockGeo, blockCount, true);
  const shade = new THREE.Color();
  for (const e of edges) {
    yield;
    for (const w of walls.get(e.id)!) {
      for (let s = w.from; s <= w.to; s += WALL_STEP_M) {
        const p = e.pointAt(s);
        const h = e.headingAt(s);
        const side = sideOf(h);
        const x = p.x + side.x * w.side * WALL_LAT_M;
        const z = p.z + side.z * w.side * WALL_LAT_M;
        // Posé sur le sol, sans jamais flotter au-dessus de la chaussée ni s'y enfoncer de plus d'une demi-hauteur.
        const road = layout.y(e.altitudeAt(s));
        dummy.position.set(x, Math.min(road, Math.max(road - 0.3, layout.groundY(x, z))) - 0.06, z);
        dummy.rotation.set(0, -h, 0); // le long du bloc suit la route
        dummy.updateMatrix();
        const k = blocks.count++;
        blocks.setMatrixAt(k, dummy.matrix);
        // Chaque pierre a sa teinte : le mur ne se lit pas comme une bande unie.
        blocks.setColorAt(k, shade.setScalar(0.88 + 0.14 * (((k * 2654435761) >>> 0) / 4294967296)));
      }
    }
  }
  if (blocks.count) group.add(blocks);

  const pole = new THREE.MeshStandardNodeMaterial({ color: COLORS.pole, roughness: 0.6 });

  // Panneaux de pente : au pied de chaque rampe, à droite de celui qui monte. Le panneau donne la pente moyenne réelle
  // (celle que sent le home-trainer) et la longueur de la rampe.
  for (const e of edges) {
    yield;
    for (const r of ramps(e)) {
      const up = r.gradePct > 0;
      const s = Math.min(Math.max(up ? r.from : r.to, JUNCTION_CLEAR_M + 6), e.lengthM - JUNCTION_CLEAR_M - 6);
      const p = e.pointAt(s);
      const h = e.headingAt(s);
      const side = sideOf(h);
      const lat = (up ? -1 : 1) * GRADE_SIGN_LAT_M; // `sideOf` pointe à gauche de la route
      const x = p.x + side.x * lat;
      const z = p.z + side.z * lat;
      const y = layout.y(e.altitudeAt(s));
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.84, 8).translate(0, 0.92, 0), pole);
      mast.position.set(x, y - 0.1, z);
      mast.castShadow = true;
      const km = ((r.to - r.from) / 1000).toFixed(1).replace('.', ',');
      const panel = sign([`${Math.round(Math.abs(r.gradePct))} %`, `sur ${km} km`], 1.5, 1.15, COLORS.grade);
      panel.position.set(x, y + 2.3, z);
      panel.rotation.y = Math.PI / 2 - h; // face à la route, lisible dans les deux sens
      group.add(mast, panel);
    }
  }

  // Poteaux indicateurs : dans le plus grand angle libre du carrefour, une flèche par route.
  for (const node of layout.network.nodes.values()) {
    yield;
    if (layout.underVelodrome(node.x, node.z)) continue;
    // Ni dans le ciel, ni au pied d'un ascenseur : la plateforme y tient lieu de carrefour.
    if (layout.skyNodes.has(node.id) || layout.network.incident(node.id).some((e) => e.isLift)) continue;
    const ways = layout.network.incident(node.id).map((e) => ({ e, h: e.from.id === node.id ? e.headingAt(0) : e.headingAt(e.lengthM) + Math.PI }));
    if (ways.length < 2) continue;
    const sorted = ways.map((w) => ((w.h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
    let bearing = 0;
    let widest = -1;
    sorted.forEach((a, i) => {
      const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 2 * Math.PI;
      if (next - a > widest) {
        widest = next - a;
        bearing = a + (next - a) / 2;
      }
    });
    const f = forwardOf(bearing);
    const x = node.x + f.x * SIGNPOST_M;
    const z = node.z + f.z * SIGNPOST_M;
    const y = layout.y(node.altitude);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 8).translate(0, 1.8, 0), pole);
    mast.position.set(x, y - 0.1, z);
    mast.castShadow = true;
    group.add(mast);
    ways.forEach((w, k) => {
      const km = (w.e.lengthM / 1000).toFixed(1).replace('.', ',');
      const panel = sign([w.e.name.toUpperCase(), `${km} km`], 2.5, 0.72, COLORS.panel);
      const d = forwardOf(w.h);
      panel.position.set(x + d.x * 1.35, y + 3.1 - 0.8 * k, z + d.z * 1.35);
      panel.rotation.y = -w.h; // le long du panneau pointe vers sa route
      group.add(panel);
    });
  }
  return group;
}
