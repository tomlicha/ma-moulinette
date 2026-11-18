/**
 * Aperçu des modèles, pour les comparer à la planche de style.
 *
 * Paramètres d'URL :
 * - `shot=lineup` (défaut) : trois coureurs, trois quarts avant, profil, trois quarts arrière ;
 *   `shot=close` : un coureur en gros plan ; `shot=chase` : vue de poursuite comme en jeu.
 * - `yaw` (degrés) et `zoom` pour `shot=close`, `crank` (degrés) pour figer le pédalier, `spin=1` pour animer.
 * - `shot=marie` : Marie dans le vrai décor, vue de près (`yaw`, `zoom`) ; `shot=richard` : Richard et son escalier (`t` : secondes d'animation avant la capture) ; `shot=marie-chase` : vue de poursuite à son approche.
 * - `shot=ride` : vue de poursuite sur le réseau, à `d` m du départ (défaut 0). `route=col,descente` force les choix de
 *   carrefour dans l'ordre (identifiants de routes) ; `relief` règle l'exagération du relief (1 = réel, défaut 1,6).
 *   `course=rive` choisit le parcours (`col` par défaut). `shot=map` : le réseau vu du dessus (lignes de route), pour juger le tracé.
 * - `mood=day|sunset` force l'ambiance (par défaut celle du parcours `course`).
 * - `quality=low` : profil bas du monde (par défaut le profil haut, comme l'application).
 * - `webgl` pour forcer le repli WebGL2 ; `shadows=0` pour couper les ombres (juger le modelé sans auto-ombrage).
 * - `gate=z1..z6|free` pose la porte d'un changement de palier `ahead` m devant le cycliste (60 par défaut), comme en séance.
 * - `shot=velodrome` : le vélodrome de Roubaix seul ; `view=aerial|porte|tribune|piste|virage|entree|facade|podium|parking`,
 *   `anim=0` fige les coureurs (le décor s'anime toujours, `t` en avance l'horloge), `budget` affiche les triangles par partie.
 * - `pale` : cuissard gris clair sur le premier coureur, pour juger le modelé du bassin, invisible en noir.
 */
import * as THREE from 'three/webgpu';
import { ambianceFor, type Mood } from '../../src/render/ambiance';
import { loadRiderAssets } from '../../src/render/assets';
import type { Kit } from '../../src/render/region-material';
import { createRenderer } from '../../src/render/renderer';
import { Rider } from '../../src/render/rider';
import { buildWorld, CAMERA_FAR_M, WORLD_HIGH, WORLD_LOW } from '../../src/render/world';
import { fovFor, LOOK_AHEAD_M, lookHeight } from '../../src/render/ride-feel';
import { DEFAULT_RELIEF, forwardOf, sideOf, WorldLayout } from '../../src/render/world-layout';
import { COL_DES_ERABLES } from '../../src/sim/courses/col-des-erables';
import { IntervalGates } from '../../src/render/interval-gate';
import type { Zone } from '../../src/workout/profile';
import { Journey } from '../../src/sim/journey';
import { DAY } from '../../src/render/ambiance';
import { buildVelodrome } from '../../src/render/velodrome';
import { VELODROME } from '../../src/sim/velodrome-track';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
const shot = params.get('shot') ?? 'lineup';

const KITS: Kit[] = [
  params.has('pale') ? { shorts: { color: 0xc9ccd2 } } : {},
  {
    jersey: { color: 0xf2c230 }, jerseyAlt: { color: 0x15171c }, jerseyAccent: { color: 0xf2c230 }, sock: { color: 0xf2c230 },
    frame: { color: 0xf08a3c }, frameAlt: { color: 0x15171c }, helmet: { color: 0x15171c }, helmetAlt: { color: 0xf2c230 },
    lens: { color: 0x4cc9f0 }, skin: { color: 0xb07a55 },
  },
  {
    jersey: { color: 0x3b82d6 }, jerseyAlt: { color: 0xf4f4f0 }, jerseyAccent: { color: 0x0e1726 }, sock: { color: 0x3b82d6 },
    frame: { color: 0xf2c230 }, frameAlt: { color: 0x0e1726 }, helmet: { color: 0x0e1726 }, helmetAlt: { color: 0x3b82d6 },
    skin: { color: 0x8d5a3b },
  },
];

