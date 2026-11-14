import * as THREE from 'three/webgpu';
import { ROAD_HALF, type WorldPath } from './world-path';

/**
 * Marie, accroupie au bord de la route : son vélo est retourné sur la selle et le guidon, elle fait tourner la roue
 * arrière en resserrant quelque chose. Figure en volumes simples, dans le style du reste du décor.
 *
 * Repère local : l'origine est sous ses pieds, +x pointe vers le vélo, le vélo est posé le long de z
 * (roue arrière à z = 0, roue avant à z = -1).
 */
const COLORS = {
  jersey: 0x5be3c9,
  tights: 0x23283a,
  skin: 0xe8b48f,
  hair: 0x5a3420,
  shoe: 0xf2f2ee,
  frame: 0xd9483b,
  tyre: 0x1b1d22,
  rim: 0xc9ced6,
  metal: 0x8d939d,
  toolbox: 0xd9483b,
  helmet: 0xf3f6f9,
  bottle: 0xf2cf3a,
};

/** Distance du bord de la chaussée à Marie, en m ; le vélo est 0,55 m plus loin. */
const SHOULDER_GAP_M = 2.0;
/** Distance à laquelle Marie est assise sur le parcours (sur la montée, loin de la clôture). */
export const MARIE_DISTANCE_M = 1850;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function material(color: number, roughness = 0.8) {
  return new THREE.MeshStandardNodeMaterial({ color, roughness });
}

function shadowed<T extends THREE.Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Capsule (ou cylindre) tendue entre deux points. */
function limb(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material, capsule = true): THREE.Mesh {
  const len = a.distanceTo(b);
  const geo = capsule
    ? new THREE.CapsuleGeometry(radius, Math.max(0.001, len - 2 * radius), 4, 8)
    : new THREE.CylinderGeometry(radius, radius, len, 8);
  const m = shadowed(new THREE.Mesh(geo, mat));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(v(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

function ball(center: THREE.Vector3, radius: number, mat: THREE.Material, scale = v(1, 1, 1)): THREE.Mesh {
  const m = shadowed(new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), mat));
  m.position.copy(center);
  m.scale.copy(scale);
  return m;
}

function box(size: THREE.Vector3, pos: THREE.Vector3, mat: THREE.Material): THREE.Mesh {
  const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat));
  m.position.copy(pos);
  return m;
}

/** Roue dont le plan est yz (axe selon x), centrée sur l'origine de son groupe. */
function buildWheel(): THREE.Group {
  const g = new THREE.Group();
  const tyre = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.02, 8, 36).rotateY(Math.PI / 2), material(COLORS.tyre, 0.9)));
  const rim = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.308, 0.008, 6, 36).rotateY(Math.PI / 2), material(COLORS.rim, 0.4)));
  const hub = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10).rotateZ(Math.PI / 2), material(COLORS.metal, 0.4)));
  g.add(tyre, rim, hub);
  const spokeMat = material(COLORS.rim, 0.4);
  const spokeGeo = new THREE.BoxGeometry(0.004, 0.62, 0.004);
  for (let k = 0; k < 8; k++) {
    const s = new THREE.Mesh(spokeGeo, spokeMat);
    s.rotation.x = (k * Math.PI) / 8;
    g.add(s);
  }
  return g;
}

export interface Marie {
  group: THREE.Group;
  /** Fait tourner la roue arrière et balance Marie au rythme de son geste. */
  update(dtS: number): void;
}

