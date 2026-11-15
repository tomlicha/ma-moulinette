import * as THREE from 'three/webgpu';
import type { Journey } from '../sim/journey';
import { createRenderer, type Backend } from './renderer';
import { loadRiderAssets, type RiderAssets } from './assets';
import { Rider } from './rider';
import { buildWorld, CAMERA_FAR_M, WORLD_HIGH, WORLD_LOW, type World } from './world';
import { DEFAULT_RELIEF, forwardOf, sideOf, WorldLayout } from './world-layout';
import { IntervalGates } from './interval-gate';
import { fovFor, FOV_BASE, LOOK_AHEAD_M, lookHeight, swayPhaseStep, swayRoll } from './ride-feel';
import type { IntervalGate } from '../workout/gate';

export type Quality = 'high' | 'low';

export interface ViewState {
  /** Distance parcourue donnée par la simulation, en m. */
  distanceM: number;
  speedKmh: number;
  cadenceRpm: number;
}

export interface RenderStats {
  backend: Backend;
  fps: number;
  frameP50Ms: number;
  frameP95Ms: number;
  triangles: number;
  drawCalls: number;
}

const FRAME_WINDOW = 240;
const STATS_EVERY_MS = 500;
/** Plafond du pas de temps d'animation : un onglet qui reprend ne doit pas téléporter le cycliste. */
const MAX_DT_S = 0.1;
/** Position latérale du coureur : voie de droite (le côté négatif de l'axe latéral), à côté de la ligne centrale. */
const LANE_M = -1.6;
/** Raideur du suivi du cap, en 1/s : le cycliste tourne dans un carrefour sans à-coup. */
const HEADING_RATE = 5;

const wrapPi = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]! : 0;

