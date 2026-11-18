/**
 * La piste du vélodrome André-Pétrieux (Roubaix, 1936), en plan et en dévers : béton, découverte, 499,75 m à la corde,
 * 6 m de large, virages relevés à 15,4°. Deux lignes droites, deux virages en demi-cercle, et entre eux un raccordement
 * progressif (la courbure croît en ligne droite, comme sur toute piste) : le cycliste n'entre pas d'un coup dans le virage.
 *
 * Repère : x vers l'est, z vers le sud (comme le réseau), origine au centre de la pelouse, ligne droite d'arrivée au sud,
 * parcourue vers l'est. On tourne à gauche, comme sur toute piste. `s` est la distance sur la ligne de mesure depuis le
 * milieu de la ligne droite d'arrivée ; `u` la distance en travers depuis le bord intérieur de la bande bleue.
 */
import type { EdgeDef, NodeDef } from './network';

export const VELODROME = {
  /** Longueur à la corde, mesurée sur la ligne de mesure. */
  lapM: 499.75,
  /** Largeur de la piste, bande bleue non comprise. */
  widthM: 6,
  /** Bande bleue (« côte d'azur ») au pied de la piste. */
  blueBandM: 0.7,
  /** La ligne de mesure est à 20 cm du bord intérieur de la piste. */
  measuringLineM: 0.2,
  bendBankDeg: 15.4,
  straightBankDeg: 6,
  straightM: 86,
  /** Raccordement progressif entre ligne droite et virage. */
  transitionM: 28,
} as const;

/** Bord intérieur de la piste (haut de la bande bleue), ligne de mesure, bord extérieur : en m depuis le pied de la bande bleue. */
export const U_TRACK = VELODROME.blueBandM;
export const U_MEASURING = VELODROME.blueBandM + VELODROME.measuringLineM;
export const U_TOP = VELODROME.blueBandM + VELODROME.widthM;

