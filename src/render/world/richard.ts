import * as THREE from 'three/webgpu';
import { BIKE_NODE } from '../core/asset-contract';
import type { RiderAssets } from '../core/assets';
import { buildSign } from './marie';
import { Rider } from '../riders/rider';
import type { Edge } from '../../domain/course/network';
import { ROAD_HALF, sideOf, type WorldLayout } from './world-layout';

/**
 * Richard, le même avatar et le même vélo que le cycliste, en équilibre sur la roue arrière : il monte puis descend
 * un escalier de pierre au bord de la route, puis repart en sens inverse, sans jamais se retourner : il pédale comme le coureur, en boucle. Même modèle, même palette (un maillot orange) : seul le vélo est cabré autour du point de
 * contact du pneu arrière avec les marches.
 *
 * Repère local du groupe : l'escalier est posé le long de z, au milieu (z = 0), à x = 0 ; origine au sol.
 */

/** Distance du bord de la chaussée à l'escalier, en m. */
const SHOULDER_GAP_M = 2.6;
/** Au-delà de cette distance au cycliste, Richard n'est ni dessiné ni animé. */
const VISIBLE_RANGE_M = 400;

/** Marches de chaque côté du palier : hauteur, profondeur (m), demi-longueur du palier, largeur de l'escalier. */
const STEPS = 4;
const RISE_M = 0.17;
const TREAD_M = 0.5;
const TOP_HALF_M = 0.6;
const WIDTH_M = 1.5;
/** Roulage au sol de part et d'autre de l'escalier, avant de repartir dans l'autre sens. */
const RUNWAY_M = 1.3;
const CADENCE_RPM = 50;

const DEG = Math.PI / 180;
/** Cabrage : l'angle du cadre au-dessus de l'horizontale, proche du point d'équilibre. */
const PITCH = 54 * DEG;

/** Abscisse (dans le sens de la marche, 0 au milieu du palier) de la contremarche `k` (1 à `STEPS`) en montée. */
const riser = (k: number) => -TOP_HALF_M - (STEPS - k) * TREAD_M;
const HALF_LENGTH_M = TOP_HALF_M + (STEPS - 1) * TREAD_M + RUNWAY_M;
/** Rayon du pneu arrière, en m, quand le modèle n'en dit rien de mieux. */
const WHEEL_RADIUS_M = 0.34;

/** Hauteur de l'escalier à l'abscisse `x` : une pyramide de `STEPS` marches. */
export function stairHeight(x: number): number {
  let up = 0;
  let down = 0;
  for (let k = 1; k <= STEPS; k++) {
    if (x >= riser(k)) up++;
    if (x < -riser(k)) down++;
  }
  return RISE_M * Math.min(up, down);
}

/** Hauteur du moyeu arrière : la roue roule sur le profil des marches, arêtes comprises, sans y entrer. */
export function hubHeight(z: number, radius = WHEEL_RADIUS_M): number {
  // Le point le plus contraignant est sous le moyeu, ou sur l'une des arêtes à portée de la roue.
  let hub = stairHeight(z) + radius;
  for (let k = 1; k <= STEPS; k++) {
    for (const e of [riser(k), -riser(k)]) {
      const dx = e - z;
      if (Math.abs(dx) >= radius) continue;
      const corner = Math.max(stairHeight(e - 1e-6), stairHeight(e + 1e-6));
      hub = Math.max(hub, corner + Math.sqrt(radius * radius - dx * dx));
    }
  }
  return hub;
}

/** Hauteur du point de contact du pneu arrière et part de saut (0 à 1, la pente que la roue gravit ou descend). */
export function wheelHeight(z: number, radius = WHEEL_RADIUS_M): { h: number; hop: number } {
  const h = hubHeight(z, radius) - radius;
  const slope = Math.abs(hubHeight(z + 0.05, radius) - hubHeight(z - 0.05, radius)) / 0.1;
  return { h, hop: Math.min(1, slope / 1.5) };
}

/** Durée d'un aller-retour complet, en s. */
const PERIOD_S = 12;

/**
 * Où se trouve Richard à l'instant `t` : abscisse z et vitesse (m/s, négative en descendant à reculons). Il va et
 * vient sur l'escalier sans jamais se retourner, en ralentissant doucement aux deux bouts.
 */
