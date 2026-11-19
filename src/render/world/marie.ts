import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BIKE_NODE } from '../core/asset-contract';
import type { RiderAssets } from '../core/assets';
import { RegionMaterial } from '../core/region-material';
import { aimBasis, DEFAULT_BODY as BODY, offset, SKELETON, sub, twoBone, v3, type Basis, type Joint, type V3 } from '../riders/rider-pose';
import type { Edge } from '../../domain/course/network';
import { ROAD_HALF, sideOf, type WorldLayout } from './world-layout';

/**
 * Marie, le même avatar que le cycliste, accroupie au bord de la route derrière son vélo retourné sur la selle et le
 * guidon : elle fait tourner la roue arrière en la resserrant. Même modèle, même squelette, même palette : seule la
 * pose change, calculée comme celle du pédalage (voir `rider-pose.ts`).
 *
 * Repère local du groupe : le vélo est posé le long de z (l'avant vers +z), à x = 0 ; Marie est derrière lui, côté
 * extérieur (x < 0), face à la route. Origine au sol.
 */

/** Distance du bord de la chaussée au vélo, en m ; Marie est `STANCE_M` plus loin. */
const SHOULDER_GAP_M = 2.0;
/** Distance entre Marie et le plan du vélo, en m. */
const STANCE_M = 0.72;
/** Au-delà de cette distance au cycliste, Marie n'est ni dessinée ni animée. */
const VISIBLE_RANGE_M = 400;

const DEG = Math.PI / 180;
const LEFT = v3(1, 0, 0);
const dirAt = (angle: number) => v3(0, Math.sin(angle), Math.cos(angle));

const COLORS = { metal: 0x8d939d, tyre: 0x1b1d22, toolbox: 0xd9483b, lid: 0xb23a2f, bottle: 0xf2cf3a, lever: 0x4cc9f0 };

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function material(color: number, roughness = 0.8) {
  return new THREE.MeshStandardNodeMaterial({ color, roughness });
}

function shadowed<T extends THREE.Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Cylindre tendu entre deux points. */
function limb(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material): THREE.Mesh {
  const m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8), mat));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(v(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

function box(size: THREE.Vector3, pos: THREE.Vector3, mat: THREE.Material): THREE.Mesh {
  const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat));
  m.position.copy(pos);
  return m;
}

interface Pose {
  root: V3;
  bases: Record<string, Basis>;
}

/**
 * Accroupie face à +z (repère de l'avatar : y en haut, x à sa gauche) : pieds à plat, genoux devant les pointes,
 * buste penché, mains sur la roue à `hub`. `wiggle` (-1..1) fait bouger le buste et les mains au rythme du geste.
 */
function crouchPose(hub: V3, wiggle: number): Pose {
  const j = {} as Record<Joint, V3>;
  const root = v3(0, 0.42, -0.22);
  const torso = (54 + 2.5 * wiggle) * DEG;
  j.root = root;
  j.lumbar = offset(root, [dirAt(torso + 22 * DEG), BODY.pelvis]);
  j.thorax = offset(j.lumbar, [dirAt(torso + 6 * DEG), BODY.spine]);
  j.neckBase = offset(j.thorax, [dirAt(torso - 9 * DEG), BODY.chest]);
  j.headBase = offset(j.neckBase, [dirAt(66 * DEG), BODY.neck]);
  j.headTop = offset(j.headBase, [dirAt(46 * DEG), BODY.head]); // tête penchée sur le travail
  const bases: Record<string, Basis> = {
    pelvis: aimBasis(sub(j.lumbar, root), LEFT),
    spine: aimBasis(sub(j.thorax, j.lumbar), LEFT),
    chest: aimBasis(sub(j.neckBase, j.thorax), LEFT),
    neck: aimBasis(sub(j.headBase, j.neckBase), LEFT),
    head: aimBasis(sub(j.headTop, j.headBase), LEFT),
  };
  for (const [s, side] of [['l', 1], ['r', -1]] as const) {
    const ankle = v3(side * 0.11, BODY.ankleHeight + 0.015, 0);
    const ball = offset(ankle, [v3(0, -0.03, 0.126), 1]);
    const hip = offset(root, [bases.pelvis!.x, side * BODY.hipHalfWidth]);
    const knee = twoBone(hip, ankle, BODY.thigh, BODY.shin, v3(side * 0.25, 0.4, 1));
    const shoulder = offset(j.neckBase, [bases.chest!.x, side * BODY.shoulderHalfWidth], [bases.chest!.y, -BODY.shoulderDrop]);
    // La main gauche tient la roue, la droite la fait tourner : elle va et vient.
    const sway = side === 1 ? 0.012 * wiggle : 0.03 * wiggle;
    const wrist = offset(hub, [v3(side * 0.09, 0.05 + sway, -0.1), 1]);
    const elbow = twoBone(shoulder, wrist, BODY.upperArm, BODY.forearm, v3(side * 0.6, -0.3, -0.5));
    const knuckle = offset(wrist, [v3(0, -0.2, 1), 0.098]);
    Object.assign(j, { [`hip_${s}`]: hip, [`knee_${s}`]: knee, [`ankle_${s}`]: ankle, [`ball_${s}`]: ball });
    bases[`thigh_${s}`] = aimBasis(sub(knee, hip), LEFT);
    bases[`shin_${s}`] = aimBasis(sub(ankle, knee), LEFT);
    bases[`foot_${s}`] = aimBasis(sub(ball, ankle), LEFT);
    bases[`upperarm_${s}`] = aimBasis(sub(elbow, shoulder), LEFT);
    bases[`forearm_${s}`] = aimBasis(sub(wrist, elbow), LEFT);
    bases[`hand_${s}`] = aimBasis(sub(knuckle, wrist), LEFT);
  }
  return { root, bases };
}

