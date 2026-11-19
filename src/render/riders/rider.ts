import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BIKE_NODE } from '../core/asset-contract';
import type { RiderAssets } from '../core/assets';
import { RegionMaterial, type Kit } from '../core/region-material';
import { footPitch, SKELETON, solvePose, solveTorsoAngle, SEATED, STANDING, type Basis, type BikeFit, type Stance } from './rider-pose';

/** Poses précalculées par tour de pédale : 5° d'écart, interpolées entre deux échantillons. */
const SAMPLES = 72;
const TAU = Math.PI * 2;

/**
 * Table de poses d'un couple vélo et avatar : rotation locale de chaque os et position du bassin, pour chaque angle
 * échantillonné. Calculée une fois, partagée par tous les coureurs qui roulent sur ce couple ; l'animation par image
 * se réduit à une interpolation, sans calcul de cinématique inverse ni allocation.
 */
interface PoseTable {
  quats: Float32Array;
  roots: Float32Array;
}

const tables = new WeakMap<RiderAssets, PoseTable>();
const standingTables = new WeakMap<RiderAssets, PoseTable>();

/** Inclinaison latérale du vélo à chaque coup de pédale en danseuse, en radians. */
const STAND_LEAN = (4 * Math.PI) / 180;
/** Vitesse de transition entre assis et danseuse, en 1/s (environ 0,4 s). */
const STAND_RATE = 2.5;

function nodePos(root: THREE.Object3D, name: string): THREE.Vector3 {
  const node = root.getObjectByName(name);
  if (!node) throw new Error(`modèle de vélo incomplet : nœud ${name} absent`);
  root.updateMatrixWorld(true);
  return node.getWorldPosition(new THREE.Vector3()).applyMatrix4(root.matrixWorld.clone().invert());
}

/** Points d'appui lus dans le modèle de vélo (contrat de `asset-contract.ts`). */
export function readBikeFit(bike: THREE.Object3D): BikeFit {
  const bb = nodePos(bike, BIKE_NODE.crankset);
  const pedal = nodePos(bike, BIKE_NODE.pedalL);
  return {
    saddle: nodePos(bike, BIKE_NODE.saddle),
    hoodL: nodePos(bike, BIKE_NODE.hoodL),
    hoodR: nodePos(bike, BIKE_NODE.hoodR),
    bb,
    crankLength: Math.hypot(pedal.y - bb.y, pedal.z - bb.z),
    pedalHalfWidth: Math.abs(pedal.x - bb.x),
  };
}

function buildTable(fit: BikeFit, stance: Stance): PoseTable {
  const n = SKELETON.length;
  const quats = new Float32Array(SAMPLES * n * 4);
  const roots = new Float32Array(SAMPLES * 3);
  const torso = solveTorsoAngle(fit, undefined, stance);
  const m = new THREE.Matrix4();
  const world = SKELETON.map(() => new THREE.Quaternion());
  const local = new THREE.Quaternion();
  const toQuat = (b: Basis, out: THREE.Quaternion) =>
    out.setFromRotationMatrix(m.makeBasis(new THREE.Vector3(b.x.x, b.x.y, b.x.z), new THREE.Vector3(b.y.x, b.y.y, b.y.z), new THREE.Vector3(b.z.x, b.z.y, b.z.z)));
  const index = Object.fromEntries(SKELETON.map((b, i) => [b.bone, i]));
  for (let k = 0; k < SAMPLES; k++) {
    const pose = solvePose(fit, (k / SAMPLES) * TAU, torso, undefined, stance);
    SKELETON.forEach((def, i) => {
      toQuat(pose.bases[def.bone], world[i]!);
      if (def.parent) local.copy(world[index[def.parent]!]!).invert().multiply(world[i]!);
      else local.copy(world[i]!);
      local.toArray(quats, (k * n + i) * 4);
    });
    const r = pose.joints.root;
    roots.set([r.x, r.y, r.z], k * 3);
  }
  return { quats, roots };
}

/**
 * Coureur : vélo et avatar à squelette, pédalage à la cadence réelle. Origine au sol sous le pédalier, l'avant
 * vers +Z. Toute la géométrie est partagée avec les autres coureurs ; seule la matière (les couleurs) est propre.
 */
export class Rider {
  readonly group = new THREE.Group();
  readonly material: RegionMaterial;
  /** Vélo et avatar : penché autour de la ligne de contact des pneus, sans toucher au placement de `group`. */
  private readonly rig = new THREE.Group();
  private crank = Math.PI / 2;
  /** Part de danseuse, 0 assis à 1 debout sur les pédales. */
  private stand = 0;
  private standTable: PoseTable | null = null;
  private readonly assets: RiderAssets;
  private readonly frontWheel: THREE.Object3D;
  private readonly rearWheel: THREE.Object3D;
  private readonly crankset: THREE.Object3D;
  private readonly pedalL: THREE.Object3D;
  private readonly pedalR: THREE.Object3D;
  private readonly bones: THREE.Object3D[];
  private readonly table: PoseTable;
  private readonly wheelRadius: number;
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();
  private readonly qc = new THREE.Quaternion();

