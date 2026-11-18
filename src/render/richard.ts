import * as THREE from 'three/webgpu';
import { BIKE_NODE } from './asset-contract';
import type { RiderAssets } from './assets';
import { buildSign } from './marie';
import { Rider } from './rider';
import type { Edge } from '../sim/network';
import { ROAD_HALF, sideOf, type WorldLayout } from './world-layout';

/**
 * Richard, le même avatar et le même vélo que le cycliste, en équilibre sur la roue arrière : il monte puis descend
 * un escalier de pierre au bord de la route, fait demi-tour sur place (la roue arrière pour pivot) et refait le
 * chemin en sens inverse. Même modèle, même palette (un maillot orange) : seul le vélo est cabré autour du point de
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
/** Longueur sur laquelle la roue monte (ou descend) d'une marche. */
const CLIMB_M = 0.32;
/** Roulage au sol de part et d'autre de l'escalier, avant de faire demi-tour. */
const RUNWAY_M = 1.3;
const SPEED_MS = 1.0;
const TURN_S = 1.7;
const CADENCE_RPM = 50;

const DEG = Math.PI / 180;
/** Cabrage : l'angle du cadre au-dessus de l'horizontale, proche du point d'équilibre. */
const PITCH = 54 * DEG;

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** Abscisse (dans le sens de la marche, 0 au milieu du palier) de la marche `k` (1 à `STEPS`) en montée. */
const riser = (k: number) => -TOP_HALF_M - (STEPS - k) * TREAD_M;
const HALF_LENGTH_M = TOP_HALF_M + (STEPS - 1) * TREAD_M + RUNWAY_M;

/**
 * Hauteur du point de contact du pneu arrière à l'abscisse `u`, et part de saut (0 à 1) : la roue se lève juste avant
 * chaque marche, redescend après chaque arête. L'escalier est symétrique, donc valable dans les deux sens.
 */
export function wheelHeight(u: number): { h: number; hop: number } {
  let h = 0;
  let hop = 0;
  for (let k = 1; k <= STEPS; k++) {
    const up = (u - (riser(k) - CLIMB_M)) / CLIMB_M;
    h += RISE_M * smooth(up);
    if (up > 0 && up < 1) hop = Math.max(hop, Math.sin(Math.PI * up));
    const down = (u - -riser(k)) / CLIMB_M;
    h -= RISE_M * smooth(down);
  }
  return { h, hop };
}

/** Où se trouve Richard à l'instant `t` du cycle : abscisse z, cap (0 vers +z, π vers −z), sens de marche. */
export function cycleAt(t: number): { z: number; yaw: number; dir: 1 | -1; moving: boolean } {
  const run = (2 * HALF_LENGTH_M) / SPEED_MS;
  const period = 2 * (run + TURN_S);
  const c = ((t % period) + period) % period;
  const ease = (x: number) => smooth(x / TURN_S);
  if (c < run) return { z: -HALF_LENGTH_M + c * SPEED_MS, yaw: 0, dir: 1, moving: true };
  if (c < run + TURN_S) return { z: HALF_LENGTH_M, yaw: Math.PI * ease(c - run), dir: 1, moving: false };
  if (c < 2 * run + TURN_S) return { z: HALF_LENGTH_M - (c - run - TURN_S) * SPEED_MS, yaw: Math.PI, dir: -1, moving: true };
  return { z: -HALF_LENGTH_M, yaw: Math.PI + Math.PI * ease(c - 2 * run - TURN_S), dir: -1, moving: false };
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
  const rearZ = assets.bike.getObjectByName(BIKE_NODE.rearWheel)!.position.z; // négatif : derrière le pédalier
  rider.group.position.set(0, 0, -rearZ); // le contact du pneu arrière à l'origine du pivot
  const pivot = new THREE.Group();
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
    const u = c.dir * c.z;
    const { h, hop } = wheelHeight(u);
    walker.position.set(0, h, c.z);
    walker.rotation.y = c.yaw;
    // L'équilibre : le cadre oscille autour du point mort, se cabre un peu plus au saut.
    const pitch = PITCH + 3 * DEG * Math.sin(t * 1.7) + 7 * DEG * hop;
    pivot.rotation.set(-pitch, 0, 2.5 * DEG * Math.sin(t * 1.1), 'XYZ');
    return c.moving;
  };
  apply();

  return {
    group: root,
    position: root.position,
    update(dtS: number, riderPos?: { x: number; z: number }) {
      if (riderPos) root.visible = Math.hypot(riderPos.x - x, riderPos.z - z) < VISIBLE_RANGE_M;
      if (!root.visible) return;
      t += dtS;
      const moving = apply();
      rider.animate(dtS, CADENCE_RPM, moving ? SPEED_MS : 0);
    },
  };
}
