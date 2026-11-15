import { shoreDistance, type Edge, type RoadNetwork, type WaterDef } from '../sim/network';
import { fbm, smoothstep } from './noise';

/** Demi-largeur de la chaussée, en m. */
export const ROAD_HALF = 3.5;
/**
 * Relief exagéré : toute altitude est multipliée par ce facteur à l'image (route, terrain, décor), pas dans la physique.
 * Un 6 % réel se voit comme un 10 %.
 */
export const DEFAULT_RELIEF = 1.6;
/** Au-delà de cette distance à la route, elle n'influence plus le sol, en m. */
export const ROAD_INFLUENCE_M = 160;
/** Creux du sol sous la chaussée et ses abords, en m (à l'image) : la route reste au-dessus du maillage, sans scintillement. */
export const ROAD_TRENCH_M = 0.25;
/** Marge du relief lointain autour du réseau, en m. */
export const FAR_MARGIN_M = 1700;

const CELL_M = 80;
const SAMPLE_STEP_M = 4;
/** Maille de la grille d'altitude moyenne, en m. */
const MACRO_CELL_M = 48;
/**
 * Relief de fond : chaque point de route soutient un versant. Pente douce jusqu'à `MACRO_NEAR_M` (on roule au flanc d'une
 * colline), plus raide au-delà (le pied de la montagne), le tout borné donc sans paroi possible.
 */
const MACRO_SLOPE_NEAR = 0.12;
const MACRO_SLOPE_FAR = 0.35;
const MACRO_NEAR_M = 800;
/** Un point de route sur `MACRO_STRIDE` (16 m) suffit pour dessiner les versants. */
const MACRO_STRIDE = 4;
/**
 * Relief propre au pays, indépendant des routes : des croupes qui montent quand on s'éloigne de la chaussée. Nul jusqu'à
 * `ROLL_NEAR_M` d'une route (elle reste dégagée), entier à `ROLL_FAR_M`. Sa hauteur vaut au plus `ROLL_M`, plus
 * `ROLL_PER_ALT` par mètre d'altitude du versant : en plaine de simples collines, autour du col de vrais sommets.
 */
const ROLL_NEAR_M = 70;
const ROLL_FAR_M = 650;
const ROLL_M = 100;
const ROLL_PER_ALT = 0.3;

/** Au-delà de cette distance à sa rive, un lac n'agit plus sur le sol, en m. */
export const WATER_REACH_M = 300;
/** Profondeur du fond sous la surface, loin de la rive, en m (altitude réelle). */
const BED_DEPTH_M = 4;
/** Largeur de la grève d'un lac et de la berge d'un canal, de la ligne d'eau au haut de la berge, en m. */
const BEACH_M = 14;
const CANAL_BANK_M = 3;
/** Hauteur du haut de berge au-dessus de l'eau, en m. */
const BANK_M = 1.2;
/** Le contour d'un lac ondule de cette amplitude autour de son tracé, en m. */
const SHORE_WOBBLE_M = 5;
/** Pente moyenne du versant qui descend vers un lac (altitude réelle). */
const SHORE_SLOPE = 0.3;

export interface WaterHit {
  /** Distance à la rive du lac le plus proche, en m : négative dans l'eau, `Infinity` s'il n'y en a pas à `WATER_REACH_M`. */
  sd: number;
  /** Altitude réelle de sa surface, en m. */
  level: number;
  /** Largeur de sa grève ou de sa berge, en m. */
  beach: number;
}

/**
 * Altitude du sol autour d'un lac : le fond dans l'eau, une grève qui sort de l'eau, puis une berge tenue au moins
 * `BANK_M` au-dessus de la surface (un lac perché garde ainsi son bord), qui rejoint le relief `far` à `WATER_REACH_M`.
 */
