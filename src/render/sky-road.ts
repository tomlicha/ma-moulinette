import * as THREE from 'three/webgpu';
import { attribute, color, float, mix, pow, sin, uniform, vec3 } from 'three/tsl';
import type { Edge } from '../sim/network';
import type { Tones } from './ambiance';
import { faceted, merge } from './geometry-utils';
import { mulberry32 } from './noise';
import { sideOf, type WorldLayout } from './world-layout';

/**
 * La Route arc-en-ciel à l'image : un ruban de six bandes de couleur, du rouge au violet, suspendu dans le ciel, sans
 * garde-corps (des balises de lumière flottent à sa place), son dessous bleu nuit et ses bords lumineux. De nuit il
 * brille, avec une lumière qui court dans le sens de la marche ; de jour ses bandes sont pastel, comme un vrai
 * arc-en-ciel (`Ambiance.skyRoadGlow`). S'y ajoutent l'ascenseur céleste (colonne d'anneaux, plateforme qui monte) et
 * les lieux du ciel : les anneaux de la Porte des nuages, l'îlot du Zénith, l'anneau de la Bascule.
 */

/** Les six bandes, du bord gauche au bord droit dans le sens de marche. */
export const BANDS = [0xff4f6a, 0xff9b33, 0xffd93d, 0x45d98a, 0x3fa2ff, 0x9a64ff];
/** Demi-largeur du ruban et épaisseur, en m à l'image. */
const HALF_M = 4;
const THICK_M = 0.7;
/** Pas du ruban le long de la route, en m. */
const STEP_M = 4;
/** Balises : tous les `BEACON_M` de chaque côté, flottant au-dessus du bord. */
const BEACON_M = 50;
/** Écart entre deux traits de la lumière qui court, en m. */
const FLOW_SPACING_M = 36;
/** Anneaux de la colonne de l'ascenseur : un tous les `RING_M` à l'image. */
const RING_M = 20;
const LIFT_RADIUS_M = 8.4;
/**
 * Rayon de la cabine, en m à l'image : assez large pour que la caméra, 6,5 m au plus de l'axe de la colonne, passe par
 * la trémie de la Gare sans traverser son plancher.
 */
const CABIN_RADIUS_M = 7.4;

const UNDER = new THREE.Color(0x1d1a45);
const RIM = new THREE.Color(0xfff3c4);

/** Phase de la lumière qui court, en radians, avancée à chaque image. */
const makePhase = () => uniform(0);

export interface SkyRoad {
  group: THREE.Group;
  /**
   * À chaque image : `speedMs` fait courir la lumière sur le ruban, `cabinY` (hauteur à l'image) monte la plateforme
   * de l'ascenseur pendant que le cycliste y est ; sans lui, elle attend en bas.
   */
  update(dtS: number, speedMs: number, cabinY?: number): void;
  /** Disques où le décor ne plante rien : sous la route du ciel là où elle passe bas (au départ du Sommet). */
  clearings: { x: number; z: number; r: number }[];
}

/** Matière du ruban : couleur par sommet, part lumineuse (`glowK`) et abscisse (`along`) pour la lumière qui court. */
function ribbonMaterial(tones: Tones, phase: ReturnType<typeof makePhase>): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, side: THREE.DoubleSide });
  const base = attribute('color', 'vec3');
  const k = attribute('glowK', 'float');
  const along = attribute('along', 'float');
  const glow = tones.skyRoadGlow;
  // De jour : bandes pastel éclairées par le soleil ; de nuit : la couleur vient de la lumière propre.
  mat.colorNode = mix(mix(base, vec3(1, 1, 1), 0.42), base.mul(0.3), glow) as unknown as NonNullable<THREE.MeshStandardNodeMaterial['colorNode']>;
  const run = pow(sin(along.mul((2 * Math.PI) / FLOW_SPACING_M).sub(phase)).mul(0.5).add(0.5), 8);
  mat.emissiveNode = base
    .mul(k)
    .mul(float(0.1).add(glow.mul(float(0.7).add(run.mul(0.9))))) as unknown as NonNullable<THREE.MeshStandardNodeMaterial['emissiveNode']>;
  return mat;
}

