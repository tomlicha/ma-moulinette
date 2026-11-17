/**
 * Logique pure de la carte de l'encart (sans DOM) : projection « route devant soi en haut », cadrage, placement des noms de
 * routes au carrefour, textes, et machine à états de la bascule Liste / Carte. Référence : docs/design/sortie.md.
 */
import { formatGap, type NearbyRiders } from '../render/others-model';

export interface Pt {
  x: number;
  z: number;
}

/** Cap et position du coureur dans le monde : x vers l'est, z vers le sud, cap = `atan2(dz, dx)`. */
export interface SelfPose extends Pt {
  heading: number;
}

/** Hauteur de la carte en mètres : 440 m devant, 165 m derrière environ (ancre à 73 % du haut). */
export const VIEW_M = 620;
export const ANCHOR_Y = 0.73;

export interface Frame {
  w: number;
  h: number;
  /** Pixels par mètre. */
  ppm: number;
  /** Position du coureur dans le cadre, en px. */
  cx: number;
  cy: number;
}

/** Cadre d'une carte de `w` × `h` px : l'échelle suit la hauteur, le coureur est centré en largeur, aux trois quarts en bas. */
export function frameFor(w: number, h: number): Frame {
  return { w, h, ppm: h / VIEW_M, cx: w / 2, cy: h * ANCHOR_Y };
}

/** Passe d'un point du monde à un point du cadre, le cap du coureur pointant vers le haut. */
export function projector(self: SelfPose, f: Frame): (p: Pt) => [number, number] {
  const fx = Math.cos(self.heading);
  const fz = Math.sin(self.heading);
  return (p) => {
    const dx = p.x - self.x;
    const dz = p.z - self.z;
    return [f.cx + f.ppm * (dx * -fz + dz * fx), f.cy - f.ppm * (dx * fx + dz * fz)];
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Tracé SVG d'une suite de points projetés. */
export function pathOf(pts: readonly Pt[], proj: (p: Pt) => [number, number], close = false): string {
  let d = '';
  pts.forEach((p, i) => {
    const [x, y] = proj(p);
    d += `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`;
  });
  return close ? d + 'Z' : d;
}

/** Ramène un point dans le cadre, à `margin` px du bord ; `out` dit s'il en était sorti. */
export function clampToFrame(x: number, y: number, f: Frame, margin = 7): { x: number; y: number; out: boolean } {
  const cx = Math.min(f.w - margin, Math.max(margin, x));
  const cy = Math.min(f.h - margin, Math.max(margin, y));
  return { x: cx, y: cy, out: cx !== x || cy !== y };
}

export interface LabelPlace {
  x: number;
  y: number;
  anchor: 'start' | 'end';
}

/**
 * Où poser le nom d'une route proposée au carrefour : au bord de la carte, du côté où part la route, au-dessus de son
 * extrémité si elle monte à l'écran, au-dessous sinon. `lines` : 1 (nom) ou 2 (nom et montée). `y` est la ligne de base du nom.
 */
export function placeLabel(end: readonly [number, number], node: readonly [number, number], f: Frame, fs: number, lines: 1 | 2): LabelPlace {
  const left = end[0] < node[0];
  const above = end[1] < node[1] + 2;
  const raw = above ? end[1] - (lines === 2 ? fs + 2 : 5) : end[1] + fs + 1;
  const y = Math.max(fs + 2, Math.min(f.h - (lines === 2 ? fs + 4 : 6), raw));
  return { x: left ? 6 : f.w - 6, y, anchor: left ? 'start' : 'end' };
}

/** Montée d'une route proposée, en texte : « +357 m », ou « plat » sous 10 m (comme le panneau du carrefour). */
export function climbText(climbM: number): string {
  return climbM >= 10 ? `+${Math.round(climbM)} m` : 'plat';
}

/** Pied de la carte : l'étendue du groupe affiché, comme la liste. Vide quand il n'y a personne. */
export function rangeText(n: NearbyRiders | undefined): string {
  if (!n) return '';
  const front = n.ahead[0]; // le plus éloigné devant
  const back = n.behind[n.behind.length - 1]; // le plus éloigné derrière
  const count = n.ahead.length + n.behind.length;
  if (!front && !back) return '';
  const who = count === 1 ? '1 autre' : `${count} autres`;
  if (front && back) return `${who} · de ${formatGap(back.gapM)} à ${formatGap(front.gapM)}`;
  return `${who} · ${formatGap((front ?? back)!.gapM)}`;
}

/** Texte d'en-tête pendant un carrefour : « Le Moulin · 210 m » (le HUD dit déjà « Carrefour »). `null` une fois le nœud passé. */
export function junctionHeader(name: string, remainingM: number): string | null {
  if (remainingM < 0) return null;
  return `${name} · ${Math.round(remainingM / 10) * 10} m`;
}

export type Tab = 'list' | 'map';

/** Durée de maintien de la carte après le carrefour, en ms. */
export const HOLD_AFTER_MS = 10_000;

interface Auto {
  /** Où se trouve le nœud sur le trajet, en m. */
  atM: number;
  /** Onglet à rendre après le carrefour. */
  before: Tab;
  /** Instant où le nœud a été passé. */
  passedAt?: number;
  /** Le coureur a choisi lui-même un onglet pendant l'approche : rien à rendre. */
  manual: boolean;
}

/**
 * Onglet de l'encart. Le choix du coureur (`pref`, à mémoriser) vaut tant qu'aucun carrefour n'approche. Quand un carrefour
 * est annoncé (250 m avant), l'encart passe seul sur la carte, y compris en séance ; il revient à l'onglet d'avant 10 s
 * après le nœud, sauf si le coureur a basculé lui-même entre-temps.
 */
export class TabController {
  private current: Tab;
  private auto: Auto | undefined;

  constructor(private chosen: Tab = 'map') {
    this.current = chosen;
  }

  /** Onglet affiché. */
  get tab(): Tab {
    return this.current;
  }

  /** Dernier choix du coureur, celui qu'on mémorise. */
  get pref(): Tab {
    return this.chosen;
  }

  /** Vrai de l'annonce du carrefour jusqu'à la fin du maintien. */
  get junction(): boolean {
    return this.auto !== undefined;
  }

  /** Le coureur touche un onglet. */
  select(tab: Tab): void {
    this.chosen = tab;
    this.current = tab;
    if (this.auto) this.auto.manual = true;
  }

  /**
   * À appeler à chaque rafraîchissement. `pending` : le carrefour annoncé et pas encore verrouillé (de 250 à 40 m avant le
   * nœud) ; il disparaît au verrouillage, le maintien continue donc sans lui jusqu'au nœud, puis 10 s.
   */
  tick(i: { distanceM: number; pending: { atM: number } | undefined; now: number }): void {
    const a = this.auto;
    if (i.pending) {
      if (!a) {
        this.auto = { atM: i.pending.atM, before: this.current, manual: false };
        this.current = 'map';
      } else if (a.atM !== i.pending.atM) {
        a.atM = i.pending.atM; // un autre carrefour s'annonce avant la fin du maintien
        delete a.passedAt;
      }
      return;
    }
    if (!a) return;
    if (i.distanceM < a.atM - 300) return this.release(); // le trajet est reparti du début : plus de carrefour
    if (i.distanceM >= a.atM && a.passedAt === undefined) a.passedAt = i.now;
    if (a.passedAt !== undefined && i.now - a.passedAt >= HOLD_AFTER_MS) this.release();
  }

  private release(): void {
    const a = this.auto!;
    this.auto = undefined;
    if (!a.manual) this.current = a.before;
  }
}
