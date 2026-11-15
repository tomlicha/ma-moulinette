import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { NodeDef } from '../sim/network';
import { lumpy } from './geometry-utils';
import { mulberry32 } from './noise';
import { ROAD_HALF, type RoadHit, type WaterHit, type WorldLayout } from './world-layout';

/**
 * Les lieux du monde : ce qu'on trouve à chaque carrefour nommé (`NodeDef.place`). Un village et son clocher, un moulin
 * dont les ailes tournent, le panneau et le refuge du col, la table d'orientation du belvédère, les pontons des lacs.
 * Tout est fait de formes simples à facettes, fondues en un maillage par lieu.
 */

export interface Places {
  group: THREE.Group;
  /** Fait tourner les ailes du moulin. */
  update(dtS: number): void;
  /** Disques (x, z, rayon) où le décor ne plante rien : l'emprise des bâtiments. */
  clearings: { x: number; z: number; r: number }[];
}

const COLORS = {
  walls: [0xf2e9d8, 0xe9d7b5, 0xf5f0e6, 0xe3c9a0],
  roofs: [0xb5503c, 0xa8452f, 0x8a4a3a, 0x6f7480],
  stone: 0xb9b4aa,
  slate: 0x5f6672,
  wood: 0xb08552,
  darkWood: 0x6e5236,
  door: 0x5a4030,
  glass: 0x9ccbe6,
  snow: 0xf4f7fa,
  hay: 0xe2c76a,
  hull: [0xd9483b, 0x3b82d6, 0xf2c230],
  sign: 0x7a4a2b,
};

/** Profondeur des fondations : un bâtiment posé sur une pente ne montre pas de jour dessous, en m. */
const FOUNDATION_M = 2.5;

/** Accumule des formes colorées dans le repère d'un objet, puis les fond en un seul maillage à facettes. */
class Kit {
  private readonly parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, yaw = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    if (yaw) g.rotateY(yaw);
    g.translate(x, y, z);
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, yaw = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, yaw);
  }

  /** Toit à deux pans : `w` de large, `h` de haut, faîtage le long de z sur `len`, posé à la hauteur `y`. */
  gable(w: number, h: number, len: number, x: number, y: number, z: number, color: number): this {
    const g = new THREE.CylinderGeometry(1, 1, len, 3, 1).rotateX(-Math.PI / 2).scale(w / 1.732, h / 1.5, 1).translate(0, h / 3, 0);
    return this.add(g, color, x, y, z);
  }

  /** Verse le contenu de `other`, tourné de `yaw` et déplacé : pour poser un bâtiment dans un lieu. */
  place(other: Kit, x: number, y: number, z: number, yaw: number): this {
    for (const g of other.parts) this.parts.push(g.rotateY(yaw).translate(x, y, z));
    return this;
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  mesh(): THREE.Mesh {
    const g = mergeGeometries(this.parts)!;
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9 }));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

/** Maison : murs, toit à deux pans, porte et fenêtres en façade (côté +z), cheminée. */
function house(rand: () => number, w = 6 + rand() * 3, d = 7 + rand() * 4, h = 3.2 + rand() * 1.6): Kit {
  const wall = COLORS.walls[Math.floor(rand() * COLORS.walls.length)]!;
  const roof = COLORS.roofs[Math.floor(rand() * COLORS.roofs.length)]!;
  const k = new Kit();
  k.box(w, h + FOUNDATION_M, d, 0, -FOUNDATION_M, 0, wall);
  k.gable(w + 0.8, 2.2 + rand() * 1.2, d + 0.8, 0, h, 0, roof);
  k.box(1.1, 2.1, 0.12, (rand() - 0.5) * (w - 3), 0, d / 2 + 0.03, COLORS.door);
  for (const sx of [-1, 1]) k.box(1, 1, 0.1, sx * (w / 2 - 1.1), 1.2, d / 2 + 0.03, COLORS.glass);
  for (const sz of [-0.25, 0.25]) for (const sx of [-1, 1]) k.box(0.1, 1, 1, sx * (w / 2 + 0.03), 1.2, sz * d, COLORS.glass);
  k.box(0.7, 1.6, 0.7, w * 0.22, h + 1.1, -d * 0.2, COLORS.stone);
  return k;
}

