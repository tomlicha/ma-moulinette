/**
 * Rendu SVG de la carte de l'encart : le réseau en gris-bleu, la route du coureur en accent (devant en plein, derrière
 * estompée), les autres coureurs aux couleurs de leur maillot, et au carrefour les routes proposées, nommées. Route devant
 * soi en haut. La fonction `mapSvg` est pure ; `RideMap` ne fait que la poser dans le DOM, à la taille de son conteneur.
 */
import { hueOf } from '../render/others-model';
import type { RoadNetwork } from '../sim/network';
import { clampToFrame, frameFor, pathOf, placeLabel, projector, type Frame, type Pt } from './ride-map-model';
import type { MapScene } from './ride-map-scene';

/** Couleurs de la carte : claire ou sombre, comme les panneaux du HUD (hud.css), selon le réglage de l'appareil. */
export interface MapTheme {
  bg: string; bgOpacity: number; water: string; waterOpacity: number; casing: string; casingOpacity: number; road: string;
  /** Route du coureur, son point et le nom de la route choisie au carrefour. */
  accent: string;
  /** Textes, et leur halo (la couleur du fond) : un nom reste lisible par-dessus une route. */
  label: string; halo: string; sub: string;
  /** Routes proposées au carrefour, non choisies. */
  option: string;
  /** Flèches de sens de marche, contour du nœud du carrefour. */
  ink: string;
  /** Flèche du coureur (sens de marche). */
  arrow: string;
  compassBg: string; compassBgOpacity: number; compassEdge: string; needle: string; frame: string; frameOpacity: number;
}

/** Carte claire « Doux » (2026-11-18) : fond crème translucide, routes blanches, la route du coureur en orange. */
export const MAP_LIGHT: MapTheme = {
  bg: '#F3EEE6', bgOpacity: 0.72, water: '#9CC3E0', waterOpacity: 0.8, casing: '#8B8478', casingOpacity: 0.5, road: '#FFFFFF',
  accent: '#C2410C', label: '#14171A', halo: '#FFFBF6', sub: '#4F5865', option: '#4F5865', ink: '#14171A', arrow: '#14171A',
  compassBg: '#FFFFFF', compassBgOpacity: 0.9, compassEdge: '#8B8478', needle: '#D61F45', frame: '#5A3C1E', frameOpacity: 0.18,
};

/** Carte sombre (mode sombre de l'appareil) : bleu nuit, routes gris-bleu, la route du coureur en menthe. */
export const MAP_DARK: MapTheme = {
  bg: '#243246', bgOpacity: 1, water: '#3A86B0', waterOpacity: 0.55, casing: '#141C28', casingOpacity: 0.7, road: '#9FB0C6',
  accent: '#5BE3C9', label: '#FFFFFF', halo: '#141C28', sub: '#D3DCE8', option: '#FFFFFF', ink: '#0B1422', arrow: '#FFFFFF',
  compassBg: '#141C28', compassBgOpacity: 0.8, compassEdge: '#FFFFFF', needle: '#FF5C7A', frame: '#FFFFFF', frameOpacity: 0.22,
};

const FONT = 'Barlow,system-ui,sans-serif';
/** Texte de la carte, en px : jamais sous 12 px (docs/design/hud.md). */
const FS = 12.5;
/** Pas des flèches de sens de marche, en px. */
const CHEVRON_PX = 34;
/** Cadre assez large (ordinateur, 175 px) pour les flèches et la boussole ; l'encart du téléphone (158 px) s'en passe. */
const WIDE_MIN_W = 170;

/** Couleur du maillot d'un coureur, la même que sa pastille dans la liste (`near-riders.ts`). */
export const riderColor = (slot: number) => `hsl(${Math.round(hueOf(slot) * 360)} 70% 52%)`;

/** Le réseau, calculé une fois : routes et lacs en points du monde. */
export interface MapNetwork {
  roads: Pt[][];
  water: Pt[][];
}