function shoreAlt(far: number, sd: number, level: number, beach: number): number {
  if (sd <= 0) return level + Math.max(-BED_DEPTH_M, -0.3 + 0.1 * sd);
  const shore = level - 0.3 + (BANK_M + 0.3) * smoothstep(0, beach, sd);
  // Un relief haut au bord de l'eau y descend en pente douce, sur une distance à sa mesure : pas de falaise sur la rive.
  const held = Math.max(far, shore);
  const run = Math.min(WATER_REACH_M - 20, Math.max(60, (held - shore) / SHORE_SLOPE));
  const near = shore + (held - shore) * smoothstep(0, run, sd);
  return near + (far - near) * smoothstep(60, WATER_REACH_M, sd);
}

export interface RoadHit {
  /** Distance horizontale à la route la plus proche, en m (`Infinity` hors d'`ROAD_INFLUENCE_M`). */
  dist: number;
  /** Altitude réelle de la route autour : moyenne des routes proches, très pondérée vers la plus proche, en m. */
  alt: number;
  /** Rang de la route la plus proche dans `WorldLayout.edges` (-1 hors de portée) et abscisse le long d'elle, en m. */
  edge: number;
  s: number;
}

/** Repère d'un cap `heading` (rad, `atan2(dz, dx)`) : l'avant, et le côté gauche (`lat` négatif = à droite). */
export function forwardOf(heading: number): { x: number; z: number } {
  return { x: Math.cos(heading), z: Math.sin(heading) };
}
export function sideOf(heading: number): { x: number; z: number } {
  return { x: Math.sin(heading), z: -Math.cos(heading) };
}

/**
 * Le monde déduit du réseau routier : où est la route la plus proche, quelle est la hauteur du sol, et la conversion
 * altitude → hauteur à l'image. Tout le décor (terrain, arbres, clôtures, repères) s'appuie sur cette classe.
 */
export class WorldLayout {
  readonly edges: Edge[];
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly center: { x: number; z: number };
  /** Rayon du plus petit cercle centré sur `center` qui contient tout le réseau, en m. */
  readonly radius: number;

  private readonly xs: number[] = [];
  private readonly zs: number[] = [];
  private readonly alts: number[] = [];
  /** Échantillon suivant sur la même route, ou -1 au bout : chaque échantillon ouvre un segment. */
  private readonly next: number[] = [];
  /** Route et abscisse de chaque échantillon. */
  private readonly edgeOf: number[] = [];
  private readonly sOf: number[] = [];
  /** Bosquets des données : rang de la route, début et fin, en m. */
  private readonly groves: { edge: number; from: number; to: number }[] = [];
  private readonly cells = new Map<number, number[]>();

  private readonly waters: { def: WaterDef; minX: number; maxX: number; minZ: number; maxZ: number }[];
  private readonly waterScratch: WaterHit = { sd: Infinity, level: 0, beach: 0 };

  private readonly macro: Float32Array;
  /** Distance à la route la plus proche, sur la même grille que `macro`, en m. */
  private readonly roadDist: Float32Array;
  // (affecté en fin de constructeur, après les passes de flou)
  private readonly macroCols: number;
  private readonly macroRows: number;
  private readonly macroX0: number;
  private readonly macroZ0: number;