const canvas = document.getElementById('view') as HTMLCanvasElement;
const { renderer, backend } = await createRenderer(canvas, params.has('webgl'));
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe4e6ea);
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: 0xf1f2f4, roughness: 1 }));
ground.receiveShadow = true;
const inWorld = ['marie', 'richard', 'marie-chase', 'ride', 'map', 'velodrome'].includes(shot); // le vrai décor apporte son sol et ses lumières
if (!inWorld) {
  scene.add(ground);
  scene.add(new THREE.HemisphereLight(0xeef4ff, 0x9a9488, 1.6));
}
const sun = new THREE.DirectionalLight(0xfff3e2, 2.6);
sun.position.set(3, 6, 4);
sun.castShadow = params.get('shadows') !== '0';
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -4;
sun.shadow.camera.right = 4;
sun.shadow.camera.top = 4;
sun.shadow.camera.bottom = -4;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
if (!inWorld) scene.add(sun);

const assets = await loadRiderAssets();
const crank = params.has('crank') ? (num('crank', 0) * Math.PI) / 180 : undefined;
const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 100);
const riders: Rider[] = [];
const place = (kit: Kit, x: number, z: number, yawDeg: number, y = 0) => {
  const r = new Rider(assets, kit);
  r.group.position.set(x, y, z);
  r.group.rotation.y = (yawDeg * Math.PI) / 180;
  if (crank !== undefined) r.setCrank(crank);
  scene.add(r.group);
  riders.push(r);
  return r;
};

let world: ReturnType<typeof buildWorld> | undefined;
/** Animation propre à une vue (le vélodrome), appelée à chaque image. */
let tick: ((dtS: number) => void) | undefined;
let worldRider: { x: number; z: number } | undefined;

/** Roule le trajet jusqu'à `d`, en prenant aux carrefours les routes de `picks` dans l'ordre (sinon tout droit). */
function driveTo(journey: Journey, d: number, picks: string[]) {
  const queue = [...picks];
  for (let x = 0; x <= d; x += 10) {
    journey.update(x);
    const p = journey.pendingJunction(x);
    if (p && queue.length) {
      const i = p.options.findIndex((o) => o.edgeId === queue[0]);
      if (i >= 0) {
        journey.choose(i);
        queue.shift();
      }
    }
  }
  journey.update(d);
}