export function buildMarie(path: WorldPath, d = MARIE_DISTANCE_M): Marie {
  const root = new THREE.Group();
  const jersey = material(COLORS.jersey, 0.7);
  const tights = material(COLORS.tights, 0.85);
  const skin = material(COLORS.skin, 0.75);
  const hair = material(COLORS.hair, 0.9);
  const frame = material(COLORS.frame, 0.5);
  const metal = material(COLORS.metal, 0.4);

  /* ---------- Vélo retourné ---------- */
  const bike = new THREE.Group();
  const X = 0.55;
  const rear = v(X, 0.66, 0);
  const front = v(X, 0.66, -1);
  const bb = v(X, 0.74, -0.42);
  const saddle = v(X, 0.06, -0.3);
  const topRear = v(X, 0.1, -0.31);
  const headTop = v(X, 0.08, -0.78);
  const headBottom = v(X, 0.31, -0.86);
  bike.add(
    limb(bb, saddle, 0.014, frame, false), // tube de selle
    limb(topRear, headTop, 0.014, frame, false), // tube horizontal
    limb(bb, headBottom, 0.018, frame, false), // tube diagonal
    limb(headTop, headBottom, 0.02, frame, false), // tube de direction
    limb(bb, rear, 0.01, frame, false), // bases
    limb(topRear, rear, 0.008, frame, false), // haubans
    limb(headBottom, front, 0.012, metal, false), // fourche
    box(v(0.12, 0.025, 0.24), v(X, 0.03, -0.28), material(COLORS.tyre, 0.7)), // selle
    limb(v(X - 0.21, 0.03, -0.74), v(X + 0.21, 0.03, -0.74), 0.011, metal, false), // guidon
    limb(bb, bb.clone().add(v(0.1, 0.12, 0.13)), 0.012, metal, false), // manivelle
    shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.006, 20).rotateZ(Math.PI / 2), metal)),
  );
  (bike.children[bike.children.length - 1] as THREE.Mesh).position.set(X - 0.04, bb.y, bb.z);

  const rearWheel = buildWheel();
  rearWheel.position.copy(rear);
  const frontPivot = new THREE.Group(); // roue avant légèrement braquée
  frontPivot.position.copy(front);
  frontPivot.rotation.y = 0.28;
  frontPivot.add(buildWheel());
  bike.add(rearWheel, frontPivot);
  root.add(bike);

  /* ---------- Marie ---------- */
  const body = new THREE.Group();
  body.position.set(-0.12, 0.36, 0); // pivot au bassin
  const P = (x: number, y: number, z: number) => v(x + 0.12, y - 0.36, z); // coordonnées « monde » → repère du corps
  const legs = new THREE.Group(); // jambes fixes : seul le haut du corps se balance
  root.add(legs, body);

  for (const z of [-0.13, 0.13]) {
    legs.add(
      limb(v(0, 0.1, z), v(0.28, 0.42, z * 1.15), 0.055, tights),
      limb(v(0.28, 0.42, z * 1.15), v(-0.12, 0.34, z * 0.8), 0.07, tights),
      box(v(0.26, 0.08, 0.1), v(0.07, 0.04, z), material(COLORS.shoe, 0.8)),
    );
  }
  body.add(
    limb(P(-0.12, 0.36, 0), P(0.17, 0.82, 0), 0.15, jersey), // buste penché en avant
    limb(P(0.17, 0.84, 0), P(0.2, 0.9, 0), 0.045, skin), // cou
    ball(P(0.27, 0.99, 0), 0.115, skin),
    ball(P(0.24, 1.01, 0), 0.125, hair, v(1, 0.95, 1.02)),
    limb(P(0.14, 0.98, 0), P(0.02, 0.84, 0), 0.035, hair), // queue-de-cheval
    ball(P(0.36, 1.0, 0.05), 0.014, material(0x23283a)),
    ball(P(0.36, 1.0, -0.05), 0.014, material(0x23283a)),
  );
  for (const z of [-1, 1]) {
    const shoulder = P(0.17, 0.82, z * 0.19);
    const elbow = P(0.36, 0.58, z * 0.24);
    const hand = P(0.52, 0.64, z * 0.07);
    body.add(limb(shoulder, elbow, 0.05, jersey), limb(elbow, hand, 0.04, skin), ball(hand, 0.045, skin));
  }
  /* ---------- Affaires sur l'herbe ---------- */
  const helmet = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), material(COLORS.helmet, 0.6)));
  helmet.position.set(-0.45, 0, 0.7);
  root.add(
    box(v(0.32, 0.1, 0.18), v(0.35, 0.05, 0.62), material(COLORS.toolbox, 0.6)), // boîte à outils
    limb(v(0.2, 0.03, -0.55), v(0.2, 0.03, -1.05), 0.018, metal, false), // pompe posée à plat
    helmet,
    limb(v(0.95, 0.02, 0.55), v(0.95, 0.2, 0.55), 0.035, material(COLORS.bottle, 0.5), false), // bidon
    buildSign(),
  );

  /* ---------- Pose dans le monde ---------- */
  const lat = -(ROAD_HALF + SHOULDER_GAP_M);
  const p = path.point(d);
  const s = path.side(d);
  root.position.set(p.x + s.x * lat, path.groundHeight(d, lat), p.z + s.z * lat);
  // +x local → vers le vélo, donc vers le bord extérieur de la route (-s) ; z local = sens inverse de la marche,
  // si bien que la roue avant (z = -1) regarde dans le sens de la marche.
  root.rotation.y = Math.atan2(s.z, -s.x);

  let t = 0;
  return {
    group: root,
    update(dtS: number) {
      t += dtS;
      rearWheel.rotation.x -= dtS * 2.4;
      body.rotation.z = Math.sin(t * 2.1) * 0.035;
    },
  };
}

const SIGN_LINES = ['ICI GÎT MARIE', 'remplaçant son pneu', 'à Magog'];
/** Distance en amont de Marie (m) : la pancarte se lit pendant qu'on s'approche. */
const SIGN_BEFORE_M = 11;

function signTexture(): THREE.CanvasTexture | undefined {
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
  ctx.fillText(SIGN_LINES[0]!, 512, 135, 940);
  ctx.font = font.replace('{px}', '110px');
  ctx.fillText(SIGN_LINES[1]!, 512, 290, 940);
  ctx.fillStyle = '#d9483b';
  ctx.font = font.replace('{px}', '120px');
  ctx.fillText(SIGN_LINES[2]!, 512, 440, 940);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Pancarte sur deux piquets, face vers +z local, c'est-à-dire vers le coureur qui arrive. */
function buildSign(): THREE.Group {
  const g = new THREE.Group();
  const wood = material(0x6b4a2e, 0.9);
  const tex = signTexture();
  const face = tex ? new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.8 }) : wood;
  const w = 3.6;
  const h = 1.8;
  for (const x of [-w / 2 + 0.25, w / 2 - 0.25]) g.add(box(v(0.14, 2.4, 0.14), v(x, 1.2, -0.07), wood));
  const board = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), [wood, wood, wood, wood, face, wood]));
  board.position.set(0, 0.6 + h / 2, 0);
  g.add(board);
  g.position.set(1.7, 0, SIGN_BEFORE_M);
  return g;
}