  constructor(readonly network: RoadNetwork, readonly relief = DEFAULT_RELIEF) {
    this.edges = [...network.edges.values()];
    this.edges.forEach((e, rank) => {
      const pts = e.sample(SAMPLE_STEP_M);
      pts.forEach((p, n) => {
        const i = this.xs.length;
        this.xs.push(p.x);
        this.zs.push(p.z);
        this.alts.push(p.altitude);
        this.edgeOf.push(rank);
        this.sOf.push(p.s);
        this.next.push(n < pts.length - 1 ? i + 1 : -1);
        const key = this.key(Math.floor(p.x / CELL_M), Math.floor(p.z / CELL_M));
        const list = this.cells.get(key);
        if (list) list.push(i);
        else this.cells.set(key, [i]);
      });
    });
    for (const l of network.landmarks) {
      if (l.kind === 'grove') this.groves.push({ edge: this.edges.findIndex((e) => e.id === l.edge), from: l.from, to: l.to });
    }
    this.waters = network.water.map((def) => ({
      def,
      minX: Math.min(...def.shore.map((p) => p[0])) - WATER_REACH_M,
      maxX: Math.max(...def.shore.map((p) => p[0])) + WATER_REACH_M,
      minZ: Math.min(...def.shore.map((p) => p[1])) - WATER_REACH_M,
      maxZ: Math.max(...def.shore.map((p) => p[1])) + WATER_REACH_M,
    }));
    this.bounds = network.bounds();
    this.center = { x: (this.bounds.minX + this.bounds.maxX) / 2, z: (this.bounds.minZ + this.bounds.maxZ) / 2 };
    this.radius = Math.hypot(this.bounds.maxX - this.bounds.minX, this.bounds.maxZ - this.bounds.minZ) / 2;

    // Relief de fond sur une grille grossière : le plus haut des versants que soutiennent les points de route.
    const pad = FAR_MARGIN_M;
    this.macroX0 = this.bounds.minX - pad;
    this.macroZ0 = this.bounds.minZ - pad;
    this.macroCols = Math.ceil((this.bounds.maxX - this.bounds.minX + 2 * pad) / MACRO_CELL_M) + 1;
    this.macroRows = Math.ceil((this.bounds.maxZ - this.bounds.minZ + 2 * pad) / MACRO_CELL_M) + 1;
    const raw = new Float32Array(this.macroCols * this.macroRows);
    this.roadDist = new Float32Array(this.macroCols * this.macroRows);
    for (let r = 0; r < this.macroRows; r++) {
      for (let c = 0; c < this.macroCols; c++) {
        const x = this.macroX0 + c * MACRO_CELL_M;
        const z = this.macroZ0 + r * MACRO_CELL_M;
        let top = 0; // jamais sous le niveau de la mer
        let nearest = Infinity;
        for (let i = 0; i < this.xs.length; i += MACRO_STRIDE) {
          const dx = this.xs[i]! - x;
          const dz = this.zs[i]! - z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < nearest) nearest = d;
          // Majorant (pente douce partout) : écarte vite les points qui ne battront pas le meilleur.
          if (this.alts[i]! - MACRO_SLOPE_NEAR * d <= top) continue;
          const v = this.alts[i]! - MACRO_SLOPE_NEAR * Math.min(d, MACRO_NEAR_M) - MACRO_SLOPE_FAR * Math.max(0, d - MACRO_NEAR_M);
          if (v > top) top = v;
        }
        raw[r * this.macroCols + c] = top;
        this.roadDist[r * this.macroCols + c] = nearest;
      }
    }
    // Deux passes de flou 3 × 3 : les arêtes entre deux versants s'arrondissent.
    let src = raw;
    for (let pass = 0; pass < 2; pass++) {
      const dst = new Float32Array(src.length);
      for (let r = 0; r < this.macroRows; r++) {
        for (let c = 0; c < this.macroCols; c++) {
          let sum = 0;
          let n = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const rr = r + dr;
              const cc = c + dc;
              if (rr < 0 || cc < 0 || rr >= this.macroRows || cc >= this.macroCols) continue;
              sum += src[rr * this.macroCols + cc]!;
              n++;
            }
          }
          dst[r * this.macroCols + c] = sum / n;
        }
      }
      src = dst;
    }
    this.macro = src;
  }

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  /** Hauteur à l'image d'une altitude réelle. */
  y(altitude: number): number {
    return altitude * this.relief;
  }

  /** La route la plus proche de (x, z) et l'altitude de route qui s'y applique. */
  nearestRoad(x: number, z: number, out: RoadHit = { dist: Infinity, alt: 0, edge: -1, s: 0 }): RoadHit {
    const reach = ROAD_INFLUENCE_M;
    const ring = Math.ceil((reach + SAMPLE_STEP_M) / CELL_M); // un segment qui débute dans une case voisine peut arriver jusqu'ici
    const ci = Math.floor(x / CELL_M);
    const cj = Math.floor(z / CELL_M);
    const r2 = reach * reach;
    let min = Infinity;
    let best = -1;
    let bestT = 0;
    let sw = 0;
    let sa = 0;
    for (let i = ci - ring; i <= ci + ring; i++) {
      for (let j = cj - ring; j <= cj + ring; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const s of list) {
          // Projection sur le segment [s, s+1] : l'altitude s'interpole, elle ne saute pas d'un échantillon à l'autre.
          const x0 = this.xs[s]!;
          const z0 = this.zs[s]!;
          const nx = this.next[s]!;
          let t = 0;
          if (nx >= 0) {
            const sx = this.xs[nx]! - x0;
            const sz = this.zs[nx]! - z0;
            const len2 = sx * sx + sz * sz;
            if (len2 > 0) t = Math.min(1, Math.max(0, ((x - x0) * sx + (z - z0) * sz) / len2));
          }
          const px = nx >= 0 ? x0 + (this.xs[nx]! - x0) * t : x0;
          const pz = nx >= 0 ? z0 + (this.zs[nx]! - z0) * t : z0;
          const dx = px - x;
          const dz = pz - z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r2) continue;
          if (d2 < min) {
            min = d2;
            best = s;
            bestT = t;
          }
          // Toutes les portions de route proches comptent, avec un poids très aigu : sous la chaussée, seule celle
          // qu'on foule pèse ; entre deux branches d'un lacet, le mélange est continu (aucune bascule d'une branche à l'autre).
          const w = 1 / ((d2 + 1) * (d2 + 1));
          sw += w;
          sa += w * (nx >= 0 ? this.alts[s]! + (this.alts[nx]! - this.alts[s]!) * t : this.alts[s]!);
        }
      }
    }
    out.dist = min === Infinity ? Infinity : Math.sqrt(min);
    out.alt = sw > 0 ? sa / sw : 0;
    out.edge = best < 0 ? -1 : this.edgeOf[best]!;
    out.s = best < 0 ? 0 : this.sOf[best]! + (this.next[best]! >= 0 ? (this.sOf[this.next[best]!]! - this.sOf[best]!) * bestT : 0);
    return out;
  }

  /** Valeur d'une grille grossière (`macro`, `roadDist`) en (x, z), interpolée. */
  private gridAt(m: Float32Array, x: number, z: number): number {
    const fx = Math.min(Math.max((x - this.macroX0) / MACRO_CELL_M, 0), this.macroCols - 1.001);
    const fz = Math.min(Math.max((z - this.macroZ0) / MACRO_CELL_M, 0), this.macroRows - 1.001);
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const u = fx - c;
    const v = fz - r;
    const w = this.macroCols;
    const a = m[r * w + c]!;
    const b = m[r * w + c + 1]!;
    const cc = m[(r + 1) * w + c]!;
    const d = m[(r + 1) * w + c + 1]!;
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  }

  /** Distance approchée de (x, z) à la route la plus proche, à toute distance (grille de 48 m), en m. */
  roadDistanceAt(x: number, z: number): number {
    return this.gridAt(this.roadDist, x, z);
  }

  /** Distance de (x, z) à la boîte du réseau, 0 dedans, en m. */
  private outsideBounds(x: number, z: number): number {
    const dx = Math.max(this.bounds.minX - x, 0, x - this.bounds.maxX);
    const dz = Math.max(this.bounds.minZ - z, 0, z - this.bounds.maxZ);
    return Math.hypot(dx, dz);
  }

  /** Relief de fond (sans route) en altitude réelle : collines qui suivent l'altitude des routes, plus du bruit. */
  farAlt(x: number, z: number): number {
    // Collines douces, jamais sous zéro : le sol lointain ne passe pas sous le plan de fond.
    const hills = 4 + fbm(x * 0.004, z * 0.004) * 10 + fbm(x * 0.02, z * 0.02, 2) * 1.5;
    const slope = this.gridAt(this.macro, x, z);
    // Croupes et sommets, d'autant plus hauts qu'on est loin d'une route et haut sur le versant.
    const away = smoothstep(ROLL_NEAR_M, ROLL_FAR_M, this.roadDistanceAt(x, z));
    const roll = away * (ROLL_M + ROLL_PER_ALT * slope) * (0.5 + 0.5 * fbm(x * 0.0011 + 31, z * 0.0011 + 7, 2));
    const fade = 1 - smoothstep(0, FAR_MARGIN_M, this.outsideBounds(x, z));
    return Math.max(0, slope + hills + roll) * fade;
  }

  /**
   * Part d'érables roux là où tombe `hit` (rendu par `nearestRoad`) : 1 au bord d'une route à bosquet, 0 au-delà de
   * 160 m ou hors du bosquet. Les deux bouts du bosquet se fondent sur 160 m.
   */
  autumnAt(hit: RoadHit): number {
    if (hit.edge < 0) return 0;
    let k = 0;
    for (const g of this.groves) {
      if (g.edge !== hit.edge) continue;
      k = Math.max(k, smoothstep(g.from - 80, g.from + 80, hit.s) * (1 - smoothstep(g.to - 80, g.to + 80, hit.s)));
    }
    return k * (1 - smoothstep(50, ROAD_INFLUENCE_M, hit.dist));
  }

  /** Le monde a-t-il des bosquets d'automne ? Évite un calcul de route à qui n'en a pas besoin. */
  get hasGroves(): boolean {
    return this.groves.length > 0;
  }

  /** Les lacs du monde, pour dessiner leur surface. */
  get lakes(): readonly WaterDef[] {
    return this.network.water;
  }

  /**
   * Le lac le plus proche de (x, z) et la distance à sa rive. La rive ondule un peu autour du contour des données :
   * le terrain, la surface de l'eau, le décor et la couleur du sol lisent tous cette fonction.
   */
  waterAt(x: number, z: number, out: WaterHit = { sd: Infinity, level: 0, beach: 0 }): WaterHit {
    out.sd = Infinity;
    for (const w of this.waters) {
      if (x < w.minX || x > w.maxX || z < w.minZ || z > w.maxZ) continue;
      const canal = w.def.kind === 'canal';
      const sd = shoreDistance(w.def.shore, x, z) + (canal ? 0 : SHORE_WOBBLE_M * fbm(x * 0.03, z * 0.03, 2));
      if (sd < out.sd && sd < WATER_REACH_M) {
        out.sd = sd;
        out.level = w.def.level;
        out.beach = canal ? CANAL_BANK_M : BEACH_M;
      }
    }
    return out;
  }

  /** Altitude réelle du sol en (x, z), avant creux de chaussée : sous la route elle vaut celle de la route. */
  groundAlt(x: number, z: number, scratch: RoadHit = { dist: Infinity, alt: 0, edge: -1, s: 0 }): number {
    let far = this.farAlt(x, z);
    const hit = this.nearestRoad(x, z, scratch);
    let reach = ROAD_INFLUENCE_M;
    if (this.waters.length) {
      const water = this.waterAt(x, z, this.waterScratch);
      if (water.sd !== Infinity) {
        far = shoreAlt(far, water.sd, water.level, water.beach);
        // Entre une route et un lac, le talus descend de la chaussée à la ligne d'eau : la route ne pèse pas au-delà.
        if (hit.dist !== Infinity) reach = Math.min(ROAD_INFLUENCE_M, Math.max(ROAD_HALF + 3, hit.dist + water.sd));
      }
    }
    if (hit.dist === Infinity) return far;
    const w = 1 - smoothstep(ROAD_HALF + 2, reach, hit.dist);
    return hit.alt * w + far * (1 - w);
  }

  /** Hauteur du sol à l'image en (x, z) : exagérée, avec le creux sous la chaussée. */
  groundY(x: number, z: number, scratch: RoadHit = { dist: Infinity, alt: 0, edge: -1, s: 0 }): number {
    const alt = this.groundAlt(x, z, scratch);
    const trench = scratch.dist === Infinity ? 0 : ROAD_TRENCH_M * (1 - smoothstep(ROAD_HALF - 0.6, ROAD_HALF + 2, scratch.dist));
    return this.y(alt) - trench;
  }
}