export function cycleAt(t: number): { z: number; speed: number } {
  const w = (2 * Math.PI) / PERIOD_S;
  return { z: -HALF_LENGTH_M * Math.cos(w * t), speed: HALF_LENGTH_M * w * Math.sin(w * t) };
}

export interface Richard {
  group: THREE.Group;
  /** Fait avancer le cycle. Avec `rider`, Richard disparaît (et ne coûte plus rien) quand le coureur en est loin. */
  update(dtS: number, rider?: { x: number; z: number }): void;
  /** Position de Richard dans le monde, pour les vues de test. */
  readonly position: THREE.Vector3;
}

/** Richard au bord de `edge`, à l'abscisse `s`, du côté droit de la route dans son sens de définition. */
export function buildRichard(layout: WorldLayout, assets: RiderAssets, edge: Edge, s: number): Richard {
  const root = new THREE.Group();

  /* ---------- L'escalier de pierre : montée, palier, descente ---------- */
  const stone = new THREE.MeshStandardNodeMaterial({ color: 0xa9a59b, roughness: 0.95 });
  const block = (z0: number, z1: number, height: number) => {
    const depth = height + 0.35; // enfoncé dans le sol : le terrain n'est pas plat
    const m = new THREE.Mesh(new THREE.BoxGeometry(WIDTH_M, depth, z1 - z0), stone);
    m.position.set(0, height - depth / 2, (z0 + z1) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  for (let k = 1; k < STEPS; k++) {
    root.add(block(riser(k), riser(k + 1), k * RISE_M), block(-riser(k + 1), -riser(k), k * RISE_M));
  }
  root.add(block(riser(STEPS), -riser(STEPS), STEPS * RISE_M));
  root.add(buildSign(0, ['RICHARD', 'sur une roue', 'dans l’escalier'], 9));

  /* ---------- Richard : le vélo cabré autour du contact du pneu arrière ---------- */
  const rider = new Rider(assets, { jersey: { color: 0xf08a24 }, sock: { color: 0xf08a24 }, helmetAlt: { color: 0xf08a24 }, frame: { color: 0x2d6cdf } });
  const pivot = new THREE.Group();
  const rearZ = assets.bike.getObjectByName(BIKE_NODE.rearWheel)!.position.z; // négatif : derrière le pédalier
  const wheelR = assets.bike.getObjectByName(BIKE_NODE.rearWheel)!.position.y; // hauteur du moyeu
  rider.group.position.set(0, -wheelR, -rearZ); // le moyeu arrière à l'origine du pivot : la roue reste posée sur la marche
  pivot.position.set(0, wheelR, 0);
  pivot.add(rider.group);
  const walker = new THREE.Group();
  walker.add(pivot);
  root.add(walker);

  /* ---------- Pose dans le monde ---------- */
  const lat = -(ROAD_HALF + SHOULDER_GAP_M);
  const p = edge.pointAt(s);
  const side = sideOf(edge.headingAt(s));
  const grade = layout.relief * ((edge.altitudeAt(s + 1) - edge.altitudeAt(s - 1)) / 2);
  root.rotation.order = 'YXZ';
  root.rotation.y = Math.atan2(-side.z, side.x);
  root.rotation.x = -Math.atan(grade);
  const x = p.x + side.x * lat;
  const z = p.z + side.z * lat;
  root.position.set(x, layout.groundY(x, z), z);

  let t = 0;
  const apply = () => {
    const c = cycleAt(t);
    const { h, hop } = wheelHeight(c.z, wheelR);
    walker.position.set(0, h, c.z);
    // L'équilibre : le cadre oscille autour du point mort, se cabre un peu plus au saut.
    const pitch = PITCH + 3 * DEG * Math.sin(t * 1.7) + 7 * DEG * hop;
    pivot.rotation.set(-pitch, 0, 2.5 * DEG * Math.sin(t * 1.1), 'XYZ');
    return c.speed;
  };
  apply();

  return {
    group: root,
    position: root.position,
    update(dtS: number, riderPos?: { x: number; z: number }) {
      if (riderPos) root.visible = Math.hypot(riderPos.x - x, riderPos.z - z) < VISIBLE_RANGE_M;
      if (!root.visible) return;
      t += dtS;
      rider.animate(dtS, CADENCE_RPM, apply());
    },
  };
}