export interface Marie {
  group: THREE.Group;
  /**
   * Fait tourner la roue arrière et balance Marie au rythme de son geste. Avec `rider`, Marie disparaît (et ne coûte
   * plus rien) quand le coureur en est loin : avatar et vélo pèsent plus de 500 000 triangles.
   */
  update(dtS: number, rider?: { x: number; z: number }): void;
  /** Position de Marie dans le monde, pour les vues de test. */
  readonly position: THREE.Vector3;
}

/** Marie au bord de `edge`, à l'abscisse `s`, du côté droit de la route dans son sens de définition. */
export function buildMarie(layout: WorldLayout, assets: RiderAssets, edge: Edge, s: number): Marie {
  const root = new THREE.Group();
  const kit = new RegionMaterial(); // la palette du cycliste
  const paint = (o: THREE.Object3D) =>
    o.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = kit;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

  /* ---------- Vélo retourné ---------- */
  const bike = assets.bike.clone(true);
  paint(bike);
  const flipped = new THREE.Group();
  flipped.rotation.z = Math.PI; // sur la selle et le guidon
  flipped.add(bike);
  root.add(flipped);
  flipped.updateMatrixWorld(true);
  flipped.position.y = -new THREE.Box3().setFromObject(flipped).min.y;
  root.updateMatrixWorld(true);
  const rearWheel = bike.getObjectByName(BIKE_NODE.rearWheel)!;
  const hubWorld = rearWheel.getWorldPosition(new THREE.Vector3());

  /* ---------- Marie : l'avatar du cycliste, derrière la roue arrière ---------- */
  const holder = new THREE.Group();
  holder.position.set(-STANCE_M, 0, hubWorld.z);
  holder.rotation.y = Math.PI / 2; // face au vélo, c'est-à-dire à +x
  root.add(holder);
  const avatar = cloneSkinned(assets.avatar) as THREE.Group;
  paint(avatar);
  holder.add(avatar);
  const bones = SKELETON.map((b) => avatar.getObjectByName(b.bone)!);
  const parentIndex = SKELETON.map((b) => SKELETON.findIndex((o) => o.bone === b.parent));
  const hub = v3(0, hubWorld.y, STANCE_M); // le moyeu, dans le repère de Marie
  const world = SKELETON.map(() => new THREE.Quaternion());
  const m = new THREE.Matrix4();
  const applyPose = (wiggle: number) => {
    const pose = crouchPose(hub, wiggle);
    SKELETON.forEach((def, i) => {
      const b = pose.bases[def.bone]!;
      world[i]!.setFromRotationMatrix(m.makeBasis(v(b.x.x, b.x.y, b.x.z), v(b.y.x, b.y.y, b.y.z), v(b.z.x, b.z.y, b.z.z)));
      const bone = bones[i]!;
      if (def.parent) bone.quaternion.copy(world[parentIndex[i]!]!).invert().multiply(world[i]!);
      else bone.quaternion.copy(world[i]!);
    });
    bones[0]!.position.set(pose.root.x, pose.root.y, pose.root.z);
  };
  applyPose(0);

  /* ---------- Affaires sur l'herbe ---------- */
  const zM = hubWorld.z;
  const lids = material(COLORS.lid, 0.6);
  const tube = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.013, 6, 24).rotateX(Math.PI / 2), material(COLORS.tyre, 0.9)));
  tube.position.set(-0.5, 0.015, zM + 0.5); // chambre à air sortie du pneu
  root.add(
    box(v(0.2, 0.1, 0.34), v(-0.5, 0.05, zM - 0.6), material(COLORS.toolbox, 0.6)), // boîte à outils
    box(v(0.21, 0.012, 0.35), v(-0.5, 0.1, zM - 0.6), lids),
    box(v(0.09, 0.03, 0.04), v(-0.5, 0.115, zM - 0.6), lids),
    limb(v(-1.0, 0.03, zM - 0.1), v(-1.0, 0.03, zM + 0.45), 0.018, material(COLORS.metal, 0.4)), // pompe posée à plat
    limb(v(-1.0, 0.03, zM + 0.45), v(-1.0, 0.03, zM + 0.56), 0.024, material(COLORS.tyre, 0.8)),
    limb(v(-0.4, 0.012, zM + 0.1), v(-0.42, 0.012, zM + 0.3), 0.008, material(COLORS.lever, 0.5)), // démonte-pneus
    limb(v(-0.34, 0.012, zM + 0.14), v(-0.37, 0.012, zM + 0.34), 0.008, material(COLORS.lever, 0.5)),
    tube,
    limb(v(-1.1, 0.02, zM + 0.8), v(-1.1, 0.2, zM + 0.8), 0.035, material(COLORS.bottle, 0.5)), // bidon
    limb(v(-1.1, 0.2, zM + 0.8), v(-1.1, 0.235, zM + 0.8), 0.016, material(COLORS.tyre, 0.6)),
    buildSign(zM),
  );

  /* ---------- Pose dans le monde ---------- */
  const lat = -(ROAD_HALF + SHOULDER_GAP_M);
  const p = edge.pointAt(s);
  const side = sideOf(edge.headingAt(s)); // la gauche : le côté de la route, vu de Marie
  // Pente à l'image : le relief est exagéré, Marie suit le sol tel qu'il est dessiné.
  const grade = layout.relief * ((edge.altitudeAt(s + 1) - edge.altitudeAt(s - 1)) / 2);
  root.rotation.order = 'YXZ';
  // +x local → vers la route (+side), z local → sens de la marche ; l'ensemble suit la pente.
  root.rotation.y = Math.atan2(-side.z, side.x);
  root.rotation.x = -Math.atan(grade);
  const x = p.x + side.x * lat;
  const z = p.z + side.z * lat;
  root.position.set(x, layout.groundY(x, z), z);

  let t = 0;
  return {
    group: root,
    position: root.position,
    update(dtS: number, rider?: { x: number; z: number }) {
      if (rider) root.visible = Math.hypot(rider.x - x, rider.z - z) < VISIBLE_RANGE_M;
      if (!root.visible) return;
      t += dtS;
      rearWheel.rotation.x -= dtS * 2.4;
      applyPose(Math.sin(t * 2.1));
    },
  };
}

