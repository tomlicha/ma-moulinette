import * as THREE from 'three/webgpu';
import type { Journey } from '../sim/journey';
import { createRenderer, type Backend } from './renderer';
import { ambianceFor, type Mood } from './ambiance';
import { loadRiderAssets, type RiderAssets } from './assets';
import { Rider } from './rider';
import { Background } from './background';
import { buildWorldSteps, CAMERA_FAR_M, WORLD_HIGH, WORLD_LOW, type World } from './world';
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

  private readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.3, CAMERA_FAR_M);
  private readonly layout: WorldLayout;
  private readonly rider: Rider;
  private readonly sky: THREE.Mesh;
  private readonly world: World;
  private mood: Mood = 'day';
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
    private readonly scene: THREE.Scene,
    layout: WorldLayout,
    world: World,
  ) {
    this.rider = new Rider(assets);
    this.layout = layout;
    this.sky = world.sky;
    this.world = world;
    this.gates = new IntervalGates(journey, this.layout);
    this.scene.add(this.rider.group, this.gates.group);
    renderer.setPixelRatio(quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    addEventListener('resize', this.onWindowResize); // écran masqué : le canevas ne change pas, la fenêtre si (rotation)
    this.resizeObserver.observe(canvas);
    this.resize();
    this.place(0, 0);
  }

  /**
   * Crée la vue sans bloquer la page : le monde (relief, route, décor autour du départ) se construit par petites
   * tranches dans `background`, entre lesquelles le navigateur traite clics et affichage. La vue ne dessine rien avant
   * d'être complète. `background.hurry()` accélère la fin quand l'écran de sortie s'ouvre avant.
   */
  static async create(
    canvas: HTMLCanvasElement,
    journey: Journey,
    opts: { forceWebGL?: boolean; quality?: Quality; relief?: number } = {},
    background = new Background(),
  ): Promise<RideView> {
    const quality = opts.quality ?? 'high';
    // Le moteur et les modèles arrivent pendant que le monde se construit.
    const ready = Promise.all([
      createRenderer(canvas, opts.forceWebGL).then((r) => (performance.mark('ride:gpu'), r)),
      loadRiderAssets().then((a) => (performance.mark('ride:assets'), a)),
    ]);
    ready.catch(() => {}); // une erreur est relevée plus bas ; pas de rejet orphelin si la construction échoue d'abord
    const layout = await background.run(WorldLayout.build(journey.network, opts.relief ?? DEFAULT_RELIEF));
    performance.mark('ride:layout');
    const [{ renderer, backend }, assets] = await ready;
    performance.mark('ride:renderer');
    const scene = new THREE.Scene();
    const world = await background.run(buildWorldSteps(layout, scene, quality === 'high' ? WORLD_HIGH : WORLD_LOW, assets));
    performance.mark('ride:world');
    const view = new RideView(renderer, backend, canvas, journey, quality, assets, scene, layout, world);
    // Avant la première image, seulement les abords du départ ; le reste du relief et du décor (jusqu'à 1,2 km) suit en
    // tâche de fond, sans presser, même si l'écran de sortie est ouvert : il ne doit pas voler d'images.
    await background.run(world.primeSteps(view.p.x, view.p.z, true));
    performance.mark('ride:prime');
    // Shaders compilés d'avance, la caméra posée comme à la première image (seul ce qu'elle voit est compilé) : sinon le
    // premier `render()` les compile tous d'un coup et fige la page à l'ouverture de la sortie. `compileAsync` construit
    // les matériaux objet par objet en rendant la main entre deux, et crée les pipelines de façon asynchrone.
    view.follow(0);
    await renderer.compileAsync(scene, view.camera).catch((e: unknown) => console.warn('rendu 3D : précompilation des shaders impossible', e));
    performance.mark('ride:compile');
    view.raf = requestAnimationFrame((t) => view.frame(t));
    view.warmUpWhenIdle();
    void new Background().run(world.fillSteps(view.p.x, view.p.z)).catch((e: unknown) => console.warn('rendu 3D : décor lointain incomplet', e));
    return view;
  }

  /**
   * `compileAsync` ne prépare ni les ombres ni la passe de sortie (tons et couleurs vers l'écran) : elles se compilent au
   * premier rendu, d'un bloc. Si l'écran de sortie n'est pas encore ouvert, on fait ce premier rendu dans un temps mort
   * de la page (canevas masqué, rien ne s'affiche) : l'ouverture n'a plus rien à compiler.
   */
  private warmUpWhenIdle() {
    const warm = () => {
      if (this.drawn || this.disposed) return; // la sortie a déjà dessiné : plus rien à préparer
      this.follow(0);
      this.renderer.render(this.scene, this.camera);
      performance.mark('ride:warm');
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 3000 });
    else setTimeout(warm, 500);
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
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    removeEventListener('resize', this.onWindowResize);
    this.renderer.dispose();
  }

  private size = { w: 0, h: 0 };
  private drawn = false;
  private disposed = false;
  private readonly onWindowResize = () => this.resize();

  /**
   * Taille du canevas. Écran de sortie masqué (vue construite pendant qu'on est sur l'accueil), le canevas mesure 0 :
   * on prend la fenêtre, qu'il occupe en entier une fois affiché. Les shaders sont alors compilés pour le vrai cadrage et
   * les tampons d'image ont déjà leur taille : rien à refaire à l'ouverture. Même taille, rien à faire (`setSize`
   * réalloue les tampons à chaque appel).
   */
  private resize() {
    const shown = this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0;
    const w = Math.max(1, shown ? this.canvas.clientWidth : window.innerWidth);
    const h = Math.max(1, shown ? this.canvas.clientHeight : window.innerHeight);
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
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
    // L'ambiance suit le parcours, qui peut changer sur l'accueil pendant que la vue tourne.
    const mood = this.journey.course?.ambiance ?? 'day';
    if (mood !== this.mood) {
      this.mood = mood;
      this.world.setAmbiance(ambianceFor(mood));
    }
    this.world.update(dt, this.p);
    this.follow(dt);
    this.renderer.render(this.scene, this.camera);
    if (!this.drawn) {
      this.drawn = true;
      performance.mark('ride-first-frame'); // relevé par tools/audit/startup.cjs
    }

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