/** Vue 3D de la sortie : monde, cycliste et caméra de poursuite pilotés par l'état de la simulation. */
export class RideView {
  onStats?: (s: RenderStats) => void;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.3, CAMERA_FAR_M);
  private readonly layout: WorldLayout;
  private readonly rider: Rider;
  private readonly sky: THREE.Mesh;
  private readonly world: World;
  private readonly gates: IntervalGates;
  private readonly frameTimes: number[] = [];
  private readonly resizeObserver: ResizeObserver;

  private state: ViewState = { distanceM: 0, speedKmh: 0, cadenceRpm: 0 };
  private dist = 0;
  private lastFrame = 0;
  private lastStats = 0;
  private raf = 0;
  private active = true;
  private cameraReady = false;
  private heading = 0;
  private headingReady = false;
  private fov = FOV_BASE;
  private swayPhase = 0;

  private constructor(
    private readonly renderer: THREE.WebGPURenderer,
    readonly backend: Backend,
    private readonly canvas: HTMLCanvasElement,
    private readonly journey: Journey,
    quality: Quality,
    assets: RiderAssets,
    relief: number,
  ) {
    this.rider = new Rider(assets);
    this.layout = new WorldLayout(journey.network, relief);
    const world = buildWorld(this.layout, this.scene, quality === 'high' ? WORLD_HIGH : WORLD_LOW, assets);
    this.sky = world.sky;
    this.world = world;
    this.gates = new IntervalGates(journey, this.layout);
    this.scene.add(this.rider.group, this.gates.group);
    renderer.setPixelRatio(quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.place(0, 0);
    world.prime(this.p.x, this.p.z); // le décor autour du départ est là dès la première image
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  static async create(
    canvas: HTMLCanvasElement,
    journey: Journey,
    opts: { forceWebGL?: boolean; quality?: Quality; relief?: number } = {},
  ): Promise<RideView> {
    const [{ renderer, backend }, assets] = await Promise.all([createRenderer(canvas, opts.forceWebGL), loadRiderAssets()]);
    return new RideView(renderer, backend, canvas, journey, opts.quality ?? 'high', assets, opts.relief ?? DEFAULT_RELIEF);
  }

  setState(s: ViewState) {
    this.state = s;
    // La simulation tourne à 10 Hz : on interpole entre ses mises à jour et on recale si l'écart devient grand.
    if (Math.abs(s.distanceM - this.dist) > 30) this.dist = s.distanceM;
  }

  /** Porte du prochain palier de séance, ou rien hors séance. */
  setGate(g: IntervalGate | undefined) {
    this.gates.set(g);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }

  private resize() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private readonly p = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private roll = 0;

  /**
   * Pose le cycliste à la distance `d` du trajet, incliné par la pente (celle du relief exagéré, pas celle de la
   * physique : il suit la route telle qu'elle est dessinée). Le cap est lissé pour traverser un carrefour sans à-coup.
   */
  private place(d: number, dtS: number) {
    const pt = this.journey.pointAt(d);
    if (!this.headingReady) {
      this.heading = pt.heading;
      this.headingReady = true;
    } else {
      this.heading += wrapPi(pt.heading - this.heading) * (1 - Math.exp(-dtS * HEADING_RATE));
    }
    const f = forwardOf(this.heading);
    const side = sideOf(this.heading);
    const y = this.layout.y(pt.y);
    const rise = this.layout.y(this.journey.pointAt(d + 2).y) - y; // montée sur 2 m
    this.p.set(pt.x + side.x * LANE_M, y, pt.z + side.z * LANE_M);
    this.rider.group.position.set(this.p.x, this.p.y + 0.04, this.p.z);
    this.rider.group.lookAt(this.p.x + f.x * 2, this.p.y + 0.04 + rise, this.p.z + f.z * 2);
  }

  /**
   * Caméra de poursuite : 4,4 m derrière, 1,85 m au-dessus, et le regard posé sur la route 14 m devant. Ce regard monte
   * avec la route (`lookHeight`) : en côte la vue se redresse, l'horizon descend à l'écran et la route se dresse devant ;
   * en descente elle plonge. Le champ de vision se resserre en côte et s'élargit en descente et à grande vitesse.
   */
  private follow(dtS: number) {
    const f = forwardOf(this.heading);
    const side = sideOf(this.heading);
    this.fwd.set(f.x, 0, f.z);
    // Balancement léger de la caméra avec celui du coureur.
    const sway = this.roll * Math.sin(this.swayPhase) * 1.6;
    this.camTarget.set(
      this.p.x - this.fwd.x * 4.4 + side.x * sway,
      this.p.y + 1.85,
      this.p.z - this.fwd.z * 4.4 + side.z * sway,
    );
    if (!this.cameraReady) {
      this.camera.position.copy(this.camTarget);
      this.cameraReady = true;
    } else {
      this.camera.position.lerp(this.camTarget, 1 - Math.exp(-dtS * 7));
    }
    const aheadY = this.layout.y(this.journey.pointAt(this.dist + LOOK_AHEAD_M).y);
    this.look.set(
      this.p.x + this.fwd.x * LOOK_AHEAD_M,
      lookHeight(this.p.y, aheadY),
      this.p.z + this.fwd.z * LOOK_AHEAD_M,
    );
    this.camera.lookAt(this.look);

    const target = fovFor(this.journey.gradeAt(this.dist), this.state.speedKmh);
    this.fov += (target - this.fov) * (1 - Math.exp(-dtS * 1.5));
    if (Math.abs(this.camera.fov - this.fov) > 0.02) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.sky.position.copy(this.camera.position);
  }

  /** Hors de l'écran de sortie, la vue ne dessine plus : inutile de faire chauffer le GPU pour un canevas caché. */
  setActive(on: boolean) {
    this.active = on;
    if (on && !this.raf) {
      this.lastFrame = 0;
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
  }

  private frame(now: number) {
    if (!this.active) {
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dtMs = this.lastFrame ? now - this.lastFrame : 16.7;
    this.lastFrame = now;
    const dt = Math.min(dtMs / 1000, MAX_DT_S);

    const speedMs = this.state.speedKmh / 3.6;
    this.dist += speedMs * dt;
    this.dist += (this.state.distanceM - this.dist) * Math.min(1, dt * 3); // recalage doux sur la simulation
    this.place(this.dist, dt);
    // Le coureur se balance au rythme du pédalage, d'autant plus que la côte est raide et la cadence basse.
    this.swayPhase += swayPhaseStep(this.state.cadenceRpm, dt);
    this.roll = swayRoll(this.journey.gradeAt(this.dist), this.state.cadenceRpm);
    this.rider.group.rotateZ(this.roll * Math.sin(this.swayPhase));
    this.rider.animate(dt, this.state.cadenceRpm, speedMs);
    this.gates.update(dt, this.dist);
    this.world.update(dt, this.p);
    this.follow(dt);
    this.renderer.render(this.scene, this.camera);

    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > FRAME_WINDOW) this.frameTimes.shift();
    if (now - this.lastStats >= STATS_EVERY_MS) {
      this.lastStats = now;
      const sorted = [...this.frameTimes].sort((a, b) => a - b);
      const mean = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      const info = this.renderer.info.render;
      this.onStats?.({
        backend: this.backend,
        fps: 1000 / mean,
        frameP50Ms: percentile(sorted, 0.5),
        frameP95Ms: percentile(sorted, 0.95),
        triangles: info.triangles,
        drawCalls: info.drawCalls,
      });
    }
  }
}