const SIGN_LINES = ['ICI GÎT MARIE', 'remplaçant son pneu', 'à Magog'];
/** Distance en amont de Marie (m) : la pancarte se lit pendant qu'on s'approche. */
const SIGN_BEFORE_M = 11;

function signTexture(lines: readonly string[]): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4efe2';
  ctx.fillRect(0, 0, 1024, 512);
  ctx.strokeStyle = '#0e1726';
  ctx.lineWidth = 22;
  ctx.strokeRect(11, 11, 1002, 490);
  ctx.fillStyle = '#d9483b';
  ctx.fillRect(40, 372, 944, 10);
  ctx.fillStyle = '#0e1726';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const font = '700 {px} "Barlow Condensed", "Arial Narrow", "Segoe UI", system-ui, sans-serif';
  ctx.font = font.replace('{px}', '150px');
  ctx.fillText(lines[0]!, 512, 135, 940);
  ctx.font = font.replace('{px}', '110px');
  ctx.fillText(lines[1]!, 512, 290, 940);
  ctx.fillStyle = '#d9483b';
  ctx.font = font.replace('{px}', '120px');
  ctx.fillText(lines[2]!, 512, 440, 940);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Pancarte sur deux piquets (trois lignes), plantée `before` m en amont de `zM`. */
export function buildSign(zM: number, lines: readonly string[] = SIGN_LINES, before = SIGN_BEFORE_M): THREE.Group {
  const g = new THREE.Group();
  const wood = material(0x6b4a2e, 0.9);
  const tex = signTexture(lines);
  const face = tex ? new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.8 }) : wood;
  const w = 3.6;
  const h = 1.8;
  for (const x of [-w / 2 + 0.25, w / 2 - 0.25]) g.add(box(v(0.14, 2.4, 0.14), v(x, 1.2, -0.07), wood));
  const board = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), [wood, wood, wood, wood, face, wood]));
  board.position.set(0, 0.6 + h / 2, 0);
  g.add(board);
  g.rotation.y = Math.PI; // face vers le coureur qui arrive, c'est-à-dire vers -z
  g.position.set(-2.1, 0, zM - before);
  return g;
}