if (shot === 'marie' || shot === 'richard' || shot === 'marie-chase' || shot === 'ride' || shot === 'map') {
  const layout = new WorldLayout(COL_DES_ERABLES, num('relief', DEFAULT_RELIEF));
  world = buildWorld(layout, scene, params.get('quality') === 'low' ? WORLD_LOW : WORLD_HIGH, assets);
  const marieSpot = COL_DES_ERABLES.landmarks.find((l) => l.kind === 'marie')!;
  const richardSpot = COL_DES_ERABLES.landmarks.find((l) => l.kind === 'richard')!;
  const up = (v: number) => new THREE.Vector3(0, v, 0);

  if (shot === 'marie' || shot === 'richard') {
    const spot = shot === 'richard' ? richardSpot : marieSpot;
    const spotEdge = COL_DES_ERABLES.edges.get(spot.edge)!;
    const p = spotEdge.pointAt((spot as { s: number }).s);
    const h = spotEdge.headingAt((spot as { s: number }).s);
    const f = forwardOf(h);
    const sd = sideOf(h);
    const s = new THREE.Vector3(sd.x, 0, sd.z);
    const fv = new THREE.Vector3(f.x, 0, f.z);
    const ground = layout.groundY(p.x - sd.x * 5.6, p.z - sd.z * 5.6);
    const t = new THREE.Vector3(p.x, ground + (shot === 'richard' ? 1.0 : 0.55), p.z).addScaledVector(s, -5.6);
    const a = (num('yaw', 20) * Math.PI) / 180; // 0 : vu de la route, 90 : vu de l'arrière
    const dist = (shot === 'richard' ? 7 : 4.2) / num('zoom', 1);
    camera.fov = 40;
    camera.near = 0.1;
    camera.far = 9000;
    camera.position.copy(t).addScaledVector(s, Math.cos(a) * dist).addScaledVector(fv, -Math.sin(a) * dist).add(up(1.0));
    camera.lookAt(t);
    worldRider = { x: t.x, z: t.z };
  } else if (shot === 'map') {
    // Le réseau vu du dessus : une ligne par route, un disque par carrefour.
    const b = layout.bounds;
    const lines = new THREE.Group();
    for (const e of layout.edges) {
      const pts = e.sample(20).map((q) => new THREE.Vector3(q.x, 5, q.z));
      lines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff2d55 })));
    }
    scene.add(lines);
    camera.fov = 40;
    camera.near = 10;
    camera.far = 40000;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 1.15;
    camera.position.set(layout.center.x, span / (2 * Math.tan((camera.fov * Math.PI) / 360)), layout.center.z);
    camera.up.set(0, 0, -1);
    camera.lookAt(layout.center.x, 0, layout.center.z);
    worldRider = { x: layout.center.x, z: layout.center.z };
  } else {
    const journey = new Journey(COL_DES_ERABLES, params.get('course') ?? undefined);
    let d: number;
    if (shot === 'marie-chase') {
      // On prend le Col depuis le Moulin, puis on se place `before` m avant Marie.
      driveTo(journey, 0, []);
      const toMoulin = COL_DES_ERABLES.edges.get('vallee')!.lengthM;
      d = toMoulin + (marieSpot as { s: number }).s - num('before', 14);
      driveTo(journey, d, ['col']);
    } else {
      d = num('d', 0);
      driveTo(journey, d, (params.get('route') ?? '').split(',').filter(Boolean));
    }
    const pt = journey.pointAt(d);
    const ahead = journey.pointAt(d + 2);
    const f = forwardOf(pt.heading);
    const sd = sideOf(pt.heading);
    // Comme `RideView.place` : sur une piste de vélodrome, le béton relevé porte le coureur, qui se penche.
    const lx = pt.x + sd.x * -1.6;
    const lz = pt.z + sd.z * -1.6;
    const surf = layout.surfaceAt(lx, lz);
    const y = layout.y(pt.y) + surf.lift;
    const p = new THREE.Vector3(lx, y, lz);
    const rider = place({}, p.x, p.z, 0, p.y + 0.04);
    const aheadLift = layout.surfaceAt(ahead.x + sd.x * -1.6, ahead.z + sd.z * -1.6).lift;
    rider.group.lookAt(p.x + f.x * 2, p.y + 0.04 + (layout.y(ahead.y) + aheadLift - y), p.z + f.z * 2);
    if (surf.bank) rider.group.rotateZ(-surf.bank);
    // Même caméra que dans l'application (`RideView.follow`) : regard sur la route devant, champ de vision selon la pente.
    camera.fov = fovFor(journey.gradeAt(d), num('speed', 25));
    camera.near = 0.3;
    camera.far = CAMERA_FAR_M;
    const back = num('camback', 4.4);
    const lookPt = journey.pointAt(d + LOOK_AHEAD_M);
    const aheadY = layout.y(lookPt.y) + layout.surfaceAt(lookPt.x, lookPt.z).lift;
    camera.position.set(p.x - f.x * back, p.y + num('camup', 1.85), p.z - f.z * back);
    camera.lookAt(p.x + f.x * LOOK_AHEAD_M, lookHeight(p.y, aheadY), p.z + f.z * LOOK_AHEAD_M);
    worldRider = { x: p.x, z: p.z };
    if (params.has('gate')) {
      const gates = new IntervalGates(journey, layout);
      gates.set({ key: 1, zone: params.get('gate') as Zone, aheadM: num('ahead', 60) });
      gates.update(2, d); // deux secondes de fondu : la porte est pleinement visible
      scene.add(gates.group);
    }
  }
  world.prime(worldRider.x, worldRider.z);
  // Ambiance du parcours choisi, ou celle de `mood=day|sunset`.
  world.setAmbiance(ambianceFor((params.get('mood') as Mood | null) ?? COL_DES_ERABLES.course(params.get('course') ?? undefined)?.ambiance));
  world.sky.position.copy(camera.position); // comme `RideView.follow` : le ciel suit la caméra, sinon le plan lointain le coupe
  // `hide=0,1` masque des couches du monde (terrain, route, décor, clôture, arches, montagnes, nuages, fond) pour isoler un défaut.
  for (const k of (params.get('hide') ?? '').split(',').filter(Boolean)) {
    const layer = world.group.children[Number(k)];
    if (layer) layer.visible = false;
  }
} else if (shot === 'velodrome') {
  // Le vélodrome seul, sur une prairie, à la lumière de jour du monde. `view` : aerial (défaut), tribune, piste, virage, entree, facade.
  const v = buildVelodrome();
  scene.add(v.group);
  scene.background = DAY.horizon.clone();
  scene.fog = new THREE.FogExp2(DAY.horizon.getHex(), 0.0005);
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(4000, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: 0x6aa84a, roughness: 1 }));
  lawn.position.y = -0.02;
  lawn.receiveShadow = true;
  scene.add(lawn, new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiIntensity));
  const vSun = new THREE.DirectionalLight(DAY.sunColor, DAY.sunIntensity);
  vSun.position.copy(DAY.sunDirection).multiplyScalar(400);
  vSun.castShadow = params.get('shadows') !== '0';
  vSun.shadow.mapSize.set(4096, 4096);
  Object.assign(vSun.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200, near: 1, far: 1000 });
  vSun.shadow.bias = -0.0005;
  vSun.shadow.normalBias = 0.05;
  scene.add(vSun);
  const t = v.track;
  // Un groupe de six coureurs à l'approche de la ligne, penchés avec le dévers ; ils tournent (`anim=0` pour les figer).
  const pack = ([[0, -6, 2.2], [1, -9, 3.0], [2, -13, 2.4], [1, -16, 1.8], [0, -19, 3.4], [2, -24, 2.6]] as const).map(([i, ds, u]) => ({
    rider: place(KITS[i]!, 0, 0, 0),
    s: v.finishS + ds + num('at', 0),
    u,
  }));
  const placePack = () => {
    for (const c of pack) {
      const f = t.frame(c.s);
      const p = t.point(c.s, c.u);
      c.rider.group.position.set(p.x, p.y, p.z);
      c.rider.group.rotation.set(0, Math.atan2(f.dirX, f.dirZ), 0);
      c.rider.group.rotateZ(-f.bank);
    }
  };
  placePack();
  const moving = params.get('anim') !== '0';
  if (params.has('budget')) {
    // `budget` : triangles de chaque partie du vélodrome (instances comprises), affichés en bas de page.
    const parts: string[] = [];
    v.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const n = (m as unknown as THREE.InstancedMesh).isInstancedMesh ? (m as unknown as THREE.InstancedMesh).count : 1;
      if (tris * n > 2000) parts.push(`${Math.round((tris * n) / 1000)}k${n > 1 ? `(${n})` : ''}${m.castShadow ? 'o' : ''}`);
    });
    document.getElementById('info')!.dataset.budget = parts.join(' ');
  }
  tick = (dt) => {
    v.update(dt);
    if (!moving) return;
    for (const c of pack) {
      c.s += 15 * dt;
      c.rider.animate(dt, 105, 15);
    }
    placePack();
  };
  const look = (from: THREE.Vector3, to: THREE.Vector3, fov: number) => {
    camera.fov = fov;
    camera.near = 0.3;
    camera.far = 5000;
    camera.position.copy(from);
    camera.lookAt(to);
  };
  const at = (s: number, u: number, dy = 0) => {
    const p = t.point(s, u);
    return new THREE.Vector3(p.x, p.y + dy, p.z);
  };
  const apex = VELODROME.straightM / 2 + VELODROME.transitionM + t.arcM / 2;
  const view = params.get('view') ?? 'aerial';
  if (view === 'tribune') look(at(-24, 17, 8.6), at(apex - 30, 2), 62);
  else if (view === 'podium') look(at(v.finishS + 18, 1.5, 2.6), at(v.finishS + 22, -15, 2), 55);
  else if (view === 'parking') look(at(t.lapM / 2 + 60, 75, 22), at(t.lapM / 2 + 15, 30, 0), 50);
  else if (view === 'porte') look(new THREE.Vector3(-120, 70, -190), at(v.gate.s, 6.7), 40);
  else if (view === 'piste') look(at(v.finishS - 26, 2.6, 1.9), at(v.finishS + 6, 2.6, 0.8), 58);
  else if (view === 'virage') look(at(apex - 50, -6, 1.7), at(apex + 10, 5, 0.5), 62);
  else if (view === 'entree') {
    const g = at(v.gate.s, 6.7, 1);
    look(new THREE.Vector3(v.gate.road.x, 2.6, v.gate.road.z).lerp(g, 0.62).setY(2.6), g, 55);
  }
  else if (view === 'facade') look(at(-10, 80, 6), at(0, 25, 7), 55);
  else look(new THREE.Vector3(-230, 170, 290), new THREE.Vector3(0, 0, 10), 38);
} else if (shot === 'lineup') {
  place(KITS[0]!, -1.75, 0, 35); // trois quarts avant
  place(KITS[2]!, 0, 0, 90); // profil, avant vers la droite
  place(KITS[1]!, 1.75, 0, 145); // trois quarts arrière
  camera.fov = 26;
  camera.position.set(0, 1.25, 7.6);
  camera.lookAt(0, 0.72, 0);
} else if (shot === 'chase') {
  place(KITS[0]!, 0, 0, 0);
  place(KITS[1]!, 0.9, 3.2, 0);
  place(KITS[2]!, -0.8, 5.5, 0);
  camera.fov = 58;
  camera.position.set(0, 2.0, -5.2);
  camera.lookAt(0, 0.95, 7);
} else {
  place(KITS[Number(params.get('kit') ?? 0)] ?? {}, 0, 0, num('yaw', 60));
  const zoom = num('zoom', 1);
  camera.fov = 24 / zoom;
  camera.position.set(0, num('camy', 1.1), 4.2);
  camera.lookAt(0, num('looky', 0.8), 0);
}

