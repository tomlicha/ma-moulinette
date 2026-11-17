import * as THREE from 'three/webgpu';
import type { RemoteRiderView } from '../net/world-client';
import type { RiderAssets } from './assets';
import { Rider } from './rider';
import type { Kit } from './region-material';
import { declutter, laneOf } from './others-model';
import { forwardOf, sideOf, type WorldLayout } from './world-layout';

export { laneOf } from './others-model';

/** Au-delà de cette distance du joueur, un autre coureur n'est plus dessiné, en m. */
export const SHOW_WITHIN_M = 220;
/** Coureurs dessinés au plus : les plus proches. Chacun est un squelette animé et une ombre. */
export const MAX_SHOWN = 16;
/** Les noms disparaissent au-delà de cette distance, en m : plus loin, ils s'empilent sans rien dire. */
export const TAG_WITHIN_M = 140;
/** Raideur du suivi du cap, en 1/s (comme le joueur local). */
const HEADING_RATE = 5;
/** Hauteur du nom au-dessus de la route, en m. */
const TAG_HEIGHT_M = 2;
const GOLDEN = 0.618033988749895;

/** Nom d'un coureur et sa place à l'écran, pour le HUD (pixels CSS du canevas). */
export interface RiderTag {
  slot: number;
  name: string;
  x: number;
  y: number;
  /** Distance au joueur, en m. */
  distanceM: number;
}

const wrapPi = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

/** Maillot d'un coureur : une teinte par place, espacées par le nombre d'or pour que deux voisins se distinguent. */
export function kitFor(slot: number): Kit {
  const hue = (slot * GOLDEN) % 1;
  const jersey = new THREE.Color().setHSL(hue, 0.7, 0.52).getHex();
  const frame = new THREE.Color().setHSL((hue + 0.5) % 1, 0.55, 0.42).getHex();
  return { jersey: { color: jersey }, frame: { color: frame } };
}

/** Un coureur posé dans la scène (coordonnées du monde dessiné). */
export interface PlacedRider {
  slot: number;
  name: string;
  x: number;
  y: number;
  z: number;
  distanceM: number;
}

interface Shown {
  rider: Rider;
  heading: number;
  ready: boolean;
}

/**
 * Les autres coureurs dans la scène : un `Rider` par coureur proche, créé à l'arrivée, retiré au départ ou quand il
 * s'éloigne. Les positions viennent du client réseau (déjà lissées) ; ici on ne fait que les poser sur le relief
 * dessiné, comme le joueur local, et animer le pédalage à leur cadence.
 */
export class OthersLayer {
  readonly group = new THREE.Group();
  private readonly shown = new Map<number, Shown>();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly assets: RiderAssets,
    private readonly layout: WorldLayout,
    private readonly laneM: number,
  ) {}

  /** Nombre de coureurs actuellement dans la scène. */
  get count(): number {
    return this.shown.size;
  }

  /** Pose les coureurs de `riders` autour du joueur en `self` ; renvoie les plus proches, ceux qui sont dessinés. */
  place(dtS: number, riders: readonly RemoteRiderView[], self: THREE.Vector3): PlacedRider[] {
    const near: { r: RemoteRiderView; dist: number }[] = [];
    for (const r of riders) {
      const dist = Math.hypot(r.point.x - self.x, r.point.z - self.z);
      if (dist <= SHOW_WITHIN_M) near.push({ r, dist });
    }
    near.sort((a, b) => a.dist - b.dist);
    near.length = Math.min(near.length, MAX_SHOWN);

    const keep = new Set(near.map((n) => n.r.slot));
    for (const [slot, s] of this.shown) {
      if (keep.has(slot)) continue;
      this.group.remove(s.rider.group);
      s.rider.material.dispose();
      this.shown.delete(slot);
    }

    const placed: PlacedRider[] = [];
    for (const { r, dist } of near) {
      let s = this.shown.get(r.slot);
      if (!s) {
        s = { rider: new Rider(this.assets, kitFor(r.slot)), heading: r.point.heading, ready: false };
        this.shown.set(r.slot, s);
        this.group.add(s.rider.group);
      }
      s.heading = s.ready ? s.heading + wrapPi(r.point.heading - s.heading) * (1 - Math.exp(-dtS * HEADING_RATE)) : r.point.heading;
      s.ready = true;

      const f = forwardOf(s.heading);
      const side = sideOf(s.heading);
      const lane = laneOf(r.slot, this.laneM);
      const y = this.layout.y(r.point.y);
      const rise = this.layout.y(r.point.y + (2 * r.gradePct) / 100) - y; // montée sur 2 m, relief exagéré compris
      const x = r.point.x + side.x * lane;
      const z = r.point.z + side.z * lane;
      s.rider.group.position.set(x, y + 0.04, z);
      s.rider.group.lookAt(x + f.x * 2, y + 0.04 + rise, z + f.z * 2);
      s.rider.animate(dtS, r.riding ? r.cadenceRpm : 0, r.speedMs);
      placed.push({ slot: r.slot, name: r.name, x, y, z, distanceM: dist });
    }
    return placed;
  }

  /** Noms à afficher : les coureurs proches et visibles, avec leur place à l'écran (`width` × `height`, pixels CSS du canevas). */
  tags(placed: readonly PlacedRider[], camera: THREE.Camera, width: number, height: number): RiderTag[] {
    const tags: RiderTag[] = [];
    for (const p of placed) {
      if (p.distanceM > TAG_WITHIN_M) continue;
      this.tmp.set(p.x, p.y + TAG_HEIGHT_M, p.z).project(camera);
      if (this.tmp.z <= 0 || this.tmp.z >= 1 || Math.abs(this.tmp.x) > 1.05 || Math.abs(this.tmp.y) > 1.05) continue;
      tags.push({
        slot: p.slot,
        name: p.name,
        x: ((this.tmp.x + 1) / 2) * width,
        y: ((1 - this.tmp.y) / 2) * height,
        distanceM: p.distanceM,
      });
    }
    return declutter(tags); // `placed` va du plus proche au plus loin : le proche garde son nom
  }

  dispose() {
    for (const s of this.shown.values()) s.rider.material.dispose();
    this.shown.clear();
    this.group.clear();
  }
}