/** Le ruban d'une route du ciel : six bandes dessus, les deux bords, le dessous. */
function ribbonGeometry(layout: WorldLayout, e: Edge): THREE.BufferGeometry {
  const n = Math.max(2, Math.ceil(e.lengthM / STEP_M));
  const pos: number[] = [];
  const col: number[] = [];
  const glowK: number[] = [];
  const along: number[] = [];
  const c = new THREE.Color();
  const at = (i: number, lat: number, drop = 0): [number, number, number] => {
    const s = (i * e.lengthM) / n;
    const p = e.pointAt(s);
    const side = sideOf(e.smoothHeadingAt(s));
    return [p.x + side.x * lat, layout.y(e.altitudeAt(s)) - drop, p.z + side.z * lat];
  };
  const quad = (a: number[], b: number[], cc: number[], d: number[], hex: THREE.Color, k: number, s0: number, s1: number) => {
    // a, b au début du pas ; cc, d à la fin ; deux triangles, faces vers le haut pour le dessus.
    for (const [v, s] of [[a, s0], [cc, s1], [b, s0], [b, s0], [cc, s1], [d, s1]] as const) {
      pos.push(v[0]!, v[1]!, v[2]!);
      col.push(hex.r, hex.g, hex.b);
      glowK.push(k);
      along.push(s);
    }
  };
  const w = (2 * HALF_M) / BANDS.length;
  for (let i = 0; i < n; i++) {
    const s0 = (i * e.lengthM) / n;
    const s1 = ((i + 1) * e.lengthM) / n;
    // Dessus : du bord droit (lat négatif) au bord gauche, la dernière bande (violet) à droite.
    BANDS.forEach((hex, b) => {
      const lo = -HALF_M + (BANDS.length - 1 - b) * w;
      const hi = lo + w;
      quad(at(i, lo), at(i, hi), at(i + 1, lo), at(i + 1, hi), c.setHex(hex), 1, s0, s1);
    });
    // Bords lumineux et dessous sombre.
    for (const lat of [-HALF_M, HALF_M]) quad(at(i, lat), at(i, lat, THICK_M), at(i + 1, lat), at(i + 1, lat, THICK_M), RIM, 1.2, s0, s1);
    quad(at(i, HALF_M, THICK_M), at(i, -HALF_M, THICK_M), at(i + 1, HALF_M, THICK_M), at(i + 1, -HALF_M, THICK_M), UNDER, 0.06, s0, s1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('glowK', new THREE.Float32BufferAttribute(glowK, 1));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.computeVertexNormals();
  return g;
}

/**
 * Matière lumineuse simple (balises, anneaux), sans éclairage : la couleur de chaque instance la multiplie (Three.js
 * le fait pour toute instance colorée). Un peu plus sourde de jour.
 */
function lightMaterial(tones: Tones): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = vec3(1, 1, 1).mul(float(0.8).add(tones.skyRoadGlow.mul(0.2))) as unknown as NonNullable<THREE.MeshBasicNodeMaterial['colorNode']>;
  return mat;
}

/** Les balises : un prisme de lumière tous les `BEACON_M` de chaque côté, aux couleurs des bandes. */
function buildBeacons(layout: WorldLayout, tones: Tones): THREE.InstancedMesh {
  const spots: { x: number; y: number; z: number; c: number }[] = [];
  for (const e of layout.skyEdges) {
    for (let s = BEACON_M / 2, k = 0; s < e.lengthM; s += BEACON_M, k++) {
      const p = e.pointAt(s);
      const side = sideOf(e.headingAt(s));
      const y = layout.y(e.altitudeAt(s)) + 1.3;
      for (const lat of [-(HALF_M + 0.9), HALF_M + 0.9]) spots.push({ x: p.x + side.x * lat, y, z: p.z + side.z * lat, c: BANDS[k % BANDS.length]! });
    }
  }
  const geo = new THREE.OctahedronGeometry(0.38, 0).scale(1, 1.7, 1);
  const mesh = new THREE.InstancedMesh(geo, lightMaterial(tones), Math.max(1, spots.length));
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  spots.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, i * 0.7, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, c.setHex(p.c));
  });
  mesh.count = spots.length;
  mesh.frustumCulled = false;
  return mesh;
}

