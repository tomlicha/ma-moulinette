/**
 * Réseau routier : des nœuds (carrefours) reliés par des arêtes (routes). Chaque arête est une courbe en plan
 * (x vers l'est, z vers le sud, en m) et un profil d'altitude lisse. Les altitudes aux extrémités sont celles des
 * nœuds, donc le réseau est continu par construction. Les 20 derniers mètres de chaque extrémité sont plats :
 * la pente envoyée au trainer ne saute pas au passage d'un carrefour.
 */

export interface NodeDef {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Altitude, en m. */
  altitude: number;
  /** Ce qu'on trouve à ce carrefour : le rendu y pose les bâtiments et les objets du lieu. */
  place?: 'village' | 'mill' | 'summit' | 'viewpoint' | 'harbour' | 'tarn';
}

export interface EdgeDef {
  id: string;
  name: string;
  from: string;
  to: string;
  /** Points de passage en plan (x, z) entre les deux nœuds ; la courbe les traverse. */
  plan: [number, number][];
  /** Altitudes intermédiaires : [fraction de la longueur, altitude en m]. Les extrémités viennent des nœuds. */
  profile: [number, number][];
}

/** Éléments de décor posés sur une route, repérés par son identifiant et l'abscisse `s` depuis son nœud de départ. */
export type Landmark =
  | { kind: 'arch'; edge: string; s: number; text: string }
  | { kind: 'marie'; edge: string; s: number }
  /** Clôture en bois à droite de la route dans son sens de définition, entre `from` et `to`. */
  | { kind: 'fence'; edge: string; from: number; to: number }
  /** Essence qui borde la route des deux côtés entre `from` et `to` : les érables roux du Col. */
  | { kind: 'grove'; edge: string; from: number; to: number; species: 'maple' };

/**
 * Un plan d'eau : un lac au niveau `level`, de contour `shore`. Le rendu creuse le terrain dedans et dresse la berge
 * autour ; la simulation n'en tient pas compte.
 */
export interface WaterDef {
  id: string;
  name: string;
  /** Altitude de la surface, en m. */
  level: number;
  /** Contour en plan, points (x, z) dans l'ordre, fermé du dernier au premier. */
  shore: [number, number][];
}

/** Distance de (x, z) au contour `shore`, en m : négative dans l'eau, positive sur la terre. */
export function shoreDistance(shore: readonly (readonly [number, number])[], x: number, z: number): number {
  let d2 = Infinity;
  let inside = false;
  for (let i = 0, j = shore.length - 1; i < shore.length; j = i++) {
    const ax = shore[j]![0];
    const az = shore[j]![1];
    const ex = shore[i]![0] - ax;
    const ez = shore[i]![1] - az;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / len2)) : 0;
    const dx = ax + ex * t - x;
    const dz = az + ez * t - z;
    d2 = Math.min(d2, dx * dx + dz * dz);
    if (az > z !== az + ez > z && x < ax + ((z - az) * ex) / ez) inside = !inside;
  }
  return inside ? -Math.sqrt(d2) : Math.sqrt(d2);
}

/**
 * Un parcours : une boucle recommandée dans le réseau. Le cycliste reste libre de la quitter à chaque carrefour, mais
 * c'est la route de la boucle qui est proposée d'office (et que le profil du HUD annonce). Plusieurs parcours se
 * partagent le même monde et se croisent là où leurs boucles passent par les mêmes routes ou carrefours.
 */
export interface CourseDef {
  id: string;
  name: string;
  description: string;
  /**
   * Routes de la boucle, dans l'ordre. Chacune se parcourt dans son sens de définition (départ → arrivée) et finit au
   * nœud où commence la suivante ; la dernière ramène au départ de la première. Le parcours part de la première.
   */
  guide: string[];
}

export interface NetworkDef {
  name: string;
  nodes: NodeDef[];
  edges: EdgeDef[];
  /** Première route du trajet. */
  start: { edge: string; forward: boolean };
  landmarks?: Landmark[];
  /** Parcours proposés ; le premier est celui par défaut. */
  courses?: CourseDef[];
  /** Lacs du monde. */
  water?: WaterDef[];
}