  constructor(assets: RiderAssets, kit?: Kit) {
    this.assets = assets;
    const bike = assets.bike.clone(true);
    const avatar = cloneSkinned(assets.avatar) as THREE.Group;
    this.material = new RegionMaterial(kit);
    for (const root of [bike, avatar]) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = this.material;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
    }
    this.rig.add(bike, avatar);
    this.group.add(this.rig);

    const find = (root: THREE.Object3D, name: string) => {
      const o = root.getObjectByName(name);
      if (!o) throw new Error(`modèle incomplet : ${name} absent`);
      return o;
    };
    this.frontWheel = find(bike, BIKE_NODE.frontWheel);
    this.rearWheel = find(bike, BIKE_NODE.rearWheel);
    this.crankset = find(bike, BIKE_NODE.crankset);
    this.pedalL = find(bike, BIKE_NODE.pedalL);
    this.pedalR = find(bike, BIKE_NODE.pedalR);
    this.bones = SKELETON.map((b) => find(avatar, b.bone));
    this.wheelRadius = this.frontWheel.position.y;

    let table = tables.get(assets);
    if (!table) tables.set(assets, (table = buildTable(readBikeFit(assets.bike), SEATED)));
    this.table = table;
    this.pose();
  }

  /** Fait tourner pédalier et roues : `cadenceRpm` en tours par minute, `speedMs` en m/s. */
  animate(dtS: number, cadenceRpm: number, speedMs: number, standing = false) {
    this.crank = (this.crank + (cadenceRpm / 60) * TAU * dtS) % TAU;
    // Assis, le vélo reste droit. En danseuse, il penche à l'opposé de la jambe qui pousse, au rythme du pédalage.
    const want = standing ? 1 : 0;
    this.stand += Math.sign(want - this.stand) * Math.min(Math.abs(want - this.stand), dtS * STAND_RATE);
    if (this.stand > 0 && !this.standTable) {
      let t = standingTables.get(this.assets);
      if (!t) standingTables.set(this.assets, (t = buildTable(readBikeFit(this.assets.bike), STANDING)));
      this.standTable = t;
    }
    this.rig.rotation.z = -STAND_LEAN * this.stand * Math.sin(this.crank);
    const spin = (speedMs / this.wheelRadius) * dtS;
    this.frontWheel.rotation.x += spin;
    this.rearWheel.rotation.x += spin;
    this.pose();
  }

  /** Angle du pédalier imposé (aperçus, captures). */
  setCrank(angle: number) {
    this.crank = ((angle % TAU) + TAU) % TAU;
    this.pose();
  }

  private pose() {
    const a = this.crank;
    this.crankset.rotation.x = a;
    // Les pédales suivent l'inclinaison du pied ; elles sont portées par le pédalier, d'où la soustraction.
    this.pedalL.rotation.x = footPitch(a) - a;
    this.pedalR.rotation.x = footPitch(a + Math.PI) - a;

    const f = (a / TAU) * SAMPLES;
    const k0 = Math.floor(f) % SAMPLES;
    const k1 = (k0 + 1) % SAMPLES;
    const t = f - Math.floor(f);
    const n = this.bones.length;
    const st = this.stand > 0 ? this.standTable : null;
    const w = st ? this.stand : 0;
    for (let i = 0; i < n; i++) {
      this.qa.fromArray(this.table.quats, (k0 * n + i) * 4);
      this.qb.fromArray(this.table.quats, (k1 * n + i) * 4);
      this.qa.slerp(this.qb, t);
      if (st) {
        this.qc.fromArray(st.quats, (k0 * n + i) * 4);
        this.qb.fromArray(st.quats, (k1 * n + i) * 4);
        this.qc.slerp(this.qb, t);
        this.qa.slerp(this.qc, w);
      }
      this.bones[i]!.quaternion.copy(this.qa);
    }
    const r0 = k0 * 3;
    const r1 = k1 * 3;
    const { roots } = this.table;
    const p = this.bones[0]!.position;
    p.set(
      roots[r0]! + (roots[r1]! - roots[r0]!) * t,
      roots[r0 + 1]! + (roots[r1 + 1]! - roots[r0 + 1]!) * t,
      roots[r0 + 2]! + (roots[r1 + 2]! - roots[r0 + 2]!) * t,
    );
    if (st) {
      const sr = st.roots;
      p.x += (sr[r0]! + (sr[r1]! - sr[r0]!) * t - p.x) * w;
      p.y += (sr[r0 + 1]! + (sr[r1 + 1]! - sr[r0 + 1]!) * t - p.y) * w;
      p.z += (sr[r0 + 2]! + (sr[r1 + 2]! - sr[r0 + 2]!) * t - p.z) * w;
    }
  }
}