/** Église : une nef, un clocher carré en façade et sa flèche. */
function church(): Kit {
  const k = new Kit();
  k.box(8, 7 + FOUNDATION_M, 17, 0, -FOUNDATION_M, 0, COLORS.walls[2]!);
  k.gable(8.8, 4, 17.8, 0, 7, 0, COLORS.slate);
  k.box(4.6, 15 + FOUNDATION_M, 4.6, 0, -FOUNDATION_M, 9.5, COLORS.walls[2]!);
  k.add(new THREE.ConeGeometry(3.6, 7.5, 4, 1).rotateY(Math.PI / 4), COLORS.slate, 0, 15 + 3.75, 9.5);
  k.box(1.6, 2.8, 0.12, 0, 0, 11.83, COLORS.door);
  k.box(1.1, 1.8, 0.12, 0, 9.5, 11.83, COLORS.glass);
  for (const sx of [-1, 1]) for (const sz of [-5, 0, 5]) k.box(0.12, 3, 1.1, sx * 4.03, 2, sz - 1.5, COLORS.glass);
  return k;
}

/** Moulin à vent : une tour à huit pans et son toit. Les ailes sont à part, pour tourner. */
function windmill(): { tower: Kit; sails: THREE.Mesh } {
  const tower = new Kit();
  tower.add(new THREE.CylinderGeometry(2.3, 3.5, 11 + FOUNDATION_M, 8, 1), COLORS.walls[0]!, 0, (11 - FOUNDATION_M) / 2, 0);
  tower.add(new THREE.ConeGeometry(3, 3.2, 8, 1), COLORS.roofs[1]!, 0, 11 + 1.6, 0);
  tower.box(1.1, 2.1, 0.2, 0, 0, 3.35, COLORS.door);
  tower.box(0.9, 0.9, 0.2, 0, 6, 2.75, COLORS.glass);
  const s = new Kit();
  s.add(new THREE.CylinderGeometry(0.35, 0.35, 1.2, 8).rotateX(Math.PI / 2), COLORS.darkWood);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.BoxGeometry(0.22, 8.2, 0.16).translate(0, 4.4, 0.45).rotateZ((i * Math.PI) / 2);
    const cloth = new THREE.BoxGeometry(1.5, 6.2, 0.06).translate(0.86, 5.2, 0.45).rotateZ((i * Math.PI) / 2);
    s.add(arm, COLORS.darkWood).add(cloth, COLORS.walls[2]!);
  }
  return { tower, sails: s.mesh() };
}

/** Meule de foin. */
const haystack = (k: Kit, x: number, y: number, z: number) => k.add(new THREE.CylinderGeometry(1.5, 1.7, 1.6, 9).rotateZ(Math.PI / 2), COLORS.hay, x, y + 1.6, z, 0.4);

/** Banc : une assise et un dossier sur deux pieds. */
function bench(k: Kit, x: number, y: number, z: number, yaw: number) {
  const b = new Kit();
  b.box(1.9, 0.08, 0.5, 0, 0.45, 0, COLORS.wood).box(1.9, 0.5, 0.08, 0, 0.55, -0.25, COLORS.wood);
  for (const sx of [-0.8, 0.8]) b.box(0.1, 0.45 + 0.6, 0.45, sx, -0.6, 0, COLORS.darkWood);
  k.place(b, x, y, z, yaw);
}

