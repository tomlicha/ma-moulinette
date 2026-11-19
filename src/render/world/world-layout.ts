import { shoreDistance, type Edge, type RoadNetwork, type WaterDef } from '../../domain/course/network';
import type { Surface, VelodromeSite } from '../../domain/course/velodrome-track';
import { drain, type Steps } from '../../shared/util/background';
import { fbm, smoothstep } from '../core/noise';

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
const NO_SAMPLES = new Int32Array(0);

/** Versant soutenu par un point de route d'altitude `alt` à la distance `d` : pente douce, puis raide après `MACRO_NEAR_M`. */
const slopeDrop = (d: number) => MACRO_SLOPE_NEAR * Math.min(d, MACRO_NEAR_M) + MACRO_SLOPE_FAR * Math.max(0, d - MACRO_NEAR_M);
/** Côté des paquets de points de `SupportPoints`, en m. */
const SUPPORT_BUCKET_M = 256;
/** Marge sur les distances minorées : bien au-dessus des erreurs d'arrondi des racines carrées (≈ 1e-12 m ici). */
const BOUND_EPS_M = 0.01;

/**
 * Points de route qui soutiennent le relief de fond (un sur `MACRO_STRIDE`), rangés par paquets de 256 m. Pour un nœud
 * de la grille, `query` donne le plus haut versant (`top`, jamais sous 0) et la distance au point le plus proche
 * (`nearest`), exactement comme un parcours de tous les points : les paquets sont visités par anneaux, et un paquet
 * n'est écarté que si aucun de ses points ne peut changer ni `top` ni `nearest` (minorant de distance, majorant
 * d'altitude ; voir `skippable`). Min et max ne dépendent pas de l'ordre : résultat identique au bit près.
 */
class SupportPoints {
  top = 0;
  nearest = Infinity;
  private readonly x0: number;
  private readonly z0: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: { xs: Float64Array; zs: Float64Array; alts: Float64Array; maxAlt: number }[] = [];
  private readonly maxAlt: number;