export function mapNetwork(net: RoadNetwork): MapNetwork {
  return {
    // Un ascenseur n'a pas de tracé en plan : rien à dessiner.
    roads: [...net.edges.values()].filter((e) => !e.isLift).map((e) => e.sample(30).map((p) => ({ x: p.x, z: p.z }))),
    water: net.water.map((w) => w.shore.map(([x, z]) => ({ x, z }))),
  };
}

const f1 = (v: number) => Math.round(v * 10) / 10;

function text(th: MapTheme, t: string, x: number, y: number, o: { anchor?: 'start' | 'end' | 'middle'; weight?: number; fill?: string } = {}): string {
  const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return (
    `<text x="${f1(x)}" y="${f1(y)}" font-family="${FONT}" font-size="${FS}" font-weight="${o.weight ?? 600}" text-anchor="${o.anchor ?? 'start'}" ` +
    `fill="${o.fill ?? th.label}" stroke="${th.halo}" stroke-width="${f1(FS * 0.32)}" stroke-linejoin="round" paint-order="stroke">${esc}</text>`
  );
}

/** Petites flèches « > » le long de la route devant soi, tous les `CHEVRON_PX` px d'écran, dans le cadre. */
function chevrons(pts: readonly [number, number][], f: Frame, th: MapTheme): string {
  let out = '';
  let carry = CHEVRON_PX / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    let t = carry;
    while (t < len) {
      const px = ax + ux * t;
      const py = ay + uy * t;
      if (px > 6 && px < f.w - 6 && py > 6 && py < f.h - 6) {
        out += `<path d="M${f1(px - ux * 2.6 - uy * 2.4)} ${f1(py - uy * 2.6 + ux * 2.4)}L${f1(px + ux * 1.6)} ${f1(py + uy * 1.6)}L${f1(px - ux * 2.6 + uy * 2.4)} ${f1(py - uy * 2.6 - ux * 2.4)}" fill="none" stroke="${th.ink}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      t += CHEVRON_PX;
    }
    carry = t - len;
  }
  return out;
}

/** La carte, en SVG, pour un cadre de `w` × `h` px. `clipId` : identifiant du masque (unique dans la page). */
export function mapSvg(scene: MapScene, net: MapNetwork, w: number, h: number, clipId = 'rm-clip', th: MapTheme = MAP_LIGHT): string {
  const f = frameFor(w, h);
  const P = projector(scene.self, f);
  const wide = w >= WIDE_MIN_W;
  const small = !wide; // téléphone : routes un peu plus fines
  const road = small ? 2.6 : 3;
  const course = small ? 4 : 4.5;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Carte : ta position sur le réseau, route devant toi en haut">`;
  s += `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${w}" height="${h}" rx="9"/></clipPath></defs>`;
  s += `<g clip-path="url(#${clipId})"><rect width="${w}" height="${h}" fill="${th.bg}" fill-opacity="${th.bgOpacity}"/>`;
  for (const lake of net.water) s += `<path d="${pathOf(lake, P, true)}" fill="${th.water}" fill-opacity="${th.waterOpacity}"/>`;
  for (const r of net.roads) s += `<path d="${pathOf(r, P)}" fill="none" stroke="${th.casing}" stroke-opacity="${th.casingOpacity}" stroke-width="${road + 2.4}" stroke-linecap="round" stroke-linejoin="round"/>`;
  for (const r of net.roads) s += `<path d="${pathOf(r, P)}" fill="none" stroke="${th.road}" stroke-width="${road}" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="${pathOf(scene.behind, P)}" fill="none" stroke="${th.accent}" stroke-opacity=".38" stroke-width="${course}" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="${pathOf(scene.ahead, P)}" fill="none" stroke="${th.accent}" stroke-width="${course}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (wide) s += chevrons(scene.ahead.map((p) => P(p)), f, th);

  const j = scene.junction;
  if (j) {
    const jp = P(j.node);
    for (const o of j.options) {
      if (!o.selected) s += `<path d="${pathOf(o.pts, P)}" fill="none" stroke="${th.option}" stroke-opacity=".9" stroke-width="${course}" stroke-linecap="round" stroke-linejoin="round"/>`;
      const end = P(o.pts[o.pts.length - 1]!);
      const at = placeLabel(end, jp, f, FS, 2);
      const fill = o.selected ? th.accent : th.label;
      s += text(th, o.label, at.x, at.y, { anchor: at.anchor, weight: o.selected ? 700 : 600, fill });
      s += text(th, o.sub, at.x, at.y + FS, { anchor: at.anchor, weight: 500, fill: th.sub });
    }
    s += `<circle cx="${f1(jp[0])}" cy="${f1(jp[1])}" r="5" fill="#fff" stroke="${th.ink}" stroke-width="2"/>`;
  }

  const dot = small ? 3.4 : 4;
  for (const r of scene.riders) {
    const [x, y] = P(r);
    const c = clampToFrame(x, y, f);
    s += `<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="${dot}" fill="${riderColor(r.slot)}" fill-opacity="${c.out ? 0.7 : 1}" stroke="#fff" stroke-width="1.2"/>`;
  }

  // Le coureur : point d'accent cerclé de blanc, halo, et flèche vers le haut (le sens de marche).
  const me = P(scene.self);
  const R = 5.4;
  s += `<circle cx="${f1(me[0])}" cy="${f1(me[1])}" r="${R + 5}" fill="${th.accent}" fill-opacity=".28"/>`;
  s += `<path d="M${f1(me[0])} ${f1(me[1] - R - 8)}L${f1(me[0] - 5)} ${f1(me[1] - R - 1)}L${f1(me[0] + 5)} ${f1(me[1] - R - 1)}Z" fill="${th.arrow}"/>`;
  s += `<circle cx="${f1(me[0])}" cy="${f1(me[1])}" r="${R}" fill="${th.accent}" stroke="#fff" stroke-width="2"/>`;

  // Boussole : seulement quand la carte est assez large pour ne rien cacher (ordinateur).
  if (wide) {
    const px = w - 18;
    const py = 18;
    const n0 = P({ x: scene.self.x, z: scene.self.z });
    const n1 = P({ x: scene.self.x, z: scene.self.z - 100 });
    const len = Math.hypot(n1[0] - n0[0], n1[1] - n0[1]) || 1;
    const nx = (n1[0] - n0[0]) / len;
    const ny = (n1[1] - n0[1]) / len;
    s += `<circle cx="${px}" cy="${py}" r="12.5" fill="${th.compassBg}" fill-opacity="${th.compassBgOpacity}" stroke="${th.compassEdge}" stroke-opacity=".5"/>`;
    s += `<path d="M${f1(px + nx * 10.5)} ${f1(py + ny * 10.5)}L${f1(px - ny * 4.2)} ${f1(py + nx * 4.2)}L${f1(px + ny * 4.2)} ${f1(py - nx * 4.2)}Z" fill="${th.needle}"/>`;
    s += `<text x="${f1(px - nx * 5)}" y="${f1(py - ny * 5 + 4)}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="${th.label}">N</text>`;
  }
  s += `</g><rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="9" fill="none" stroke="${th.frame}" stroke-opacity="${th.frameOpacity}"/></svg>`;
  return s;
}

let seq = 0;

/** Pose la carte dans `host`, à sa taille : à rappeler à chaque nouvelle scène. */
export class RideMap {
  private readonly net: MapNetwork;
  private readonly id = `rm-clip-${seq++}`;

  /** Mode sombre de l'appareil : relu à chaque rendu, la carte suit un changement de réglage en cours de sortie. */
  private readonly dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;

  constructor(private readonly host: HTMLElement, network: RoadNetwork) {
    this.net = mapNetwork(network);
  }

  render(scene: MapScene): void {
    const w = Math.round(this.host.clientWidth);
    const h = Math.round(this.host.clientHeight);
    if (w < 40 || h < 40) return; // encart masqué ou pas encore mis en page
    this.host.innerHTML = mapSvg(scene, this.net, w, h, this.id, this.dark?.matches ? MAP_DARK : MAP_LIGHT);
  }
}
