import type { CourseDef, Edge, RoadNetwork } from './network';

/**
 * Carte d'un réseau routier en SVG : le tracé en plan (nord en haut), les parcours en couleur, les carrefours avec leur
 * altitude, et le profil d'altitude de chaque boucle. Fonctions pures, sans DOM : elles produisent la planche de la
 * documentation (`npm run map`) et les cartes de l'écran de choix du parcours.
 */

const COLORS = {
  paper: '#F7F4EC',
  grid: '#E4DFD2',
  ink: '#14171A',
  muted: '#5B6470',
  road: '#B4B9C2',
  water: '#BFE3F2',
  shore: '#7DBBD8',
  roadCasing: '#FFFFFF',
  /** Un parcours par couleur, dans l'ordre du réseau ; au-delà on boucle. */
  courses: ['#C2410C', '#0F9F8F', '#6D4AFF', '#B8860B'],
  fill: ['#F9D9C6', '#C9EEE8', '#DDD5FF', '#F2E3B8'],
};

const FONT = "Barlow, 'Segoe UI', system-ui, -apple-system, sans-serif";

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();
const fr = (v: number, digits = 1) => v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

interface Pt {
  x: number;
  y: number;
}

export interface MapOptions {
  /** `sheet` : la planche de la documentation (carte, légende, profils) ; `plan` : la carte seule. */
  layout?: 'sheet' | 'plan';
  /** Parcours à mettre en avant : seul le sien est en couleur franche, avec ses flèches et ses kilomètres. */
  selected?: string;
  /**
   * Textes : `none` (aucun, pour une miniature : traits et pastilles épaissis), `nodes` (carrefours, kilomètres et
   * légende), `all` (en plus, les noms des routes).
   */
  labels?: 'none' | 'nodes' | 'all';
  /** Grossit les textes quand la carte sera vue bien plus petite que son dessin. */
  fontScale?: number;
  /** Pas d'échantillonnage des routes, en m : plus grand pour une miniature. */
  stepM?: number;
  /** Taille d'affichage du dessin, en pixels par unité du SVG, et plus petite taille de texte voulue à l'écran, en pixels. */
  pxPerUnit?: number;
  minTextPx?: number;
}

export interface NetworkMap {
  svg: string;
  width: number;
  height: number;
}

interface CourseGeometry {
  course: CourseDef;
  color: string;
  fill: string;
  edges: Edge[];
  lengthM: number;
  climbM: number;
  maxGradePct: number;
}

function geometryOf(network: RoadNetwork, course: CourseDef, index: number): CourseGeometry {
  const edges = course.guide.map((id) => network.edges.get(id)!);
  const stats = network.courseStats(course);
  let maxGradePct = 0;
  for (const e of edges) for (let s = 0; s <= e.lengthM; s += 5) maxGradePct = Math.max(maxGradePct, e.gradePctAt(s));
  return {
    course,
    color: COLORS.courses[index % COLORS.courses.length]!,
    fill: COLORS.fill[index % COLORS.fill.length]!,
    edges,
    lengthM: stats.lengthM,
    climbM: stats.climbM,
    maxGradePct,
  };
}

/** Profil d'altitude d'une boucle : distance cumulée, altitude, et où chaque route commence. */
function profileOf(g: CourseGeometry) {
  const pts: { d: number; alt: number }[] = [];
  const marks: { d: number; to: number; name: string }[] = [];
  let d0 = 0;
  for (const e of g.edges) {
    for (const p of e.sample(20)) pts.push({ d: d0 + p.s, alt: p.altitude });
    marks.push({ d: d0, to: d0 + e.lengthM, name: e.name });
    d0 += e.lengthM;
  }
  return { pts, marks };
}

/** Échelle d'altitude commune à tous les parcours : un parcours plat doit avoir l'air plat à côté d'une montagne. */
function altitudeRange(geoms: CourseGeometry[]): { lo: number; hi: number } {
  const alts = geoms.flatMap((g) => profileOf(g).pts.map((p) => p.alt));
  const lo = Math.floor(Math.min(...alts) / 100) * 100;
  return { lo, hi: Math.max(Math.ceil(Math.max(...alts) / 100) * 100, lo + 100) };
}