export interface TrackFrame {
  /** Point de la ligne de mesure. */
  x: number;
  z: number;
  /** Sens de marche (unitaire). */
  dirX: number;
  dirZ: number;
  /** Vers l'extérieur de la piste (unitaire). */
  outX: number;
  outZ: number;
  /** Dévers, en radians. */
  bank: number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export class VelodromeTrack {
  readonly lapM = VELODROME.lapM;
  /** Longueur de chaque arc de cercle, et son rayon à la ligne de mesure. */
  readonly arcM: number;
  readonly radiusM: number;
  /** Pas des échantillons : un nombre pair par tour, pour tomber juste sur le milieu de la ligne droite opposée. */
  private readonly step: number;
  private readonly xs: Float64Array;
  private readonly zs: Float64Array;
  private readonly th: Float64Array;

  constructor() {
    const { lapM: L, straightM: S, transitionM: T } = VELODROME;
    this.arcM = L / 2 - S - 2 * T;
    this.radiusM = (T + this.arcM) / Math.PI;
    const n = 2000;
    this.step = L / n;
    this.xs = new Float64Array(n + 1);
    this.zs = new Float64Array(n + 1);
    this.th = new Float64Array(n + 1);
    // Intégration du cap : dir = (cos θ, −sin θ), θ croissant tourne à gauche (vers le nord quand on roule vers l'est).
    let x = 0;
    let z = 0;
    let th = 0;
    const sub = 20;
    const h = L / n / sub;
    for (let i = 0; i <= n; i++) {
      this.xs[i] = x;
      this.zs[i] = z;
      this.th[i] = th;
      for (let k = 0; k < sub; k++) {
        const s = (i * sub + k) * h;
        const mid = th + (this.curvature(s) * h) / 2;
        x += Math.cos(mid) * h;
        z -= Math.sin(mid) * h;
        th += this.curvature(s + h / 2) * h;
      }
    }
    // Fermeture : l'erreur d'intégration (quelques millimètres) est répartie sur le tour.
    const ex = this.xs[n]! - this.xs[0]!;
    const ez = this.zs[n]! - this.zs[0]!;
    for (let i = 0; i <= n; i++) {
      this.xs[i]! -= (ex * i) / n;
      this.zs[i]! -= (ez * i) / n;
    }
    // Centre : la piste est symétrique par rapport au milieu des deux lignes droites.
    const half = n / 2;
    const cx = (this.xs[0]! + this.xs[half]!) / 2;
    const cz = (this.zs[0]! + this.zs[half]!) / 2;
    for (let i = 0; i <= n; i++) {
      this.xs[i]! -= cx;
      this.zs[i]! -= cz;
    }
  }

  /** Courbure de la ligne de mesure à `s`, en 1/m. */
  curvature(s: number): number {
    const { lapM: L, straightM: S, transitionM: T } = VELODROME;
    const kMax = 1 / this.radiusM;
    const t = (((s % (L / 2)) + L / 2) % (L / 2)) - S / 2;
    if (t < 0) return 0;
    if (t < T) return (kMax * t) / T;
    if (t < T + this.arcM) return kMax;
    if (t < 2 * T + this.arcM) return (kMax * (2 * T + this.arcM - t)) / T;
    return 0;
  }

  /** 0 en ligne droite, 1 dans l'arc, adouci au raccordement. */
  bendFactor(s: number): number {
    return smooth(Math.min(1, this.curvature(s) * this.radiusM));
  }

  bank(s: number): number {
    const { straightBankDeg: a, bendBankDeg: b } = VELODROME;
    return ((a + (b - a) * this.bendFactor(s)) * Math.PI) / 180;
  }

  frame(s: number): TrackFrame {
    const L = this.lapM;
    const w = (((s % L) + L) % L) / this.step;
    const i = Math.min(Math.floor(w), this.xs.length - 2);
    const f = w - i;
    const th = this.th[i]! + (this.th[i + 1]! - this.th[i]!) * f;
    const dirX = Math.cos(th);
    const dirZ = -Math.sin(th);
    return {
      x: this.xs[i]! + (this.xs[i + 1]! - this.xs[i]!) * f,
      z: this.zs[i]! + (this.zs[i + 1]! - this.zs[i]!) * f,
      dirX,
      dirZ,
      outX: -dirZ,
      outZ: dirX,
      bank: this.bank(s),
    };
  }

  /** Hauteur du béton à `u` m du pied de la bande bleue (0 au pied et sur la pelouse). */
  height(s: number, u: number): number {
    return Math.min(Math.max(u, 0), U_TOP) * Math.tan(this.bank(s));
  }

  /** Point de la piste à `s` (le long de la ligne de mesure) et `u` (en travers, depuis le pied de la bande bleue). */
  point(s: number, u: number): { x: number; y: number; z: number } {
    const f = this.frame(s);
    const o = u - U_MEASURING;
    return { x: f.x + f.outX * o, y: this.height(s, u), z: f.z + f.outZ * o };
  }

  /** Abscisse `s` et distance en travers `u` du point local (x, z) : sa projection sur la ligne de mesure. */
  locate(x: number, z: number): { s: number; u: number } {
    // La piste est convexe et centrée : l'angle polaire donne l'échantillon de départ, on affine autour.
    const n = this.xs.length - 1;
    if (!this.byAngle) {
      this.byAngle = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.atan2(this.zs[a]!, this.xs[a]!) - Math.atan2(this.zs[b]!, this.xs[b]!));
      this.angles = this.byAngle.map((i) => Math.atan2(this.zs[i]!, this.xs[i]!));
    }
    const a = Math.atan2(z, x);
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.angles![mid]! < a) lo = mid + 1;
      else hi = mid;
    }
    let best = this.byAngle[lo]!;
    let bestD = Infinity;
    // Un point loin du centre ne tombe pas forcément sur le même angle que sa projection : on balaie large, puis fin.
    for (const [span, step] of [[160, 8], [8, 1]] as const) {
      const c = best;
      for (let k = -span; k <= span; k += step) {
        const i = (((c + k) % n) + n) % n;
        const d = (this.xs[i]! - x) ** 2 + (this.zs[i]! - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    const s = best * this.step;
    const f = this.frame(s);
    const along = (x - f.x) * f.dirX + (z - f.z) * f.dirZ;
    const s2 = s + along;
    const g = this.frame(s2);
    return { s: ((s2 % this.lapM) + this.lapM) % this.lapM, u: U_MEASURING + (x - g.x) * g.outX + (z - g.z) * g.outZ };
  }

  private byAngle: number[] | undefined;
  private angles: number[] | undefined;
}

/* ---------- Le vélodrome dans le monde ---------- */

/** Ligne suivie par le trajet sur la piste, en m depuis le pied de la bande bleue : le coureur roule 1,6 m à sa droite. */
export const LANE_U = 1.4;
/** Ligne d'arrivée, en m le long de la ligne de mesure (devant la tribune). */
export const FINISH_S = 12;
/** Porte des coureurs : sur la ligne droite opposée, 22 m avant son milieu, dans le sens de la course. */
export const GATE_A = -22;
export const GATE_S = VELODROME.lapM / 2 + GATE_A;
/** Largeur de la rampe et longueur de la route d'accès dessinée par le vélodrome (pavés compris), en m. */
export const RAMP_W = 7;
export const ACCESS_M = 110;
/** Hauteur du talus extérieur : il part du haut du mur et rejoint le sol à 25 %. */
export const bermEnd = (top: number) => 9.5 + (top + 0.2) / 0.25;

/** Emplacement d'un vélodrome dans un réseau : centre de la pelouse, orientation, altitude. */
export interface VelodromeDef {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Rotation autour de la verticale, comme `Object3D.rotation.y` : 0 met la ligne droite d'arrivée au sud, vers l'est. */
  yaw: number;
  /** Altitude de la pelouse, en m. */
  altitude: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Hauteur de la rampe d'accès au-dessus de la pelouse, à `b` m de la ligne de mesure… vers l'extérieur. */
export function rampHeight(track: VelodromeTrack, b: number): number {
  const top = track.height(VELODROME.lapM / 2, U_TOP);
  const t = smoothstep(22, U_TOP, b);
  return 0.04 + (top - 0.04) * t;
}

/** Surface sous un point : hauteur au-dessus de l'altitude du site (dévers compris) et dévers, en radians. */
export interface Surface {
  lift: number;
  bank: number;
}

/**
 * Un vélodrome posé dans le monde : passage du repère du monde à celui de la piste, routes de la piste et de l'accès,
 * hauteur et dévers sous un point, emprise à aplanir. Partagé par la simulation (les routes) et le rendu (le modèle,
 * le sol, la hauteur des coureurs).
 */
export class VelodromeSite {
  readonly track = new VelodromeTrack();
  private readonly cos: number;
  private readonly sin: number;
  /** Repère de la ligne droite opposée (celle de la porte), en coordonnées locales. */
  private readonly back: TrackFrame;
  private readonly backO: { x: number; z: number };

  constructor(readonly def: VelodromeDef) {
    this.cos = Math.cos(def.yaw);
    this.sin = Math.sin(def.yaw);
    this.back = this.track.frame(VELODROME.lapM / 2);
    this.backO = this.track.point(VELODROME.lapM / 2, 0);
  }

  get gateNodeId(): string {
    return `${this.def.id}-porte`;
  }

  get finishNodeId(): string {
    return `${this.def.id}-arrivee`;
  }

  /** Du repère local de la piste au monde (comme `Object3D.rotation.y = yaw`). */
  toWorld(x: number, z: number): [number, number] {
    return [this.def.x + x * this.cos + z * this.sin, this.def.z - x * this.sin + z * this.cos];
  }

  toLocal(x: number, z: number): [number, number] {
    const dx = x - this.def.x;
    const dz = z - this.def.z;
    return [dx * this.cos - dz * this.sin, dx * this.sin + dz * this.cos];
  }

  /** Point local de la route d'accès : `a` le long de la ligne droite opposée, `b` vers l'extérieur. */
  accessLocal(b: number, o = 0): [number, number] {
    const a = GATE_A + o;
    return [this.backO.x + this.back.dirX * a + this.back.outX * b, this.backO.z + this.back.dirZ * a + this.back.outZ * b];
  }

  /** Point du monde sur l'axe de la route d'accès, à `b` m de la ligne de mesure… vers l'extérieur. */
  accessPoint(b: number): [number, number] {
    return this.toWorld(...this.accessLocal(b));
  }

  /** Les deux nœuds (porte, ligne d'arrivée) et les deux moitiés de la piste, à sens unique. */
  roads(): { nodes: NodeDef[]; edges: EdgeDef[] } {
    const L = VELODROME.lapM;
    const at = (s: number): [number, number] => {
      const p = this.track.point(s, LANE_U);
      return this.toWorld(p.x, p.z);
    };
    const path = (from: number, to: number): [number, number][] => {
      const n = Math.ceil(to - from); // un point par mètre : un tracé sans facettes dans les virages
      return Array.from({ length: n + 1 }, (_, i) => at(from + ((to - from) * i) / n));
    };
    const [gx, gz] = at(GATE_S);
    const [fx, fz] = at(FINISH_S);
    const alt = this.def.altitude;
    const name = `Piste du ${this.def.name.charAt(0).toLowerCase()}${this.def.name.slice(1)}`;
    return {
      nodes: [
        { id: this.gateNodeId, name: `${this.def.name} · porte`, x: gx, z: gz, altitude: alt },
        { id: this.finishNodeId, name: `${this.def.name} · arrivée`, x: fx, z: fz, altitude: alt },
      ],
      edges: [
        { id: `${this.def.id}-piste-1`, name, from: this.gateNodeId, to: this.finishNodeId, plan: [], profile: [], path: path(GATE_S, FINISH_S + L), oneWay: true, surface: 'track' },
        { id: `${this.def.id}-piste-2`, name, from: this.finishNodeId, to: this.gateNodeId, plan: [], profile: [], path: path(FINISH_S, GATE_S), oneWay: true, surface: 'track' },
      ],
    };
  }

  /** Hauteur et dévers sous le point (x, z) du monde, au-dessus de l'altitude du site. */
  surface(x: number, z: number, out: Surface = { lift: 0, bank: 0 }): Surface {
    out.lift = 0;
    out.bank = 0;
    const [lx, lz] = this.toLocal(x, z);
    if (Math.abs(lx) > 200 || Math.abs(lz) > 220) return out;
    const { a, b } = this.inBack(lx, lz);
    if (Math.abs(a - GATE_A) < RAMP_W / 2 + 0.5 && b >= U_TOP - 0.3 && b <= ACCESS_M) {
      // Rampe, puis route pavée : les pavés bombés relèvent un peu le coureur.
      out.lift = b > 24 ? 0.11 : rampHeight(this.track, Math.max(b, U_TOP));
      return out;
    }
    const { s, u } = this.track.locate(lx, lz);
    if (u >= 0 && u <= U_TOP) {
      out.lift = this.track.height(s, u);
      out.bank = this.track.bank(s);
    }
    return out;
  }

  /** Vrai si le vélodrome dessine lui-même le sol et la chaussée en (x, z) : la piste, son talus, la route d'accès. */
  covers(x: number, z: number): boolean {
    const [lx, lz] = this.toLocal(x, z);
    if (Math.abs(lx) > 200 || Math.abs(lz) > 220) return false;
    const { a, b } = this.inBack(lx, lz);
    if (Math.abs(a - GATE_A) < RAMP_W / 2 + 1.5 && b >= 0 && b <= ACCESS_M) return true;
    // Le talus le plus large (celui des virages) finit vers 18 m de la ligne de mesure.
    return this.track.locate(lx, lz).u <= 21;
  }

  /**
   * Part de l'altitude du site dans le sol en (x, z) : 1 sur l'emprise du vélodrome (pelouse, talus, tribune, parvis,
   * parking, parc), qui retombe à 0 sur `FLAT_BLEND_M` autour.
   */
  flatWeight(x: number, z: number): number {
    const [lx, lz] = this.toLocal(x, z);
    const dx = Math.max(0, Math.abs(lx) - FLAT_HALF_X);
    const dz = Math.max(0, lz > 0 ? lz - FLAT_SOUTH : -lz - FLAT_NORTH);
    const d = Math.hypot(dx, dz);
    return d >= FLAT_BLEND_M ? 0 : 1 - smoothstep(0, FLAT_BLEND_M, d);
  }

  private inBack(lx: number, lz: number): { a: number; b: number } {
    const x = lx - this.backO.x;
    const z = lz - this.backO.z;
    return { a: x * this.back.dirX + z * this.back.dirZ, b: x * this.back.outX + z * this.back.outZ };
  }
}

/** Emprise aplanie autour du centre de la pelouse, en m : demi-longueur, côté tribune (sud), côté porte (nord). */
const FLAT_HALF_X = 175;
const FLAT_SOUTH = 125;
const FLAT_NORTH = 150;
const FLAT_BLEND_M = 90;