export interface PlanPoint {
  x: number;
  z: number;
}

/** Longueur plate au bout de chaque arête, en m. */
export const FLAT_END_M = 20;
/** Pas d'échantillonnage de la courbe en plan, en m. */
const SAMPLE_M = 3;

type Pt = readonly [number, number];

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Catmull-Rom centripète : passe par les points sans boucle ni dépassement, même aux épingles. */
function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t1 = Math.sqrt(dist(p0, p1));
  const t2 = t1 + Math.sqrt(dist(p1, p2));
  const t3 = t2 + Math.sqrt(dist(p2, p3));
  const u = t1 + (t2 - t1) * t;
  const mix = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
    const k = (u - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const a1 = mix(p0, p1, 0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, 0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

/** Courbe lissée passant par `pts`, rendue en points espacés d'environ `SAMPLE_M`. */
function smoothCurve(pts: Pt[]): Pt[] {
  const n = pts.length;
  const ext: Pt[] = [
    [2 * pts[0]![0] - pts[1]![0], 2 * pts[0]![1] - pts[1]![1]],
    ...pts,
    [2 * pts[n - 1]![0] - pts[n - 2]![0], 2 * pts[n - 1]![1] - pts[n - 2]![1]],
  ];
  const out: Pt[] = [pts[0]!];
  for (let i = 0; i < n - 1; i++) {
    const steps = Math.max(8, Math.ceil((dist(pts[i]!, pts[i + 1]!) * 1.3) / SAMPLE_M));
    for (let k = 1; k <= steps; k++) out.push(catmullRom(ext[i]!, ext[i + 1]!, ext[i + 2]!, ext[i + 3]!, k / steps));
  }
  return out;
}

/** Index du dernier élément de `xs` (croissant) qui est ≤ `v`, borné à [0, n-2]. */
function segmentOf(xs: number[], v: number): number {
  let lo = 0;
  let hi = xs.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid]! <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export class Edge {
  readonly id: string;
  readonly name: string;
  readonly lengthM: number;
  private readonly xs: number[] = [];
  private readonly zs: number[] = [];
  private readonly cum: number[] = [];
  private readonly knotS: number[] = [];
  private readonly knotY: number[] = [];
  private readonly knotD: number[] = [];

  constructor(readonly def: EdgeDef, readonly from: NodeDef, readonly to: NodeDef) {
    this.id = def.id;
    this.name = def.name;
    const pts = smoothCurve([[from.x, from.z], ...def.plan, [to.x, to.z]]);
    let total = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) total += dist(pts[i - 1]!, pts[i]!);
      this.xs.push(pts[i]![0]);
      this.zs.push(pts[i]![1]);
      this.cum.push(total);
    }
    this.lengthM = total;
    this.buildProfile();
  }

  private buildProfile() {
    const L = this.lengthM;
    const { from, to, def } = this;
    if (L < 2 * FLAT_END_M + 10) throw new Error(`arête ${def.id} trop courte (${L.toFixed(0)} m)`);
    const s = [0, FLAT_END_M];
    const y = [from.altitude, from.altitude];
    for (const [f, alt] of def.profile) {
      const at = f * L;
      if (at <= s[s.length - 1]! + 1 || at >= L - FLAT_END_M - 1) {
        throw new Error(`arête ${def.id} : le point d'altitude à ${f} tombe dans une extrémité plate ou hors de l'arête`);
      }
      s.push(at);
      y.push(alt);
    }
    s.push(L - FLAT_END_M, L);
    y.push(to.altitude, to.altitude);

    // Interpolation monotone par morceaux (Fritsch-Butland) : pas de bosse parasite entre deux points d'altitude.
    const n = s.length;
    const h: number[] = [];
    const m: number[] = [];
    for (let k = 0; k < n - 1; k++) {
      h.push(s[k + 1]! - s[k]!);
      m.push((y[k + 1]! - y[k]!) / h[k]!);
    }
    const d: number[] = new Array<number>(n).fill(0);
    for (let k = 1; k < n - 1; k++) {
      const a = m[k - 1]!;
      const b = m[k]!;
      if (a * b > 0) {
        const hp = h[k - 1]!;
        const hn = h[k]!;
        d[k] = (3 * (hp + hn)) / ((2 * hn + hp) / a + (hn + 2 * hp) / b);
      }
    }
    this.knotS.push(...s);
    this.knotY.push(...y);
    this.knotD.push(...d);
  }

  private hermite(s: number): { y: number; dy: number } {
    const S = this.knotS;
    const x = Math.min(Math.max(s, 0), this.lengthM);
    const k = segmentOf(S, x);
    const h = S[k + 1]! - S[k]!;
    const t = (x - S[k]!) / h;
    const y0 = this.knotY[k]!;
    const y1 = this.knotY[k + 1]!;
    const d0 = this.knotD[k]!;
    const d1 = this.knotD[k + 1]!;
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      y: (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * d0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * d1,
      dy:
        ((6 * t2 - 6 * t) * y0 + (3 * t2 - 4 * t + 1) * h * d0 + (-6 * t2 + 6 * t) * y1 + (3 * t2 - 2 * t) * h * d1) / h,
    };
  }

  /** Altitude à l'abscisse `s` depuis le nœud de départ, en m. */
  altitudeAt(s: number): number {
    return this.hermite(s).y;
  }

  /** Pente exacte (non lissée) à l'abscisse `s`, en %. */
  gradePctAt(s: number): number {
    return this.hermite(s).dy * 100;
  }

  pointAt(s: number): PlanPoint {
    const x = Math.min(Math.max(s, 0), this.lengthM);
    const k = segmentOf(this.cum, x);
    const span = this.cum[k + 1]! - this.cum[k]!;
    const t = span > 0 ? (x - this.cum[k]!) / span : 0;
    return {
      x: this.xs[k]! + (this.xs[k + 1]! - this.xs[k]!) * t,
      z: this.zs[k]! + (this.zs[k + 1]! - this.zs[k]!) * t,
    };
  }

  /** Cap en rad dans le sens départ → arrivée : `atan2(dz, dx)`, donc positif en tournant vers la droite (z vers le sud). */
  headingAt(s: number): number {
    const x = Math.min(Math.max(s, 0), this.lengthM);
    const k = segmentOf(this.cum, x);
    return Math.atan2(this.zs[k + 1]! - this.zs[k]!, this.xs[k + 1]! - this.xs[k]!);
  }

  /** Points échantillonnés tous les `stepM` (pour l'index spatial, les tests et le rendu). */
  sample(stepM: number): { s: number; x: number; z: number; altitude: number }[] {
    const n = Math.max(1, Math.round(this.lengthM / stepM));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * this.lengthM;
      const p = this.pointAt(s);
      out.push({ s, x: p.x, z: p.z, altitude: this.altitudeAt(s) });
    }
    return out;
  }
}