/** Des anneaux de lumière en travers de la route `e`, aux abscisses `at`, de rayons `radii`. */
function gateRings(layout: WorldLayout, e: Edge, at: number[], radii: number[], tilt = 0): THREE.BufferGeometry[] {
  return at.map((s, i) => {
    const p = e.pointAt(s);
    const h = e.smoothHeadingAt(s);
    const r = radii[i]!;
    const ring = new THREE.TorusGeometry(r, 0.32, 5, 28);
    // Le tore est dans le plan xy : on le tourne face à la route (son axe le long du cap), centré au-dessus de la chaussée.
    ring.rotateZ(tilt);
    ring.rotateY(-h + Math.PI / 2);
    ring.translate(p.x, layout.y(e.altitudeAt(s)) + r * 0.55, p.z);
    return ring;
  });
}

/** Un îlot de roche flottant sous le Zénith, avec ses cristaux et une coupole d'observatoire. */
function zenithIsland(layout: WorldLayout, e: Edge): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(77);
  const p = e.from; // le Zénith est le départ de la Crête
  const h = e.headingAt(0);
  const side = sideOf(h);
  // À gauche de la route, au-dehors de la Spirale.
  const cx = p.x + side.x * 38;
  const cz = p.z + side.z * 38;
  const top = layout.y(p.altitude) - 2;
  const rock = faceted(new THREE.IcosahedronGeometry(1, 1));
  const pos = rock.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // Dessus plat, dessous en pointe : un îlot.
    pos.setXYZ(i, pos.getX(i) * 22 * (0.85 + 0.3 * rand()), y > 0.2 ? 0 : y * 26 * (0.8 + 0.4 * rand()), pos.getZ(i) * 18 * (0.85 + 0.3 * rand()));
  }
  rock.computeVertexNormals();
  const stone = new THREE.Mesh(rock, new THREE.MeshStandardNodeMaterial({ color: 0x5b4f7a, roughness: 0.95, flatShading: true }));
  stone.position.set(cx, top, cz);
  g.add(stone);
  const crystals: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const r = 4 + rand() * 12;
    const hh = 3 + rand() * 6;
    crystals.push(new THREE.ConeGeometry(0.9 + rand() * 0.8, hh, 5).rotateZ((rand() - 0.5) * 0.5).translate(cx + Math.cos(a) * r, top + hh / 2, cz + Math.sin(a) * r));
  }
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0xbfa8ff, roughness: 0.25, flatShading: true });
  glass.emissiveNode = color(0x9a64ff).mul(float(0.25)) as unknown as NonNullable<THREE.MeshStandardNodeMaterial['emissiveNode']>;
  g.add(new THREE.Mesh(merge(crystals), glass));
  const dome = new THREE.Mesh(
    faceted(new THREE.SphereGeometry(4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
    new THREE.MeshStandardNodeMaterial({ color: 0xd8dbe8, roughness: 0.6, flatShading: true }),
  );
  dome.position.set(cx - side.x * 8, top, cz - side.z * 8);
  g.add(dome);
  return g;
}

/** L'ascenseur céleste : plateformes du bas et du haut, colonne d'anneaux, faisceaux, et la cabine qui monte. */
function buildLift(layout: WorldLayout, lift: Edge, tones: Tones) {
  const g = new THREE.Group();
  const x = lift.from.x;
  const z = lift.from.z;
  const yBottom = layout.y(lift.from.altitude);
  const yTop = layout.y(lift.to.altitude);
  const deck = new THREE.MeshStandardNodeMaterial({ color: 0x2a2660, roughness: 0.6, flatShading: true });
  const rimMat = new THREE.MeshStandardNodeMaterial({ color: 0xfff3c4, roughness: 0.4 });
  rimMat.emissiveNode = color(0xffe28a).mul(float(0.35).add(tones.skyRoadGlow.mul(0.9))) as unknown as NonNullable<THREE.MeshStandardNodeMaterial['emissiveNode']>;
  /** Plateforme ronde de rayon `r`, percée au milieu d'une trémie de rayon `hole` (0 : pleine). */
  const platform = (r: number, hole = 0) => {
    const p = new THREE.Group();
    const geo = hole
      ? new THREE.LatheGeometry([new THREE.Vector2(hole, 0), new THREE.Vector2(r, 0), new THREE.Vector2(r * 0.92, -0.6), new THREE.Vector2(hole, -0.6), new THREE.Vector2(hole, 0)], 32)
      : new THREE.CylinderGeometry(r, r * 0.92, 0.6, 24).translate(0, -0.3, 0);
    p.add(new THREE.Mesh(faceted(geo), deck));
    for (const rr of hole ? [r, hole] : [r]) p.add(new THREE.Mesh(new THREE.TorusGeometry(rr, 0.16, 4, 32).rotateX(Math.PI / 2).translate(0, 0.05, 0), rimMat));
    return p;
  };
  // En bas, posée au bout de la Jetée. En haut, la Gare céleste, plus large, avec ses lanternes : la cabine monte par sa
  // trémie et en devient le milieu (la caméra, qui la suit de près, passe elle aussi par la trémie).
  const base = platform(LIFT_RADIUS_M + 1.5);
  base.position.set(x, yBottom + 0.02, z);
  const gare = platform(12, CABIN_RADIUS_M + 0.15);
  gare.position.set(x, yTop - 0.02, z);
  const lanterns: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    lanterns.push(new THREE.BoxGeometry(0.5, 0.8, 0.5).translate(Math.cos(a) * 11, 2.2, Math.sin(a) * 11));
    lanterns.push(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 5).translate(Math.cos(a) * 11, 0.9, Math.sin(a) * 11));
  }
  const lanternMesh = new THREE.Mesh(merge(lanterns), rimMat);
  gare.add(lanternMesh);
  // La cabine : un disque de verre, ouvert, sans parois, qui ne cache rien ; en haut, il bouche la trémie de la Gare.
  const cabin = new THREE.Group();
  const glassDeck = new THREE.MeshStandardNodeMaterial({ color: 0x9f96d8, roughness: 0.3, flatShading: true });
  glassDeck.emissiveNode = color(0x9a8cff).mul(float(0.1).add(tones.skyRoadGlow.mul(0.25))) as unknown as NonNullable<THREE.MeshStandardNodeMaterial['emissiveNode']>;
  cabin.add(new THREE.Mesh(faceted(new THREE.CylinderGeometry(CABIN_RADIUS_M, CABIN_RADIUS_M * 0.94, 0.35, 24).translate(0, -0.18, 0)), glassDeck));
  cabin.add(new THREE.Mesh(new THREE.TorusGeometry(CABIN_RADIUS_M, 0.12, 4, 32).rotateX(Math.PI / 2), rimMat));
  cabin.position.set(x, yBottom + 0.05, z);
  g.add(base, gare, cabin);

  // Anneaux de la colonne : ils s'allument quand la cabine les passe.
  const rings: number[] = [];
  for (let y = yBottom + 10; y < yTop - 4; y += RING_M) rings.push(y);
  const ringMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(LIFT_RADIUS_M, 0.2, 4, 28).rotateX(Math.PI / 2), lightMaterial(tones), rings.length);
  const dummy = new THREE.Object3D();
  rings.forEach((y, i) => {
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    ringMesh.setMatrixAt(i, dummy.matrix);
  });
  ringMesh.frustumCulled = false;
  // Quatre faisceaux le long de la colonne.
  const beams: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    beams.push(new THREE.CylinderGeometry(0.09, 0.09, yTop - yBottom, 4).translate(x + Math.cos(a) * LIFT_RADIUS_M, (yTop + yBottom) / 2, z + Math.sin(a) * LIFT_RADIUS_M));
  }
  const beamMat = new THREE.MeshBasicNodeMaterial();
  beamMat.colorNode = mix(color(0xd9d2b5), color(0xfff3c4), tones.skyRoadGlow) as unknown as NonNullable<THREE.MeshBasicNodeMaterial['colorNode']>;
  g.add(ringMesh, new THREE.Mesh(merge(beams), beamMat));

  const lit = new THREE.Color(0xffe28a);
  const idle = new THREE.Color(0x8f86c9);
  const c = new THREE.Color();
  let shownY = NaN;
  cabin.position.y = yBottom + 0.03;
  return {
    group: g,
    update(cabinY: number | undefined) {
      // Personne dedans : la cabine reste où elle s'est arrêtée (en haut, après une montée).
      if (cabinY === undefined) return;
      const y = cabinY;
      cabin.position.y = y - 0.02;
      if (Math.abs(y - shownY) < 0.5) return;
      shownY = y;
      // Passés : allumés ; au-dessus : en attente, plus pâles ; le prochain s'éclaire à l'approche.
      rings.forEach((ry, i) => ringMesh.setColorAt(i, c.copy(idle).lerp(lit, Math.min(1, Math.max(0, (y - ry + 12) / 12)))));
      if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;
    },
  };
}

