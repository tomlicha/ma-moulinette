/**
 * Rendu SVG de la carte de l'encart : le réseau en gris-bleu, la route du coureur en accent (devant en plein, derrière
 * estompée), les autres coureurs aux couleurs de leur maillot, et au carrefour les routes proposées, nommées. Route devant
 * soi en haut. La fonction `mapSvg` est pure ; `RideMap` ne fait que la poser dans le DOM, à la taille de son conteneur.
 */
import { hueOf } from '../render/others-model';
import type { RoadNetwork } from '../sim/network';
import { clampToFrame, frameFor, pathOf, placeLabel, projector, type Frame, type Pt } from './ride-map-model';
import type { MapScene } from './ride-map-scene';

const ACCENT = '#5BE3C9';
const INK = '#0B1422';
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
    roads: [...net.edges.values()].map((e) => e.sample(30).map((p) => ({ x: p.x, z: p.z }))),
    water: net.water.map((w) => w.shore.map(([x, z]) => ({ x, z }))),
  };
}

const f1 = (v: number) => Math.round(v * 10) / 10;

function text(t: string, x: number, y: number, o: { anchor?: 'start' | 'end' | 'middle'; weight?: number; fill?: string } = {}): string {
  const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return (
    `<text x="${f1(x)}" y="${f1(y)}" font-family="${FONT}" font-size="${FS}" font-weight="${o.weight ?? 600}" text-anchor="${o.anchor ?? 'start'}" ` +
    `fill="${o.fill ?? '#fff'}" stroke="#141C28" stroke-width="${f1(FS * 0.32)}" stroke-linejoin="round" paint-order="stroke">${esc}</text>`
  );
}

/** Petites flèches « > » le long de la route devant soi, tous les `CHEVRON_PX` px d'écran, dans le cadre. */
function chevrons(pts: readonly [number, number][], f: Frame): string {
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
        out += `<path d="M${f1(px - ux * 2.6 - uy * 2.4)} ${f1(py - uy * 2.6 + ux * 2.4)}L${f1(px + ux * 1.6)} ${f1(py + uy * 1.6)}L${f1(px - ux * 2.6 + uy * 2.4)} ${f1(py - uy * 2.6 - ux * 2.4)}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      t += CHEVRON_PX;
    }
    carry = t - len;
  }
  return out;
}

/** La carte, en SVG, pour un cadre de `w` × `h` px. `clipId` : identifiant du masque (unique dans la page). */
export function mapSvg(scene: MapScene, net: MapNetwork, w: number, h: number, clipId = 'rm-clip'): string {
  const f = frameFor(w, h);
  const P = projector(scene.self, f);
  const wide = w >= WIDE_MIN_W;
  const small = !wide; // téléphone : routes un peu plus fines
  const road = small ? 2.6 : 3;
  const course = small ? 4 : 4.5;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Carte : ta position sur le réseau, route devant toi en haut">`;
  s += `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${w}" height="${h}" rx="9"/></clipPath></defs>`;
  s += `<g clip-path="url(#${clipId})"><rect width="${w}" height="${h}" fill="#243246"/>`;
  for (const lake of net.water) s += `<path d="${pathOf(lake, P, true)}" fill="#3A86B0" fill-opacity=".55"/>`;
  for (const r of net.roads) s += `<path d="${pathOf(r, P)}" fill="none" stroke="#141C28" stroke-opacity=".7" stroke-width="${road + 2.4}" stroke-linecap="round" stroke-linejoin="round"/>`;
  for (const r of net.roads) s += `<path d="${pathOf(r, P)}" fill="none" stroke="#9FB0C6" stroke-width="${road}" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="${pathOf(scene.behind, P)}" fill="none" stroke="${ACCENT}" stroke-opacity=".38" stroke-width="${course}" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="${pathOf(scene.ahead, P)}" fill="none" stroke="${ACCENT}" stroke-width="${course}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (wide) s += chevrons(scene.ahead.map((p) => P(p)), f);

  const j = scene.junction;
  if (j) {
    const jp = P(j.node);
    for (const o of j.options) {
      if (!o.selected) s += `<path d="${pathOf(o.pts, P)}" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="${course}" stroke-linecap="round" stroke-linejoin="round"/>`;
      const end = P(o.pts[o.pts.length - 1]!);
      const at = placeLabel(end, jp, f, FS, 2);
      const fill = o.selected ? ACCENT : '#fff';
      s += text(o.label, at.x, at.y, { anchor: at.anchor, weight: o.selected ? 700 : 600, fill });
      s += text(o.sub, at.x, at.y + FS, { anchor: at.anchor, weight: 500, fill: '#D3DCE8' });
    }
    s += `<circle cx="${f1(jp[0])}" cy="${f1(jp[1])}" r="5" fill="#fff" stroke="${INK}" stroke-width="2"/>`;
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
  s += `<circle cx="${f1(me[0])}" cy="${f1(me[1])}" r="${R + 5}" fill="${ACCENT}" fill-opacity=".28"/>`;
  s += `<path d="M${f1(me[0])} ${f1(me[1] - R - 8)}L${f1(me[0] - 5)} ${f1(me[1] - R - 1)}L${f1(me[0] + 5)} ${f1(me[1] - R - 1)}Z" fill="#fff"/>`;
  s += `<circle cx="${f1(me[0])}" cy="${f1(me[1])}" r="${R}" fill="${ACCENT}" stroke="#fff" stroke-width="2"/>`;

  // Boussole : seulement quand la carte est assez large pour ne rien cacher (ordinateur).
  if (wide) {
    const px = w - 18;
    const py = 18;
    const n0 = P({ x: scene.self.x, z: scene.self.z });
    const n1 = P({ x: scene.self.x, z: scene.self.z - 100 });
    const len = Math.hypot(n1[0] - n0[0], n1[1] - n0[1]) || 1;
    const nx = (n1[0] - n0[0]) / len;
    const ny = (n1[1] - n0[1]) / len;
    s += `<circle cx="${px}" cy="${py}" r="12.5" fill="#141C28" fill-opacity=".8" stroke="#fff" stroke-opacity=".5"/>`;
    s += `<path d="M${f1(px + nx * 10.5)} ${f1(py + ny * 10.5)}L${f1(px - ny * 4.2)} ${f1(py + nx * 4.2)}L${f1(px + ny * 4.2)} ${f1(py - nx * 4.2)}Z" fill="#FF5C7A"/>`;
    s += `<text x="${f1(px - nx * 5)}" y="${f1(py - ny * 5 + 4)}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="#fff">N</text>`;
  }
  s += `</g><rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="9" fill="none" stroke="#fff" stroke-opacity=".22"/></svg>`;
  return s;
}

let seq = 0;

/** Pose la carte dans `host`, à sa taille : à rappeler à chaque nouvelle scène. */
export class RideMap {
  private readonly net: MapNetwork;
  private readonly id = `rm-clip-${seq++}`;

  constructor(private readonly host: HTMLElement, network: RoadNetwork) {
    this.net = mapNetwork(network);
  }

  render(scene: MapScene): void {
    const w = Math.round(this.host.clientWidth);
    const h = Math.round(this.host.clientHeight);
    if (w < 40 || h < 40) return; // encart masqué ou pas encore mis en page
    this.host.innerHTML = mapSvg(scene, this.net, w, h, this.id);
  }
}