export class RoadNetwork {
  readonly name: string;
  readonly nodes = new Map<string, NodeDef>();
  readonly edges = new Map<string, Edge>();
  readonly start: { edge: string; forward: boolean };
  readonly landmarks: Landmark[];
  readonly courses: CourseDef[];
  readonly water: WaterDef[];
  private readonly incidentTo = new Map<string, Edge[]>();

  constructor(readonly def: NetworkDef) {
    this.name = def.name;
    this.start = def.start;
    this.landmarks = def.landmarks ?? [];
    this.courses = def.courses ?? [];
    this.water = def.water ?? [];
    for (const n of def.nodes) {
      this.nodes.set(n.id, n);
      this.incidentTo.set(n.id, []);
    }
    for (const e of def.edges) {
      const a = this.nodes.get(e.from);
      const b = this.nodes.get(e.to);
      if (!a || !b) throw new Error(`arête ${e.id} : nœud inconnu`);
      const edge = new Edge(e, a, b);
      this.edges.set(e.id, edge);
      this.incidentTo.get(a.id)!.push(edge);
      this.incidentTo.get(b.id)!.push(edge);
    }
    if (!this.edges.has(def.start.edge)) throw new Error(`départ : arête ${def.start.edge} inconnue`);
    for (const c of this.courses) {
      if (c.guide.length < 2) throw new Error(`parcours ${c.id} : au moins deux routes`);
      c.guide.forEach((id, i) => {
        const e = this.edges.get(id);
        const next = this.edges.get(c.guide[(i + 1) % c.guide.length]!);
        if (!e || !next) throw new Error(`parcours ${c.id} : route ${id} ou suivante inconnue`);
        if (e.to.id !== next.from.id) {
          throw new Error(`parcours ${c.id} : ${id} finit en ${e.to.id} mais ${next.id} part de ${next.from.id}`);
        }
      });
    }
    for (const l of this.landmarks) {
      const e = this.edges.get(l.edge);
      if (!e) throw new Error(`repère ${l.kind} : arête ${l.edge} inconnue`);
      const ends = 'from' in l ? [l.from, l.to] : [l.s];
      if (ends.some((s) => s < 0 || s > e.lengthM)) throw new Error(`repère ${l.kind} sur ${l.edge} hors de la route (${e.lengthM.toFixed(0)} m)`);
    }
  }