export function buildSkyRoad(layout: WorldLayout, tones: Tones): SkyRoad {
  const group = new THREE.Group();
  const phase = makePhase();
  const clearings: SkyRoad['clearings'] = [];
  if (layout.skyEdges.length) {
    const road = new THREE.Mesh(ribbonMerged(layout), ribbonMaterial(tones, phase));
    road.receiveShadow = true;
    road.frustumCulled = false;
    group.add(road, buildBeacons(layout, tones));

    // Les lieux du ciel.
    const ringGeos: THREE.BufferGeometry[] = [];
    const spiral = layout.skyEdges.find((e) => e.id === 'spirale');
    if (spiral) ringGeos.push(...gateRings(layout, spiral, [25, 50, 75, 100, 125], [10, 9, 8, 7.2, 6.6]));
    const plongee = layout.skyEdges.find((e) => e.id === 'plongee');
    if (plongee) ringGeos.push(...gateRings(layout, plongee, [45], [11], 0.25));
    if (ringGeos.length) {
      const rings = new THREE.InstancedMesh(merge(ringGeos), lightMaterial(tones), 1);
      rings.setMatrixAt(0, new THREE.Matrix4());
      rings.setColorAt(0, new THREE.Color(0xffd93d));
      rings.frustumCulled = false;
      group.add(rings);
    }
    const crete = layout.skyEdges.find((e) => e.id === 'crete');
    if (crete) group.add(zenithIsland(layout, crete));

    // Sous la route, là où elle passe bas (au départ du Sommet), le décor ne plante rien.
    for (const e of layout.skyEdges) {
      for (const p of e.sample(15)) {
        if (p.altitude - layout.groundAlt(p.x, p.z) < 30) clearings.push({ x: p.x, z: p.z, r: 16 });
      }
    }
  }
  const lifts = layout.lifts.map((l) => buildLift(layout, l, tones));
  for (const l of lifts) group.add(l.group);

  return {
    group,
    clearings,
    update(dtS, speedMs, cabinY) {
      // La lumière court devant le cycliste, un peu plus vite que lui, et lentement à l'arrêt.
      phase.value += dtS * ((2 * Math.PI) / FLOW_SPACING_M) * (4 + speedMs * 1.4);
      for (const l of lifts) l.update(cabinY);
    },
  };
}

/** Le ruban de toutes les routes du ciel, en un seul maillage, avec ses attributs propres (que `merge` retirerait). */
function ribbonMerged(layout: WorldLayout): THREE.BufferGeometry {
  const parts = layout.skyEdges.map((e) => ribbonGeometry(layout, e));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'glowK', 'along']) {
    const size = parts[0]!.getAttribute(name).itemSize;
    const total = parts.reduce((n, p) => n + p.getAttribute(name).array.length, 0);
    const arr = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
      arr.set(p.getAttribute(name).array as Float32Array, o);
      o += p.getAttribute(name).array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
