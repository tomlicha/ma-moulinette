import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sign } from './places';
import { forwardOf, ROAD_HALF, sideOf, type WorldLayout } from './world-layout';

/**
 * Le mobilier du bord de route : des piquets réguliers qui donnent la vitesse à l'œil, une borne à chaque kilomètre,
 * et à chaque carrefour un poteau qui nomme les routes qui en partent.
 */

/** Écart entre deux piquets, et entre deux bornes, en m. */
const POST_EVERY_M = 50;
const STONE_EVERY_M = 1000;
/** Rien dans la zone d'un carrefour, en m depuis le nœud. */
const JUNCTION_CLEAR_M = 22;
/** Distance du poteau indicateur au centre du carrefour, en m. */
const SIGNPOST_M = 16.5;

const COLORS = { post: 0xf4f4f0, band: 0x20242c, stone: 0xf1efe6, cap: 0xf2c230, pole: 0x6e7480, panel: 0x1f3a5f };

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

export function buildRoadside(layout: WorldLayout): THREE.Group {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();

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
  const edges = layout.edges;
  const posts = lot(postGeo, edges.reduce((n, e) => n + 2 * (Math.floor(e.lengthM / POST_EVERY_M) + 1), 0), false);
  const stones = lot(stoneGeo, edges.reduce((n, e) => n + Math.floor(e.lengthM / STONE_EVERY_M) + 1, 0), true);
  const put = (mesh: THREE.InstancedMesh, e: (typeof edges)[number], s: number, lat: number) => {
    const p = e.pointAt(s);
    const h = e.headingAt(s);
    const side = sideOf(h);
    dummy.position.set(p.x + side.x * lat, layout.y(e.altitudeAt(s)) - 0.04, p.z + side.z * lat);
    dummy.rotation.set(0, Math.PI / 2 - h, 0); // la face large regarde le long de la route
    dummy.updateMatrix();
    mesh.setMatrixAt(mesh.count++, dummy.matrix);
  };
  for (const e of edges) {
    for (let s = JUNCTION_CLEAR_M; s <= e.lengthM - JUNCTION_CLEAR_M; s += POST_EVERY_M) {
      put(posts, e, s, ROAD_HALF + 1.5);
      put(posts, e, s, -(ROAD_HALF + 1.5));
    }
    for (let s = STONE_EVERY_M; s <= e.lengthM - JUNCTION_CLEAR_M; s += STONE_EVERY_M) put(stones, e, s + 12, -(ROAD_HALF + 2.1));
  }
  group.add(posts, stones);

  // Poteaux indicateurs : dans le plus grand angle libre du carrefour, une flèche par route.
  const pole = new THREE.MeshStandardNodeMaterial({ color: COLORS.pole, roughness: 0.6 });
  for (const node of layout.network.nodes.values()) {
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