/** Panneau à texte : fond uni, lettres blanches, lisible des deux côtés. */
export function sign(lines: string[], w: number, h: number, bg: number): THREE.Mesh {
  const mat = new THREE.MeshStandardNodeMaterial({ color: bg, roughness: 0.7 });
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = Math.round((512 * h) / w);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `#${new THREE.Color(bg).getHexString()}`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const size = Math.min((canvas.height * (i === 0 ? 0.42 : 0.3)) / Math.max(1, lines.length - 0.6), 96);
      ctx.font = `700 ${size}px "Barlow Condensed", "Arial Narrow", "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(line, canvas.width / 2, (canvas.height * (i + 0.5)) / lines.length + (lines.length > 1 ? (i === 0 ? 8 : -8) : 0), canvas.width - 50);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    mat.map = tex;
    mat.color.set(0xffffff);
  }
  const plain = new THREE.MeshStandardNodeMaterial({ color: bg, roughness: 0.7 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), [plain, plain, plain, plain, mat, mat]);
  m.castShadow = true;
  return m;
}

interface Site {
  x: number;
  z: number;
  y: number;
  /** Cap de la façade : vers le carrefour. */
  yaw: number;
}

/**
 * Emplacements autour d'un carrefour : `n` positions tirées au sort entre `min` et `max` m du nœud, à l'écart des
 * routes, de l'eau, des pentes et les unes des autres. Le même tirage à chaque chargement.
 */
function sites(layout: WorldLayout, node: NodeDef, n: number, min: number, max: number, gap: number, rand: () => number, taken: Site[] = []): Site[] {
  const hit: RoadHit = { dist: Infinity, alt: 0, edge: -1, s: 0 };
  const water: WaterHit = { sd: Infinity, level: 0 };
  const out: Site[] = [];
  for (let tries = 0; tries < 400 && out.length < n; tries++) {
    const a = rand() * Math.PI * 2;
    const r = min + rand() * (max - min);
    const x = node.x + r * Math.cos(a);
    const z = node.z + r * Math.sin(a);
    if (layout.nearestRoad(x, z, hit).dist < ROAD_HALF + gap * 0.6 + 4) continue;
    if (layout.waterAt(x, z, water).sd < gap) continue;
    if ([...out, ...taken].some((s) => Math.hypot(s.x - x, s.z - z) < gap)) continue;
    const y = layout.groundY(x, z);
    if (Math.abs(layout.groundY(x + 5, z) - y) > 1.4 || Math.abs(layout.groundY(x, z + 5) - y) > 1.4) continue;
    out.push({ x, z, y, yaw: Math.atan2(node.x - x, node.z - z) });
  }
  return out;
}

/** Le point de rive le plus proche du nœud et la direction du large, ou rien s'il n'y a pas d'eau à 220 m. */
function shoreNear(layout: WorldLayout, node: NodeDef): { x: number; z: number; dirX: number; dirZ: number; level: number } | undefined {
  const water: WaterHit = { sd: Infinity, level: 0 };
  let best: { x: number; z: number; dirX: number; dirZ: number; level: number; r: number } | undefined;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    for (let r = 20; r <= 220; r += 4) {
      const x = node.x + r * Math.cos(a);
      const z = node.z + r * Math.sin(a);
      if (layout.waterAt(x, z, water).sd < 1) {
        if (!best || r < best.r) best = { x, z, dirX: Math.cos(a), dirZ: Math.sin(a), level: water.level, r };
        break;
      }
    }
  }
  return best;
}

/** Ponton sur pilotis qui s'avance dans le lac depuis la rive, avec ses barques. */
function jetty(layout: WorldLayout, node: NodeDef, boats: number, rand: () => number): THREE.Mesh | undefined {
  const shore = shoreNear(layout, node);
  if (!shore) return undefined;
  const k = new Kit();
  const deck = layout.y(shore.level) + 0.55;
  const len = 16;
  const yaw = Math.atan2(shore.dirX, shore.dirZ);
  const p = new Kit();
  p.box(2.4, 0.18, len + 6, 0, 0, len / 2 - 3, COLORS.wood);
  for (let s = -4; s <= len; s += 4) for (const sx of [-1.1, 1.1]) p.box(0.22, 3.2, 0.22, sx, -2.6, s, COLORS.darkWood);
  for (let b = 0; b < boats; b++) {
    const hull = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.85, 0.6, 2.3);
    const side = b % 2 ? 1 : -1;
    const at = len - 3 - Math.floor(b / 2) * 6;
    const tilt = (rand() - 0.5) * 0.5;
    const boat = new Kit().add(hull, COLORS.hull[b % COLORS.hull.length]!).box(1.3, 0.08, 0.35, 0, -0.18, 0.3, COLORS.wood).box(1.2, 0.08, 0.35, 0, -0.18, -0.9, COLORS.wood);
    p.place(boat, side * 2.6, -0.42, at, tilt);
  }
  k.place(p, shore.x, deck, shore.z, yaw);
  return k.mesh();
}

export function buildPlaces(layout: WorldLayout): Places {
  const group = new THREE.Group();
  const clearings: Places['clearings'] = [];
  const spinning: THREE.Mesh[] = [];
  const clear = (list: Site[], r: number) => list.forEach((s) => clearings.push({ x: s.x, z: s.z, r }));

  for (const node of layout.network.nodes.values()) {
    if (!node.place) continue;
    const rand = mulberry32(Math.imul(Math.round(node.x) + 977, 2654435761) ^ Math.round(node.z));
    const k = new Kit();

    if (node.place === 'village') {
      const [spot] = sites(layout, node, 1, 45, 80, 26, rand);
      if (spot) {
        k.place(church(), spot.x, spot.y, spot.z, spot.yaw);
        clear([spot], 17);
      }
      const homes = sites(layout, node, 11, 24, 125, 15, rand, spot ? [spot, spot] : []);
      homes.forEach((s) => k.place(house(rand), s.x, s.y, s.z, s.yaw));
      clear(homes, 11);
    } else if (node.place === 'mill') {
      const [spot] = sites(layout, node, 1, 30, 55, 18, rand);
      if (spot) {
        const mill = windmill();
        k.place(mill.tower, spot.x, spot.y, spot.z, spot.yaw);
        mill.sails.position.set(spot.x + Math.sin(spot.yaw) * 3.1, spot.y + 10.2, spot.z + Math.cos(spot.yaw) * 3.1);
        mill.sails.rotation.y = spot.yaw;
        spinning.push(mill.sails);
        group.add(mill.sails);
        clear([spot], 14);
      }
      const farm = sites(layout, node, 2, 40, 90, 16, rand, spot ? [spot] : []);
      farm.forEach((s) => k.place(house(rand), s.x, s.y, s.z, s.yaw));
      clear(farm, 11);
      sites(layout, node, 5, 30, 110, 7, rand, [...farm, ...(spot ? [spot] : [])]).forEach((s) => haystack(k, s.x, s.y, s.z));
    } else if (node.place === 'summit') {
      const [hut] = sites(layout, node, 1, 28, 50, 14, rand);
      if (hut) {
        const refuge = new Kit();
        refuge.box(7, 3 + FOUNDATION_M, 5.5, 0, -FOUNDATION_M, 0, COLORS.stone);
        refuge.gable(7.8, 2.2, 6.3, 0, 3, 0, COLORS.slate);
        refuge.box(1, 2, 0.12, -1.6, 0, 2.78, COLORS.door).box(1, 0.9, 0.1, 1.5, 1.2, 2.78, COLORS.glass);
        k.place(refuge, hut.x, hut.y, hut.z, hut.yaw);
        clear([hut], 10);
      }
      // Cairns et névés autour du col.
      sites(layout, node, 4, 16, 70, 9, rand, hut ? [hut] : []).forEach((s) => {
        for (let i = 0; i < 4; i++) k.add(lumpy(new THREE.IcosahedronGeometry(0.75 - i * 0.15, 0), 0.2, 3 + i), COLORS.stone, s.x, s.y + 0.4 + i * 0.62, s.z);
      });
      sites(layout, node, 9, 20, 150, 12, rand).forEach((s) => {
        const patch = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.18, 21).scale(5 + rand() * 6, 0.35, 4 + rand() * 5);
        k.add(patch, COLORS.snow, s.x, s.y + 0.05, s.z, rand() * Math.PI);
      });
      // Panneau du col, au bord de la route.
      const [post] = sites(layout, node, 1, 14, 20, 3, rand);
      if (post) {
        const panel = sign(['COL DES ÉRABLES', `${Math.round(node.altitude)} m`], 4.6, 1.7, COLORS.sign);
        panel.position.set(post.x, post.y + 2.4, post.z);
        panel.rotation.y = post.yaw;
        group.add(panel);
        const legs = new Kit();
        for (const sx of [-1.9, 1.9]) legs.box(0.16, 3.3 + 1, 0.16, sx, -1, -0.1, COLORS.darkWood);
        k.place(legs, post.x, post.y, post.z, post.yaw);
      }
    } else if (node.place === 'viewpoint') {
      const [spot] = sites(layout, node, 1, 16, 30, 8, rand);
      if (spot) {
        const t = new Kit();
        t.add(new THREE.CylinderGeometry(0.75, 0.95, 1 + 1, 8), COLORS.stone, 0, 0, 0);
        t.add(new THREE.CylinderGeometry(1.15, 1.15, 0.12, 12).rotateX(0.28), COLORS.slate, 0, 1.12, 0);
        // Garde-corps en arc, du côté opposé au carrefour.
        for (let i = -3; i <= 3; i++) {
          const a = Math.PI + i * 0.28;
          t.box(0.14, 1.1 + 0.8, 0.14, Math.sin(a) * 5, -0.8, Math.cos(a) * 5, COLORS.darkWood);
          if (i < 3) {
            const a2 = Math.PI + (i + 0.5) * 0.28;
            t.box(1.5, 0.1, 0.1, Math.sin(a2) * 5, 0.95, Math.cos(a2) * 5, COLORS.wood, a2);
          }
        }
        bench(t, -2.6, 0, -1.5, Math.PI + 0.5);
        bench(t, 2.6, 0, -1.5, Math.PI - 0.5);
        k.place(t, spot.x, spot.y, spot.z, spot.yaw);
        clear([spot], 12);
      }
    } else {
      // Lacs : ponton et barques ; à La Rive, une cabane de pêcheur en plus.
      const boats = node.place === 'harbour' ? 4 : 1;
      const pier = jetty(layout, node, boats, rand);
      if (pier) group.add(pier);
      if (node.place === 'harbour') {
        const cabins = sites(layout, node, 2, 22, 60, 12, rand);
        cabins.forEach((s) => k.place(house(rand, 4.5, 5, 2.6), s.x, s.y, s.z, s.yaw));
        clear(cabins, 9);
      }
      const [seat] = sites(layout, node, 1, 14, 26, 5, rand);
      if (seat) bench(k, seat.x, seat.y, seat.z, seat.yaw + Math.PI);
    }
    if (!k.isEmpty) group.add(k.mesh());
  }

  return {
    group,
    clearings,
    update(dtS) {
      for (const s of spinning) s.rotateZ(dtS * 0.5);
    },
  };
}