/** Texte lisible sur n'importe quel fond : un liseré de la couleur du papier autour des lettres. */
function label(
  x: number,
  y: number,
  text: string,
  o: { size?: number; weight?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; italic?: boolean } = {},
) {
  const { size = 13, weight = 500, fill = COLORS.ink, anchor = 'start', italic = false } = o;
  return (
    `<text x="${n1(x)}" y="${n1(y)}" font-size="${n1(size)}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"` +
    `${italic ? ' font-style="italic"' : ''} stroke="${COLORS.paper}" stroke-width="${n1(size * 0.3)}" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>`
  );
}

const VELO = {
  casing: '#FFFFFF',
  band: '#4D9AD6',
  infield: '#7CC05A',
  stripe: '#8ACB66',
  brick: '#A5553B',
  roof: '#2B3A55',
  ink: '#14171A',
  white: '#FFFFFF',
};

/** Contour d'un stade (rectangle aux bouts en demi-cercle), centré, de demi-longueur `w` et demi-largeur `h`. */
const stadium = (w: number, h: number) =>
  `M${n1(-w + h)} ${n1(-h)} H${n1(w - h)} A${n1(h)} ${n1(h)} 0 0 1 ${n1(w - h)} ${n1(h)} H${n1(-w + h)} A${n1(h)} ${n1(h)} 0 0 1 ${n1(-w + h)} ${n1(-h)} Z`;

/**
 * Icône d'un vélodrome, centrée sur l'origine, la ligne droite d'arrivée en bas (au sud quand le site n'est pas tourné) :
 * piste à la couleur `track` sur un liseré blanc, bande bleue au pied, pelouse rayée et terrain, tribune de brique au toit
 * sombre le long de la ligne droite d'arrivée, damier de la ligne, et la porte des coureurs, ouverte dans la ligne droite
 * opposée. `k` règle la taille (1 : 64 unités de long).
 */
export function velodromeIcon(track: string, k = 1): string {
  const w = 32 * k;
  const h = 17 * k;
  const t = 6.5 * k; // largeur de la piste
  const out: string[] = [];
  // Tribune : un bâtiment de brique sous un toit sombre, dehors, le long de la ligne droite d'arrivée, avec son pavillon
  // d'entrée au milieu et ses fenêtres.
  const sw = w * 0.62;
  const sy = h + 1.5 * k;
  out.push(`<rect x="${n1(-sw - 1.6 * k)}" y="${n1(sy - 1.6 * k)}" width="${n1(2 * sw + 3.2 * k)}" height="${n1(10.2 * k)}" rx="${n1(2 * k)}" fill="${VELO.casing}"/>`);
  out.push(`<rect x="${n1(-sw)}" y="${n1(sy)}" width="${n1(2 * sw)}" height="${n1(7 * k)}" rx="${n1(1 * k)}" fill="${VELO.brick}"/>`);
  out.push(`<path d="M${n1(-sw)} ${n1(sy)} H${n1(sw)} L${n1(sw - 1.5 * k)} ${n1(sy + 3 * k)} H${n1(-sw + 1.5 * k)} Z" fill="${VELO.roof}"/>`);
  for (let i = -2; i <= 2; i++) if (i) out.push(`<rect x="${n1(i * sw * 0.38 - 1.2 * k)}" y="${n1(sy + 4.2 * k)}" width="${n1(2.4 * k)}" height="${n1(1.6 * k)}" fill="#9CCBE6"/>`);
  out.push(`<rect x="${n1(-3.2 * k)}" y="${n1(sy - 0.5 * k)}" width="${n1(6.4 * k)}" height="${n1(8.6 * k)}" rx="${n1(0.8 * k)}" fill="${VELO.brick}" stroke="${VELO.casing}" stroke-width="${n1(0.6 * k)}"/>`); // pavillon d'entrée
  // Piste sur son liseré blanc : le haut du virage plus sombre (le dévers), une ligne peinte, la bande bleue, la pelouse.
  out.push(`<path d="${stadium(w + 3 * k, h + 3 * k)}" fill="${VELO.casing}"/>`);
  out.push(`<path d="${stadium(w, h)}" fill="${track}"/>`);
  out.push(`<path d="${stadium(w - 0.9 * k, h - 0.9 * k)}" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="${n1(1.8 * k)}"/>`);
  out.push(`<path d="${stadium(w - t * 0.6, h - t * 0.6)}" fill="none" stroke="${VELO.white}" stroke-opacity=".8" stroke-width="${n1(0.6 * k)}"/>`);
  out.push(`<path d="${stadium(w - t, h - t)}" fill="${VELO.band}"/>`);
  const iw = w - t - 1.4 * k;
  const ih = h - t - 1.4 * k;
  out.push(`<path d="${stadium(iw, ih)}" fill="${VELO.infield}"/>`);
  // Bandes de tonte et terrain de rugby.
  const px = iw - ih * 0.55;
  for (let i = 0; i < 6; i += 2) out.push(`<rect x="${n1(-px + (2 * px * i) / 6)}" y="${n1(-ih * 0.62)}" width="${n1((2 * px) / 6)}" height="${n1(ih * 1.24)}" fill="${VELO.stripe}"/>`);
  out.push(`<rect x="${n1(-px)}" y="${n1(-ih * 0.62)}" width="${n1(2 * px)}" height="${n1(ih * 1.24)}" fill="none" stroke="${VELO.white}" stroke-width="${n1(0.7 * k)}"/>`);
  out.push(`<line x1="0" y1="${n1(-ih * 0.62)}" x2="0" y2="${n1(ih * 0.62)}" stroke="${VELO.white}" stroke-width="${n1(0.7 * k)}"/>`);
  // Damier de la ligne d'arrivée, en travers de la ligne droite du bas.
  const cx = 4 * k;
  const sq = t / 3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) out.push(`<rect x="${n1(cx + c * sq * 0.8)}" y="${n1(h - t + r * sq)}" width="${n1(sq * 0.8)}" height="${n1(sq)}" fill="${(r + c) % 2 ? VELO.ink : VELO.white}"/>`);
  }
  // Porte des coureurs : une ouverture dans le liseré de la ligne droite du haut, entre deux piliers.
  const gx = 4.5 * k;
  out.push(`<rect x="${n1(gx - 2.4 * k)}" y="${n1(-h - 3.2 * k)}" width="${n1(4.8 * k)}" height="${n1(3.4 * k)}" fill="${track}"/>`);
  for (const sx of [-1, 1]) out.push(`<rect x="${n1(gx + sx * 2.6 * k - 0.9 * k)}" y="${n1(-h - 4 * k)}" width="${n1(1.8 * k)}" height="${n1(2.6 * k)}" rx="${n1(0.4 * k)}" fill="${VELO.brick}"/>`);
  return out.join('');
}