  /** Le parcours d'identifiant `id`, sinon le premier. */
  course(id?: string): CourseDef | undefined {
    return this.courses.find((c) => c.id === id) ?? this.courses[0];
  }

  /** Longueur de la boucle d'un parcours et total de ses montées (échantillonné tous les 20 m), en m. */
  courseStats(course: CourseDef): { lengthM: number; climbM: number } {
    let lengthM = 0;
    let climbM = 0;
    for (const id of course.guide) {
      const e = this.edges.get(id)!;
      lengthM += e.lengthM;
      const alts = e.sample(20).map((p) => p.altitude);
      for (let i = 1; i < alts.length; i++) climbM += Math.max(0, alts[i]! - alts[i - 1]!);
    }
    return { lengthM, climbM };
  }

  /** Routes qui touchent le nœud, triées par identifiant. */
  incident(nodeId: string): Edge[] {
    return [...(this.incidentTo.get(nodeId) ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  get lengthM(): number {
    let t = 0;
    for (const e of this.edges.values()) t += e.lengthM;
    return t;
  }

  /** Boîte englobante en plan. */
  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const e of this.edges.values()) {
      for (const p of e.sample(20)) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
    }
    return { minX, maxX, minZ, maxZ };
  }
}

/* ---------- Contrôle de cohérence ---------- */

export const MAX_GRADE_PCT = 10;
/** Écart minimal entre deux routes qui ne se touchent pas, en m. */
export const MIN_SEPARATION_M = 60;
/** Écart minimal entre deux routes qui partent du même carrefour, mesuré au-delà de `JUNCTION_ZONE_M`, en m. */
const MIN_SIBLING_SEPARATION_M = 40;
const JUNCTION_ZONE_M = 100;
/** Angle minimal entre deux routes d'un même carrefour, en degrés. */
export const MIN_JUNCTION_ANGLE_DEG = 35;
export const MIN_EDGE_M = 150;
/** Écart minimal entre une route et la rive d'un lac, en m : la place de la berge. */
export const MIN_SHORE_M = 18;
/** Une route à moins de `SHORE_ZONE_M` d'un lac doit le dominer d'au moins `MIN_FREEBOARD_M`. */
const SHORE_ZONE_M = 150;
export const MIN_FREEBOARD_M = 1;

/** Liste les défauts du réseau ; vide s'il est jouable. Les tests l'exigent vide, et le rendu s'y fie. */
export function validateNetwork(net: RoadNetwork): string[] {
  const issues: string[] = [];
  const edges = [...net.edges.values()];

  for (const e of edges) {
    if (e.lengthM < MIN_EDGE_M) issues.push(`${e.id} : ${e.lengthM.toFixed(0)} m, moins de ${MIN_EDGE_M} m`);
    let worst = 0;
    for (let s = 0; s <= e.lengthM; s += 5) worst = Math.max(worst, Math.abs(e.gradePctAt(s)));
    if (worst > MAX_GRADE_PCT) issues.push(`${e.id} : pente maximale ${worst.toFixed(1)} % (plafond ${MAX_GRADE_PCT} %)`);
  }

  for (const n of net.nodes.values()) {
    const around = net.incident(n.id);
    if (around.length < 2) issues.push(`${n.id} : cul-de-sac (${around.length} route)`);
    const headings = around.map((e) => (e.from.id === n.id ? e.headingAt(0) : e.headingAt(e.lengthM) + Math.PI));
    for (let i = 0; i < headings.length; i++) {
      for (let j = i + 1; j < headings.length; j++) {
        let d = Math.abs(headings[i]! - headings[j]!) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        const deg = (d * 180) / Math.PI;
        if (deg < MIN_JUNCTION_ANGLE_DEG) {
          issues.push(`${n.id} : ${around[i]!.id} et ${around[j]!.id} partent à ${deg.toFixed(0)}° l'une de l'autre`);
        }
      }
    }
  }

  const samples = edges.map((e) => e.sample(10));
  for (let i = 0; i < edges.length; i++) {
    for (let j = i; j < edges.length; j++) {
      const a = edges[i]!;
      const b = edges[j]!;
      if (i === j) {
        let min = Infinity;
        for (const p of samples[i]!) for (const q of samples[i]!) if (Math.abs(p.s - q.s) > 300) min = Math.min(min, Math.hypot(p.x - q.x, p.z - q.z));
        if (min < MIN_SEPARATION_M) issues.push(`${a.id} : elle se rapproche d'elle-même à ${min.toFixed(0)} m`);
        continue;
      }
      const shared = [a.from.id, a.to.id].filter((id) => id === b.from.id || id === b.to.id);
      const zone = (e: Edge, s: number) => {
        let near = Infinity;
        for (const id of shared) {
          if (e.from.id === id) near = Math.min(near, s);
          if (e.to.id === id) near = Math.min(near, e.lengthM - s);
        }
        return near;
      };
      let min = Infinity;
      for (const p of samples[i]!) {
        if (shared.length && zone(a, p.s) < JUNCTION_ZONE_M) continue;
        for (const q of samples[j]!) {
          if (shared.length && zone(b, q.s) < JUNCTION_ZONE_M) continue;
          min = Math.min(min, Math.hypot(p.x - q.x, p.z - q.z));
        }
      }
      const need = shared.length ? MIN_SIBLING_SEPARATION_M : MIN_SEPARATION_M;
      if (min < need) issues.push(`${a.id} et ${b.id} : ${min.toFixed(0)} m d'écart, moins de ${need} m`);
    }
  }

  // Lacs : aucune route dans l'eau ni au ras de la rive, et la chaussée au-dessus de la surface.
  for (const w of net.water) {
    if (w.shore.length < 3) issues.push(`${w.id} : contour de moins de trois points`);
    edges.forEach((e, i) => {
      let nearest = Infinity;
      let lowest = Infinity;
      for (const p of samples[i]!) {
        const d = shoreDistance(w.shore, p.x, p.z);
        nearest = Math.min(nearest, d);
        if (d < SHORE_ZONE_M) lowest = Math.min(lowest, p.altitude - w.level);
      }
      if (nearest < MIN_SHORE_M) issues.push(`${e.id} : à ${nearest.toFixed(0)} m de la rive de ${w.id}, moins de ${MIN_SHORE_M} m`);
      if (lowest < MIN_FREEBOARD_M) issues.push(`${e.id} : ${lowest.toFixed(1)} m au-dessus de ${w.id}, moins de ${MIN_FREEBOARD_M} m`);
    });
  }
  return issues;
}