  constructor(xs: readonly number[], zs: readonly number[], alts: readonly number[]) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, maxAlt = -Infinity;
    for (let i = 0; i < xs.length; i += MACRO_STRIDE) {
      minX = Math.min(minX, xs[i]!);
      maxX = Math.max(maxX, xs[i]!);
      minZ = Math.min(minZ, zs[i]!);
      maxZ = Math.max(maxZ, zs[i]!);
      maxAlt = Math.max(maxAlt, alts[i]!);
    }
    this.x0 = minX;
    this.z0 = minZ;
    this.cols = Math.max(1, Math.floor((maxX - minX) / SUPPORT_BUCKET_M) + 1);
    this.rows = Math.max(1, Math.floor((maxZ - minZ) / SUPPORT_BUCKET_M) + 1);
    this.maxAlt = maxAlt;
    const lists: number[][] = Array.from({ length: this.cols * this.rows }, () => []);
    for (let i = 0; i < xs.length; i += MACRO_STRIDE) {
      const bc = Math.floor((xs[i]! - minX) / SUPPORT_BUCKET_M);
      const br = Math.floor((zs[i]! - minZ) / SUPPORT_BUCKET_M);
      lists[br * this.cols + bc]!.push(i);
    }
    for (const list of lists) {
      this.buckets.push({
        xs: Float64Array.from(list, (i) => xs[i]!),
        zs: Float64Array.from(list, (i) => zs[i]!),
        alts: Float64Array.from(list, (i) => alts[i]!),
        maxAlt: list.reduce((m, i) => Math.max(m, alts[i]!), -Infinity),
      });
    }
  }

  /**
   * Aucun point à au moins `minDist` (minoré) et d'altitude au plus `maxAlt` ne peut ni rapprocher `nearest` ni relever
   * `top` : chaque terme du versant est croissant avec la distance, en flottants comme en réels.
   */
  private skippable(minDist: number, maxAlt: number): boolean {
    const d = Math.max(0, minDist - BOUND_EPS_M);
    return d >= this.nearest && maxAlt - slopeDrop(d) <= this.top;
  }

  query(x: number, z: number): void {
    this.top = 0; // jamais sous le niveau de la mer
    this.nearest = Infinity;
    const B = SUPPORT_BUCKET_M;
    const fc = Math.floor((x - this.x0) / B);
    const fr = Math.floor((z - this.z0) / B);
    // Anneau le plus lointain qui touche encore la grille des paquets.
    const last = Math.max(Math.abs(fc), Math.abs(fc - (this.cols - 1)), Math.abs(fr), Math.abs(fr - (this.rows - 1)));
    for (let k = 0; k <= last; k++) {
      // Tout paquet de l'anneau k est à au moins (k - 1) paquets de distance du nœud.
      if (k > 0 && this.skippable((k - 1) * B, this.maxAlt)) break;
      for (let br = fr - k; br <= fr + k; br++) {
        if (br < 0 || br >= this.rows) continue;
        const edgeRow = br === fr - k || br === fr + k;
        for (let bc = fc - k; bc <= fc + k; bc += edgeRow ? 1 : 2 * k || 1) {
          if (bc < 0 || bc >= this.cols) continue;
          this.scan(this.buckets[br * this.cols + bc]!, bc, br, x, z);
        }
      }
    }
  }

  private scan(b: { xs: Float64Array; zs: Float64Array; alts: Float64Array; maxAlt: number }, bc: number, br: number, x: number, z: number) {
    if (b.xs.length === 0) return;
    const B = SUPPORT_BUCKET_M;
    const left = this.x0 + bc * B;
    const top = this.z0 + br * B;
    const ox = Math.max(left - x, 0, x - (left + B));
    const oz = Math.max(top - z, 0, z - (top + B));
    if (this.skippable(Math.sqrt(ox * ox + oz * oz), b.maxAlt)) return;
    for (let k = 0; k < b.xs.length; k++) {
      const dx = b.xs[k]! - x;
      const dz = b.zs[k]! - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < this.nearest) this.nearest = d;
      // Majorant (pente douce partout) : écarte vite les points qui ne battront pas le meilleur.
      if (b.alts[k]! - MACRO_SLOPE_NEAR * d <= this.top) continue;
      const v = b.alts[k]! - MACRO_SLOPE_NEAR * Math.min(d, MACRO_NEAR_M) - MACRO_SLOPE_FAR * Math.max(0, d - MACRO_NEAR_M);
      if (v > this.top) this.top = v;
    }
  }
}
/** Marque d'un `WorldLayout` dont `WorldLayout.build` déroule lui-même les calculs lourds. */
const DEFERRED = Symbol('deferred');
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
  /** Les routes au sol : elles portent le terrain, l'asphalte, le bord de route et le décor. */
  readonly edges: Edge[];
  /** Les routes du ciel (`surface: 'sky'`), dessinées en ruban de lumière (`sky-road.ts`), et les ascenseurs. */
  readonly skyEdges: Edge[];
  readonly lifts: Edge[];
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
  /** Segments de route en tableaux typés (voir `segmentData`). */
  private seg!: { x0s: Float64Array; z0s: Float64Array; sxs: Float64Array; szs: Float64Array; len2s: Float64Array; a0s: Float64Array; das: Float64Array };
  /** Voisinage de chaque case déjà interrogée (voir `around`). */
  private readonly neighbourhood = new Map<number, Int32Array>();

  private readonly waters: { def: WaterDef; minX: number; maxX: number; minZ: number; maxZ: number }[];
  private readonly waterScratch: WaterHit = { sd: Infinity, level: 0, beach: 0 };

  /** Affecté en fin de `heavySteps`, après les passes de flou. */
  private macro!: Float32Array;
  /** Distance à la route la plus proche, sur la même grille que `macro`, en m. */
  private readonly roadDist: Float32Array;
  private readonly macroCols: number;
  private readonly macroRows: number;
  private readonly macroX0: number;
  private readonly macroZ0: number;

  /**
   * Le même monde, construit par étapes (une route, puis une rangée de la grille de relief à la fois) : à dérouler avec
   * `Background.run` pour ne pas bloquer la page. Le constructeur, lui, fait tout d'un coup.
   */
  static *build(network: RoadNetwork, relief = DEFAULT_RELIEF): Steps<WorldLayout> {
    const layout = new WorldLayout(network, relief, DEFERRED);
    yield* layout.heavySteps();
    return layout;
  }

  constructor(readonly network: RoadNetwork, readonly relief = DEFAULT_RELIEF, deferred?: typeof DEFERRED) {
    const all = [...network.edges.values()];
    this.edges = all.filter((e) => e.def.surface !== 'sky' && !e.isLift);
    this.skyEdges = all.filter((e) => e.def.surface === 'sky');
    this.lifts = all.filter((e) => e.isLift);
    this.skyNodes = new Set(
      [...network.nodes.values()].filter((n) => network.incident(n.id).every((e) => e.def.surface === 'sky' || e.isLift)).map((n) => n.id),
    );
    this.buildSkyIndex();
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

    // Grille du relief de fond, remplie par `heavySteps`.
    const pad = FAR_MARGIN_M;
    this.macroX0 = this.bounds.minX - pad;
    this.macroZ0 = this.bounds.minZ - pad;
    this.macroCols = Math.ceil((this.bounds.maxX - this.bounds.minX + 2 * pad) / MACRO_CELL_M) + 1;
    this.macroRows = Math.ceil((this.bounds.maxZ - this.bounds.minZ + 2 * pad) / MACRO_CELL_M) + 1;
    this.roadDist = new Float32Array(this.macroCols * this.macroRows);
    if (deferred !== DEFERRED) drain(this.heavySteps());
  }

  /** Échantillons des routes et grille de relief de fond : le gros du coût de construction. */
  private *heavySteps(): Steps {
    for (const [rank, e] of this.edges.entries()) {
      yield;
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
    }

    this.segmentData();

    // Relief de fond sur une grille grossière : le plus haut des versants que soutiennent les points de route.
    const raw = new Float32Array(this.macroCols * this.macroRows);
    const support = new SupportPoints(this.xs, this.zs, this.alts);
    for (let r = 0; r < this.macroRows; r++) {
      yield;
      for (let c = 0; c < this.macroCols; c++) {
        const x = this.macroX0 + c * MACRO_CELL_M;
        const z = this.macroZ0 + r * MACRO_CELL_M;
        support.query(x, z);
        raw[r * this.macroCols + c] = support.top;
        this.roadDist[r * this.macroCols + c] = support.nearest;
      }
    }
    // Deux passes de flou 3 × 3 : les arêtes entre deux versants s'arrondissent.
    let src = raw;
    for (let pass = 0; pass < 2; pass++) {
      const dst = new Float32Array(src.length);
      for (let r = 0; r < this.macroRows; r++) {
        if (r % 16 === 0) yield;
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

  /** Données de chaque segment [s, s+1], dans les mêmes opérations flottantes que le calcul d'origine. */
  private segmentData(): void {
    const n = this.xs.length;
    const seg = { x0s: new Float64Array(n), z0s: new Float64Array(n), sxs: new Float64Array(n), szs: new Float64Array(n), len2s: new Float64Array(n), a0s: new Float64Array(n), das: new Float64Array(n) };
    for (let s = 0; s < n; s++) {
      const x0 = this.xs[s]!;
      const z0 = this.zs[s]!;
      const nx = this.next[s]!;
      seg.x0s[s] = x0;
      seg.z0s[s] = z0;
      seg.a0s[s] = this.alts[s]!;
      if (nx < 0) continue; // bout de route : vecteur nul
      const sx = this.xs[nx]! - x0;
      const sz = this.zs[nx]! - z0;
      seg.sxs[s] = sx;
      seg.szs[s] = sz;
      seg.len2s[s] = sx * sx + sz * sz;
      seg.das[s] = this.alts[nx]! - this.alts[s]!;
    }
    this.seg = seg;
  }

  /**
   * Échantillons de route des cases voisines de (ci, cj), assez proches pour compter dans `nearestRoad` : une seule
   * liste par case, construite à la première demande, au lieu de 49 recherches à chaque appel. L'ordre est celui de
   * l'ancien parcours (cases par i puis j, échantillons dans l'ordre de leur case) : les sommes pondérées de
   * `nearestRoad` se font dans le même ordre, donc donnent les mêmes nombres au bit près.
   */
  private around(ci: number, cj: number): Int32Array {
    const key = this.key(ci, cj);
    let list = this.neighbourhood.get(key);
    if (list) return list;
    const ring = Math.ceil((ROAD_INFLUENCE_M + SAMPLE_STEP_M) / CELL_M); // un segment qui débute dans une case voisine peut arriver jusqu'ici
    const found: number[] = [];
    for (let i = ci - ring; i <= ci + ring; i++) {
      for (let j = cj - ring; j <= cj + ring; j++) {
        const cell = this.cells.get(this.key(i, j));
        if (cell) for (const s of cell) found.push(s);
      }
    }
    list = found.length ? Int32Array.from(found) : NO_SAMPLES;
    this.neighbourhood.set(key, list);
    return list;
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
    const r2 = reach * reach;
    let min = Infinity;
    let best = -1;
    let bestT = 0;
    let sw = 0;
    let sa = 0;
    {
      {
        const list = this.around(Math.floor(x / CELL_M), Math.floor(z / CELL_M));
        const { x0s, z0s, sxs, szs, len2s, a0s, das } = this.seg;
        for (let k = 0; k < list.length; k++) {
          const s = list[k]!;
          // Projection sur le segment [s, s+1] : l'altitude s'interpole, elle ne saute pas d'un échantillon à l'autre.
          // Données du segment calculées une fois (voir `segmentData`) ; bout de route : vecteur nul, donc t = 0.
          const x0 = x0s[s]!;
          const z0 = z0s[s]!;
          const sx = sxs[s]!;
          const sz = szs[s]!;
          const len2 = len2s[s]!;
          const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - x0) * sx + (z - z0) * sz) / len2)) : 0;
          const dx = x0 + sx * t - x;
          const dz = z0 + sz * t - z;
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
          sa += w * (a0s[s]! + das[s]! * t);
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
    const w = hit.dist === Infinity ? 0 : 1 - smoothstep(ROAD_HALF + 2, reach, hit.dist);
    // Sous une route du ciel, le sol reste plus bas qu'elle, de sa marge au moins (sauf sous la chaussée d'une route au sol).
    const ceiling = this.skyCeiling(x, z);
    const alt = Math.min(hit.dist === Infinity ? far : hit.alt * w + far * (1 - w), w > 0.999 ? Infinity : ceiling);
    // Un vélodrome aplanit son emprise à son altitude, et le sol y rejoint le relief en pente douce.
    for (const v of this.velodromes) {
      const k = v.flatWeight(x, z);
      if (k > 0) return alt + (v.def.altitude - alt) * k;
    }
    return alt;
  }

  /* ---------- Sous les routes du ciel ---------- */

  /** Nœuds où n'arrivent que des routes du ciel ou des ascenseurs : ni plaque d'asphalte, ni poteau indicateur. */
  readonly skyNodes: Set<string>;
  /** Échantillons des routes du ciel (x, z, altitude, marge sous la route), rangés par case de `SKY_CELL_M`. */
  private readonly skyCells = new Map<number, number[]>();
  private readonly skyPts: number[] = [];

  private buildSkyIndex(): void {
    const groundNodes = new Set([...this.network.nodes.values()].filter((n) => !this.skyNodes.has(n.id)).map((n) => n.id));
    for (const e of this.skyEdges) {
      for (const p of e.sample(SKY_STEP_M)) {
        // Près d'un carrefour au sol (le Sommet du col), la route part du sol : la marge y croît de 0 à `SKY_CLEAR_M`.
        let fromGround = Infinity;
        if (groundNodes.has(e.from.id)) fromGround = Math.min(fromGround, p.s);
        if (groundNodes.has(e.to.id)) fromGround = Math.min(fromGround, e.lengthM - p.s);
        const clear = SKY_CLEAR_M * smoothstep(40, SKY_RAMP_M, fromGround);
        const i = this.skyPts.length / 4;
        this.skyPts.push(p.x, p.z, p.altitude, clear);
        const key = this.key(Math.floor(p.x / SKY_CELL_M), Math.floor(p.z / SKY_CELL_M));
        const list = this.skyCells.get(key);
        if (list) list.push(i);
        else this.skyCells.set(key, [i]);
      }
    }
  }

  /**
   * Plafond du sol en (x, z) sous les routes du ciel, en altitude réelle : chaque point de route abaisse le sol à sa
   * propre altitude moins sa marge, puis le laisse remonter en pente (`SKY_CONE`) en s'éloignant. `Infinity` loin de
   * toute route du ciel.
   */
  skyCeiling(x: number, z: number): number {
    if (!this.skyPts.length) return Infinity;
    const ci = Math.floor(x / SKY_CELL_M);
    const cj = Math.floor(z / SKY_CELL_M);
    let cap = Infinity;
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = this.skyCells.get(this.key(i, j));
        if (!list) continue;
        for (const k of list) {
          const d = Math.hypot(this.skyPts[4 * k]! - x, this.skyPts[4 * k + 1]! - z);
          if (d > SKY_REACH_M) continue;
          cap = Math.min(cap, this.skyPts[4 * k + 2]! - this.skyPts[4 * k + 3]! + Math.max(0, d - SKY_FLAT_M) * SKY_CONE);
        }
      }
    }
    return cap;
  }

  /** Hauteur du sol à l'image en (x, z) : exagérée, avec le creux sous la chaussée. */
  groundY(x: number, z: number, scratch: RoadHit = { dist: Infinity, alt: 0, edge: -1, s: 0 }): number {
    const alt = this.groundAlt(x, z, scratch);
    const trench = scratch.dist === Infinity ? 0 : ROAD_TRENCH_M * (1 - smoothstep(ROAD_HALF - 0.6, ROAD_HALF + 2, scratch.dist));
    // Sous un vélodrome, le sol passe juste sous son modèle (pelouse, parvis, parking) : pas de scintillement entre les deux.
    let under = 0;
    for (const v of this.velodromes) under = Math.max(under, v.flatWeight(x, z) >= 1 ? VELODROME_SINK_M : 0);
    return this.y(alt) - Math.max(trench, under);
  }

  /** Les vélodromes du réseau. */
  get velodromes(): readonly VelodromeSite[] {
    return this.network.velodromes;
  }

  /**
   * Hauteur à ajouter à l'altitude de route en (x, z) et dévers de la surface : la piste relevée d'un vélodrome et sa
   * rampe d'accès. Nulle ailleurs.
   */
  surfaceAt(x: number, z: number, out: Surface = { lift: 0, bank: 0 }): Surface {
    out.lift = 0;
    out.bank = 0;
    for (const v of this.velodromes) {
      v.surface(x, z, out);
      if (out.lift) break;
    }
    return out;
  }

  /** Vrai si un vélodrome dessine lui-même la chaussée en (x, z) : ni asphalte, ni plaque, ni piquets du réseau. */
  underVelodrome(x: number, z: number): boolean {
    return this.velodromes.some((v) => v.covers(x, z));
  }
}

/** Pas d'échantillonnage des routes du ciel pour le plafond du sol, et taille des cases de leur index, en m. */
const SKY_STEP_M = 20;
const SKY_CELL_M = 200;
/** Marge du sol sous une route du ciel, en altitude réelle, en m (× relief à l'image). */
export const SKY_CLEAR_M = 40;
/** Distance d'un carrefour au sol sur laquelle la marge s'installe, en m. */
const SKY_RAMP_M = 400;
/** Le plafond reste à plat sous la route sur cette distance, puis remonte de `SKY_CONE` m par m. */
const SKY_FLAT_M = 25;
const SKY_CONE = 0.4;
/** Au-delà, une route du ciel ne pèse plus sur le sol, en m (la remontée a rattrapé tout relief). */
const SKY_REACH_M = 260;

/** Le sol passe sous le modèle d'un vélodrome de cette hauteur, en m à l'image. */
const VELODROME_SINK_M = 0.3;