/** Points de la route échantillonnés tous les `stepM`, convertis par `to`. */
function polyline(edge: Edge, to: (x: number, z: number) => Pt, stepM: number): string {
  return edge
    .sample(stepM)
    .map((p, i) => {
      const q = to(p.x, p.z);
      return `${i ? 'L' : 'M'}${n1(q.x)} ${n1(q.y)}`;
    })
    .join(' ');
}

/** Un profil d'altitude dans le cadre [x, x+w] × [y, y+h] : zone colorée, repères d'altitude, nom des routes dessous. */
function profileChart(g: CourseGeometry, range: { lo: number; hi: number }, x: number, y: number, w: number, h: number, fs: number): string {
  const { pts, marks } = profileOf(g);
  const { lo, hi } = range;
  const left = 38 * fs;
  const px = (d: number) => x + left + (d / g.lengthM) * (w - left);
  const py = (a: number) => y + h - ((a - lo) / (hi - lo)) * h;
  const out: string[] = [];
  for (const a of [lo, hi]) {
    out.push(`<line x1="${n1(x + left)}" y1="${n1(py(a))}" x2="${n1(x + w)}" y2="${n1(py(a))}" stroke="${COLORS.grid}"/>`);
    out.push(`<text x="${n1(x + left - 6 * fs)}" y="${n1(py(a) + 4 * fs)}" font-size="${n1(12 * fs)}" fill="${COLORS.muted}" text-anchor="end">${a} m</text>`);
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${n1(px(p.d))} ${n1(py(p.alt))}`).join(' ');
  out.push(`<path d="${line} L${n1(px(g.lengthM))} ${n1(py(lo))} L${n1(px(0))} ${n1(py(lo))} Z" fill="${g.fill}"/>`);
  out.push(`<path d="${line}" fill="none" stroke="${g.color}" stroke-width="${n1(3 * fs)}" stroke-linejoin="round"/>`);
  marks.forEach((m, i) => {
    if (i > 0) out.push(`<line x1="${n1(px(m.d))}" y1="${n1(py(lo))}" x2="${n1(px(m.d))}" y2="${n1(py(lo) + 7 * fs)}" stroke="${COLORS.muted}"/>`);
    const wPx = px(m.to) - px(m.d);
    out.push(
      `<text x="${n1((px(m.d) + px(m.to)) / 2)}" y="${n1(py(lo) + 22 * fs)}" font-size="${n1((wPx < 80 * fs ? 11 : 12) * fs)}" fill="${COLORS.ink}" text-anchor="middle">${esc(m.name)}</text>`,
    );
  });
  return out.join('\n');
}

/**
 * Profil d'altitude d'un parcours seul, à l'échelle commune du réseau : pour l'écran de choix. Un cadre `width` de large,
 * avec le nom, la longueur, la montée et la pente maximale au-dessus.
 */
export function renderCourseProfile(network: RoadNetwork, courseId: string, width = 460, fontScale = 1): NetworkMap {
  const geoms = network.courses.map((c, i) => geometryOf(network, c, i));
  const g = geoms.find((x) => x.course.id === courseId) ?? geoms[0]!;
  const range = altitudeRange(geoms);
  const PH = 150;
  const height = Math.round(58 + PH + 36 * fontScale);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${esc(FONT)}">` +
    `<text x="0" y="16" font-size="${n1(14 * fontScale)}" fill="${COLORS.muted}">${esc(
      `${fr(g.lengthM / 1000)} km · +${fr(Math.round(g.climbM / 10) * 10, 0)} m de montée · pente max ${fr(g.maxGradePct)} %`,
    )}</text>` +
    profileChart(g, range, 0, 32, width, PH, fontScale) +
    '</svg>';
  return { svg, width, height };
}

/**
 * Profil d'altitude réduit à son tracé, sans aucun texte, à l'échelle commune du réseau : pour les touches du choix de
 * parcours, où l'on compare d'un coup d'œil une montagne et un plat.
 */
export function renderCourseSparkline(network: RoadNetwork, courseId: string, width = 150, height = 52): NetworkMap {
  const geoms = network.courses.map((c, i) => geometryOf(network, c, i));
  const g = geoms.find((x) => x.course.id === courseId) ?? geoms[0]!;
  const { lo, hi } = altitudeRange(geoms);
  // Une vignette n'a pas besoin d'un point tous les 20 m : environ 80 points, en gardant toujours le dernier.
  const all = profileOf(g).pts;
  const every = Math.max(1, Math.floor(all.length / 80));
  const pts = all.filter((_, i) => i % every === 0 || i === all.length - 1);
  const px = (d: number) => (d / g.lengthM) * width;
  const py = (a: number) => height - 2 - ((a - lo) / (hi - lo)) * (height - 4);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${n1(px(p.d))} ${n1(py(p.alt))}`).join(' ');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">` +
    `<path d="${line} L${n1(width)} ${n1(py(lo))} L0 ${n1(py(lo))} Z" fill="${g.fill}"/>` +
    `<path d="${line}" fill="none" stroke="${g.color}" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
  return { svg, width, height };
}

export function renderNetworkMap(network: RoadNetwork, opts: MapOptions = {}): NetworkMap {
  const { layout = 'sheet', selected, labels = 'all', fontScale = 1, stepM = 20, pxPerUnit, minTextPx } = opts;
  const fs = fontScale;
  /** Taille d'un texte : grossie par `fontScale`, et jamais plus petite que `minTextPx` une fois le dessin affiché. */
  const T = (px: number) => Math.max(px * fs, pxPerUnit && minTextPx ? minTextPx / pxPerUnit : 0);
  const thin = labels === 'none';
  /** Traits et pastilles épaissis pour une miniature, où la carte est vue très petite. */
  const lw = thin ? 2.4 : 1;
  const sheet = layout === 'sheet';

  const MAP_W = 820;
  const PAD = 70;
  const b = network.bounds();
  const spanX = b.maxX - b.minX;
  const spanZ = b.maxZ - b.minZ;
  const scale = (1500 - 2 * PAD) / spanZ;
  const H = Math.round(spanZ * scale + 2 * PAD);
  const W = sheet ? 1400 : MAP_W;
  const ox = PAD + (MAP_W - 2 * PAD - spanX * scale) / 2;
  const to = (x: number, z: number): Pt => ({ x: ox + (x - b.minX) * scale, y: PAD + (z - b.minZ) * scale });

  const courses = network.courses.map((c, i) => geometryOf(network, c, i));
  const chosen = courses.find((g) => g.course.id === selected);
  const inCourse = new Map<string, CourseGeometry[]>();
  for (const g of courses) for (const e of g.edges) inCourse.set(e.id, [...(inCourse.get(e.id) ?? []), g]);

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(FONT)}">`);
  out.push(`<title>${esc(network.name)} : carte des parcours</title>`);
  if (sheet) out.push(`<rect width="${W}" height="${H}" fill="${COLORS.paper}"/>`);

  /* ---------- Quadrillage de 1 km ---------- */
  if (!thin) {
    const kmX0 = Math.ceil(b.minX / 1000) * 1000;
    const kmZ0 = Math.ceil(b.minZ / 1000) * 1000;
    out.push(`<g stroke="${COLORS.grid}" stroke-width="1">`);
    for (let x = kmX0; x <= b.maxX; x += 1000) {
      const a = to(x, b.minZ - 250);
      const c = to(x, b.maxZ + 250);
      out.push(`<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(c.x)}" y2="${n1(c.y)}"/>`);
    }
    for (let z = kmZ0; z <= b.maxZ; z += 1000) {
      const a = to(b.minX - 250, z);
      const c = to(b.maxX + 250, z);
      out.push(`<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(c.x)}" y2="${n1(c.y)}"/>`);
    }
    out.push('</g>');
  }

  /* ---------- Lacs et canal ---------- */
  for (const w of network.water) {
    const d = w.shore.map((p, i) => `${i ? 'L' : 'M'}${n1(to(p[0], p[1]).x)} ${n1(to(p[0], p[1]).y)}`).join(' ');
    out.push(`<path d="${d} Z" fill="${COLORS.water}" stroke="${COLORS.shore}" stroke-width="${n1(1.5 * lw)}" stroke-linejoin="round"/>`);
  }

  /* ---------- Routes hors parcours, puis parcours ---------- */
  // La piste d'un vélodrome est dessinée par son icône, et ses deux nœuds (porte, ligne d'arrivée) n'en sont pas.
  const edges = [...network.edges.values()].filter((e) => e.def.surface !== 'track');
  const inVelodrome = (x: number, z: number) => network.velodromes.some((v) => v.covers(x, z));
  out.push(`<g fill="none" stroke-linecap="round" stroke-linejoin="round">`);
  for (const e of edges.filter((e) => !inCourse.has(e.id))) {
    const d = polyline(e, to, stepM);
    out.push(`<path d="${d}" stroke="${COLORS.roadCasing}" stroke-width="${n1(10 * lw)}"/><path d="${d}" stroke="${COLORS.road}" stroke-width="${n1(5 * lw)}"/>`);
  }
  for (const e of edges.filter((e) => inCourse.has(e.id))) {
    const d = polyline(e, to, stepM);
    const owners = inCourse.get(e.id)!;
    if (chosen && !owners.includes(chosen)) {
      // Le parcours choisi n'y passe pas : on la voit, mais en retrait.
      out.push(`<g opacity=".3"><path d="${d}" stroke="${COLORS.roadCasing}" stroke-width="${n1(15 * lw)}"/><path d="${d}" stroke="${owners[0]!.color}" stroke-width="${n1(8 * lw)}"/></g>`);
      continue;
    }
    out.push(`<path d="${d}" stroke="${COLORS.roadCasing}" stroke-width="${n1(15 * lw)}"/>`);
    out.push(`<path d="${d}" stroke="${(chosen ?? owners[0]!).color}" stroke-width="${n1(8 * lw)}"/>`);
    // Une route commune à plusieurs parcours, sans choix : les couleurs en tirets alternés.
    if (!chosen) owners.slice(1).forEach((g) => out.push(`<path d="${d}" stroke="${g.color}" stroke-width="${n1(8 * lw)}" stroke-dasharray="11 11"/>`));
  }
  out.push('</g>');

  /* ---------- Flèches de sens de marche et repères kilométriques ---------- */
  if (!thin) {
    const arrow = (p: Pt, heading: number, color: string) =>
      `<path d="M-6 -5 L6 0 L-6 5 Z" fill="${color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" transform="translate(${n1(p.x)} ${n1(p.y)}) rotate(${n1((heading * 180) / Math.PI)}) scale(${n1(fs)})"/>`;
    const seenArrows = new Set<string>();
    (chosen ? [chosen] : courses).forEach((g, ci) => {
      let d0 = 0;
      let nextKm = 2000;
      for (const e of g.edges) {
        for (let s = 450; s < e.lengthM - 150; s += 700) {
          const key = `${e.id}:${Math.round(s / 700)}`;
          if (seenArrows.has(key)) continue;
          seenArrows.add(key);
          const p = e.pointAt(s);
          out.push(arrow(to(p.x, p.z), e.headingAt(s), '#14171A'));
        }
        // Repère tous les 2 km, d'un côté puis de l'autre selon le parcours : pas de chevauchement.
        while (nextKm <= d0 + e.lengthM) {
          const p = e.pointAt(nextKm - d0);
          const h = e.headingAt(nextKm - d0);
          const side = ci % 2 === 0 ? 1 : -1;
          const q = to(p.x, p.z);
          const lx = q.x + Math.sin(h) * 20 * fs * side;
          const ly = q.y - Math.cos(h) * 20 * fs * side;
          out.push(`<circle cx="${n1(q.x)}" cy="${n1(q.y)}" r="${n1(3 * fs)}" fill="#fff" stroke="${g.color}" stroke-width="${n1(2 * fs)}"/>`);
          out.push(label(lx, ly + 4 * fs, `${nextKm / 1000}`, { size: T(12), weight: 700, fill: g.color, anchor: 'middle' }));
          nextKm += 2000;
        }
        d0 += e.lengthM;
      }
    });

    /* ---------- Repères : arches, Marie ---------- */
    for (const l of network.landmarks) {
      const e = network.edges.get(l.edge)!;
      if (l.kind === 'arch') {
        if (labels !== 'all') continue; // empilées autour des carrefours, elles font des taches sur une carte réduite
        const p = e.pointAt(l.s);
        const h = e.headingAt(l.s);
        const q = to(p.x, p.z);
        const dx = Math.sin(h) * 11 * fs;
        const dy = -Math.cos(h) * 11 * fs;
        out.push(`<line x1="${n1(q.x - dx)}" y1="${n1(q.y - dy)}" x2="${n1(q.x + dx)}" y2="${n1(q.y + dy)}" stroke="${COLORS.ink}" stroke-width="${n1(4 * fs)}" stroke-linecap="round"/>`);
      } else if (l.kind === 'marie') {
        const q = to(e.pointAt(l.s).x, e.pointAt(l.s).z);
        out.push(`<circle cx="${n1(q.x)}" cy="${n1(q.y)}" r="${n1(9 * fs)}" fill="#D9483B" stroke="#fff" stroke-width="2"/>`);
        out.push(`<text x="${n1(q.x)}" y="${n1(q.y + 4 * fs)}" font-size="${n1(T(11))}" font-weight="800" fill="#fff" text-anchor="middle">M</text>`);
      } else if (l.kind === 'richard') {
        const q = to(e.pointAt(l.s).x, e.pointAt(l.s).z);
        out.push(`<circle cx="${n1(q.x)}" cy="${n1(q.y)}" r="${n1(9 * fs)}" fill="#F08A24" stroke="#fff" stroke-width="2"/>`);
        out.push(`<text x="${n1(q.x)}" y="${n1(q.y + 4 * fs)}" font-size="${n1(T(11))}" font-weight="800" fill="#fff" text-anchor="middle">R</text>`);
      }
    }
  }

  /* ---------- Noms des routes ---------- */
  if (labels === 'all') {
    for (const e of edges) {
      const mid = e.pointAt(e.lengthM / 2);
      const h = e.headingAt(e.lengthM / 2);
      const q = to(mid.x, mid.z);
      // De l'autre côté des repères kilométriques : à droite de la route dans son sens.
      const lx = q.x - Math.sin(h) * 26 * fs;
      const ly = q.y + Math.cos(h) * 26 * fs;
      const right = -Math.sin(h) >= 0;
      const width = e.name.length * 7.4 * fs; // largeur approximative du texte
      const x = right ? Math.min(lx, MAP_W - 12 - width) : Math.max(lx, 12 + width);
      out.push(label(x, ly + 4 * fs, e.name, { size: T(13), weight: 600, fill: COLORS.muted, anchor: right ? 'start' : 'end', italic: true }));
    }
  }

  /* ---------- Vélodromes ---------- */
  for (const v of network.velodromes) {
    const q = to(v.def.x, v.def.z);
    const k = thin ? 1.7 : fs > 1 ? 1.25 * fs : 1;
    // Couleur de la piste : celle du parcours qui y tourne ; en retrait si un autre parcours est mis en avant.
    const owners = [...network.edges.values()].filter((e) => e.def.surface === 'track').flatMap((e) => inCourse.get(e.id) ?? []);
    const color = chosen && owners.includes(chosen) ? chosen.color : (owners[0]?.color ?? COLORS.road);
    const dim = chosen !== undefined && !owners.includes(chosen);
    out.push(`<g transform="translate(${n1(q.x)} ${n1(q.y)}) rotate(${n1((-v.def.yaw * 180) / Math.PI)})"${dim ? ' opacity=".55"' : ''}>${velodromeIcon(color, k)}</g>`);
    if (labels !== 'none') {
      const y = q.y + 30 * k + 14 * fs;
      out.push(label(q.x, y, v.def.name, { size: T(16), weight: 800, anchor: 'middle' }));
      out.push(label(q.x, y + 16 * fs, `piste de 500 m · ${Math.round(v.def.altitude)} m`, { size: T(13), weight: 500, fill: COLORS.muted, anchor: 'middle' }));
    }
  }

  /* ---------- Carrefours ---------- */
  const summit = edges.reduce((m, e) => (e.to.altitude > m.to.altitude ? e : m)).to;
  const junctions = [...network.nodes.values()].filter((n) => !inVelodrome(n.x, n.z));
  for (const node of junctions) {
    const q = to(node.x, node.z);
    const degree = network.incident(node.id).length;
    const right = node.x < (b.minX + b.maxX) / 2;
    if (node.id === summit.id) {
      const r = 12 * (thin ? 2 : fs > 1 ? 1.4 : 1);
      out.push(`<path d="M${n1(q.x)} ${n1(q.y - r * 1.1)} L${n1(q.x + r)} ${n1(q.y + r * 0.75)} L${n1(q.x - r)} ${n1(q.y + r * 0.75)} Z" fill="${COLORS.ink}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>`);
    } else {
      const r = (degree >= 3 ? 11 : 8) * (thin ? 2 : fs > 1 ? 1.4 : 1);
      out.push(`<circle cx="${n1(q.x)}" cy="${n1(q.y)}" r="${n1(r)}" fill="#fff" stroke="${COLORS.ink}" stroke-width="${n1(3.5 * (thin ? 2 : 1))}"/>`);
    }
    if (labels !== 'none') {
      const lx = q.x + (right ? 18 : -18) * fs;
      const anchor = right ? 'start' : 'end';
      out.push(label(lx, q.y - 2 * fs, node.name, { size: T(16), weight: 800, anchor }));
      out.push(label(lx, q.y + 15 * fs, `${Math.round(node.altitude)} m`, { size: T(13), weight: 500, fill: COLORS.muted, anchor }));
    }
  }

  /* ---------- Échelle, nord et, hors planche, légende ---------- */
  if (!thin) {
    out.push(`<g transform="translate(${n1(PAD - 20)} ${n1(H - 34 * fs)})"><rect width="${n1(1000 * scale)}" height="${n1(6 * fs)}" fill="${COLORS.ink}"/><text y="${n1(-6 * fs)}" font-size="${n1(T(12))}" font-weight="700" fill="${COLORS.ink}">1 km</text></g>`);
    out.push(`<g transform="translate(${MAP_W - 44} ${n1(H - 66 * fs)}) scale(${n1(fs)})"><path d="M0 -26 L9 6 L0 0 L-9 6 Z" fill="${COLORS.ink}"/><text y="26" font-size="15" font-weight="800" fill="${COLORS.ink}" text-anchor="middle">N</text></g>`);
  }
  if (!sheet && !thin) {
    let ly = 28 * fs;
    for (const g of courses) {
      const dim = chosen !== undefined && chosen !== g;
      out.push(`<g opacity="${dim ? 0.4 : 1}"><path d="M16 ${n1(ly)} H${n1(16 + 46 * fs)}" stroke="${g.color}" stroke-width="${n1(8 * fs)}" stroke-linecap="round"/>`);
      out.push(`<text x="${n1(28 + 46 * fs)}" y="${n1(ly + 5 * fs)}" font-size="${n1(T(16))}" font-weight="700" fill="${COLORS.ink}">${esc(g.course.name)}</text></g>`);
      ly += 30 * fs;
    }
  }

  /* ---------- Colonne de droite de la planche : titre, légende, profils ---------- */
  if (sheet) {
    const X = MAP_W + 20;
    const CW = W - X - 40;
    out.push(`<text x="${X}" y="62" font-size="38" font-weight="800" fill="${COLORS.ink}">${esc(network.name)}</text>`);
    out.push(
      `<text x="${X}" y="90" font-size="16" fill="${COLORS.muted}">${esc(
        `${fr(network.lengthM / 1000)} km de routes · ${junctions.length} carrefours${network.velodromes.length ? ` · ${network.velodromes.length} vélodrome` : ''} · pentes jusqu'à ${fr(Math.max(...courses.map((g) => g.maxGradePct)), 0)} %`,
      )}</text>`,
    );

    let y = 128;
    for (const g of courses) {
      out.push(`<path d="M${X} ${y} H${X + 46}" stroke="${g.color}" stroke-width="8" stroke-linecap="round"/>`);
      out.push(`<text x="${X + 60}" y="${y + 5}" font-size="16" font-weight="700" fill="${COLORS.ink}">${esc(g.course.name)}</text>`);
      y += 26;
    }
    const shared = [...inCourse.values()].find((o) => o.length > 1);
    if (shared) {
      out.push(`<path d="M${X} ${y} H${X + 46}" stroke="${shared[0]!.color}" stroke-width="8" stroke-linecap="round"/>`);
      out.push(`<path d="M${X} ${y} H${X + 46}" stroke="${shared[1]!.color}" stroke-width="8" stroke-dasharray="11 11"/>`);
      out.push(`<text x="${X + 60}" y="${y + 5}" font-size="16" fill="${COLORS.ink}">Route commune aux parcours</text>`);
      y += 26;
    }
    out.push(`<path d="M${X} ${y} H${X + 46}" stroke="${COLORS.road}" stroke-width="5" stroke-linecap="round"/>`);
    out.push(`<text x="${X + 60}" y="${y + 5}" font-size="16" fill="${COLORS.ink}">Route hors parcours (on y va en explorant)</text>`);
    y += 26;
    out.push(`<line x1="${X + 23}" y1="${y - 9}" x2="${X + 23}" y2="${y + 9}" stroke="${COLORS.ink}" stroke-width="4" stroke-linecap="round"/>`);
    out.push(`<text x="${X + 60}" y="${y + 5}" font-size="16" fill="${COLORS.ink}">Arche</text>`);
    out.push(`<circle cx="${X + 23}" cy="${y + 28}" r="9" fill="#D9483B" stroke="#fff" stroke-width="2"/><text x="${X + 23}" y="${y + 32}" font-size="11" font-weight="800" fill="#fff" text-anchor="middle">M</text>`);
    out.push(`<text x="${X + 60}" y="${y + 33}" font-size="16" fill="${COLORS.ink}">Marie, qui répare son vélo</text>`);
    out.push(`<circle cx="${X + 23}" cy="${y + 56}" r="9" fill="#F08A24" stroke="#fff" stroke-width="2"/><text x="${X + 23}" y="${y + 60}" font-size="11" font-weight="800" fill="#fff" text-anchor="middle">R</text>`);
    out.push(`<text x="${X + 60}" y="${y + 61}" font-size="16" fill="${COLORS.ink}">Richard, sur la roue arrière dans l’escalier</text>`);
    let extra = 0;
    if (network.velodromes.length) {
      out.push(`<g transform="translate(${X + 23} ${y + 88})">${velodromeIcon(courses.find((g) => g.course.id === 'velodrome')?.color ?? COLORS.road, 0.62)}</g>`);
      out.push(`<text x="${X + 60}" y="${y + 93}" font-size="16" fill="${COLORS.ink}">Vélodrome : on y tourne tant qu’on veut</text>`);
      extra = 36;
    }
    out.push(`<text x="${X}" y="${y + 94 + extra}" font-size="14" fill="${COLORS.muted}">Flèches : sens de marche · numéros : kilomètres de la boucle</text>`);

    y += 140 + extra;
    const PH = 150;
    const range = altitudeRange(courses);
    for (const g of courses) {
      out.push(`<text x="${X}" y="${y + 12}" font-size="20" font-weight="800" fill="${g.color}">${esc(g.course.name)}</text>`);
      out.push(
        `<text x="${X}" y="${y + 32}" font-size="14" fill="${COLORS.muted}">${esc(
          `${fr(g.lengthM / 1000)} km · +${fr(Math.round(g.climbM / 10) * 10, 0)} m de montée · pente max ${fr(g.maxGradePct)} %`,
        )}</text>`,
      );
      out.push(profileChart(g, range, X, y + 58, CW, PH, 1));
      y += PH + 118;
    }
    out.push(
      `<text x="${X}" y="${H - 18}" font-size="12" fill="${COLORS.muted}">Généré par « npm run map » d'après src/sim/courses/ : à régénérer quand les routes changent.</text>`,
    );
  }

  out.push('</svg>');
  return { svg: out.join('\n'), width: W, height: H };
}