// `focus=<os>` (par exemple `head`) : cadre la caméra sur cet os, à `dist` mètres, vu de face après `yaw`.
if (params.has('focus')) {
  scene.updateMatrixWorld(true);
  const bone = riders[0]!.group.getObjectByName(params.get('focus')!);
  if (bone) {
    const target = bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, num('dy', 0.05), 0));
    camera.fov = 30;
    camera.position.copy(target).add(new THREE.Vector3(0, num('up', 0.03), num('dist', 0.7)));
    camera.lookAt(target);
  }
}

const resize = () => {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
resize();
addEventListener('resize', resize);

let last = performance.now();
const info = document.getElementById('info')!;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (params.get('spin') === '1') for (const r of riders) r.animate(dt, 90, 9);
  world?.update(dt, worldRider);
  tick?.(dt);
  renderer.render(scene, camera);
  const w = world?.stats();
  info.textContent = (info.dataset.budget ? `${info.dataset.budget} · ` : '') + `${backend} · ${renderer.info.render.triangles.toLocaleString('fr-FR')} triangles · ${renderer.info.render.drawCalls} appels de dessin` + (w ? ` · ${w.chunks} morceaux, ${w.decorInstances} arbres et rochers, ${w.coarseNearRoad} grossiers près de la route` : '');
});
for (let i = 0; i < num('t', 0) * 20; i++) {
  world?.update(0.05, worldRider);
  tick?.(0.05);
} // `t` : secondes d'animation du décor avant la capture
await renderer.renderAsync(scene, camera);
document.title = 'ready';
