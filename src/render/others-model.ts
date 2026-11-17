/** Logique pure des autres coureurs (sans Three.js), pour la tester : voie, et noms qui ne se recouvrent pas. */

/** Voie du coureur : proche de celle du joueur sans la recouvrir, étalée selon sa place pour que deux autres ne se confondent pas. */
export function laneOf(slot: number, baseM: number): number {
  return baseM + (((slot * 7) % 5) - 2) * 0.32;
}

/** Noms affichés au plus : au-delà, la vue n'est plus qu'un nuage d'étiquettes. */
export const MAX_TAGS = 6;
/** Hauteur d'une étiquette et marge entre deux, en pixels CSS. */
const TAG_H = 24;
const TAG_GAP = 4;
/** Largeur estimée d'une étiquette : nom, distance et marges. */
const tagWidth = (name: string) => 64 + name.length * 7.5;

export interface TagBox {
  name: string;
  /** Centre du bas de l'étiquette (le nom se pose au-dessus du coureur), en pixels CSS. */
  x: number;
  y: number;
}

/**
 * Garde les étiquettes qui ne se recouvrent pas, dans l'ordre reçu (le plus proche d'abord) : le coureur le plus
 * proche garde son nom, ceux qu'il masque au loin le perdent. Au plus `MAX_TAGS`.
 */
export function declutter<T extends TagBox>(tags: readonly T[]): T[] {
  const kept: T[] = [];
  for (const t of tags) {
    if (kept.length >= MAX_TAGS) break;
    const w = tagWidth(t.name);
    const clash = kept.some((k) => {
      const kw = tagWidth(k.name);
      return Math.abs(t.x - k.x) < (w + kw) / 2 + TAG_GAP && Math.abs(t.y - k.y) < TAG_H + TAG_GAP;
    });
    if (!clash) kept.push(t);
  }
  return kept;
}

const GOLDEN = 0.618033988749895;

/** Teinte (0 à 1) du maillot d'un coureur : espacées par le nombre d'or pour que deux places voisines se distinguent. */
export function hueOf(slot: number): number {
  return (slot * GOLDEN) % 1;
}

/** Coureurs montrés par l'encart de proximité : devant et derrière le joueur. */
export const AHEAD_SHOWN = 7;
export const BEHIND_SHOWN = 3;
/** Au-delà de cette distance, un coureur n'est plus « à proximité », en m. */
export const NEARBY_RANGE_M = 1500;

export interface Nearby {
  slot: number;
  name: string;
  /** Écart au joueur, en m : positif devant, négatif derrière. */
  gapM: number;
}

export interface NearbyRiders {
  /** Du plus éloigné au plus proche : la liste se lit de l'avant vers le joueur. */
  ahead: Nearby[];
  /** Du plus proche au plus éloigné. */
  behind: Nearby[];
}

/**
 * Les coureurs proches du joueur : les `ahead` plus proches devant lui et les `behind` plus proches derrière. « Devant »
 * se décide par le cap du joueur (un coureur sur une autre route compte selon qu'il est devant ou derrière son regard),
 * l'écart est la distance à vol d'oiseau, signée. Les pistes des coureurs n'ont pas de repère commun : on ne peut pas
 * soustraire leurs distances de trajet.
 */
export function nearby(
  self: { x: number; z: number; heading: number },
  riders: readonly { slot: number; name: string; x: number; z: number }[],
  ahead = AHEAD_SHOWN,
  behind = BEHIND_SHOWN,
  rangeM = NEARBY_RANGE_M,
): NearbyRiders {
  const fx = Math.cos(self.heading);
  const fz = Math.sin(self.heading);
  const front: Nearby[] = [];
  const back: Nearby[] = [];
  for (const r of riders) {
    const dx = r.x - self.x;
    const dz = r.z - self.z;
    const dist = Math.hypot(dx, dz);
    if (dist > rangeM) continue;
    if (dx * fx + dz * fz >= 0) front.push({ slot: r.slot, name: r.name, gapM: dist });
    else back.push({ slot: r.slot, name: r.name, gapM: -dist });
  }
  front.sort((a, b) => a.gapM - b.gapM);
  back.sort((a, b) => b.gapM - a.gapM);
  return { ahead: front.slice(0, ahead).reverse(), behind: back.slice(0, behind) };
}

/** Écart lisible et stable : par 5 m sous 1 km (pas de chiffres qui clignotent), puis en km. */
export function formatGap(gapM: number): string {
  const sign = gapM < 0 ? '−' : '+';
  const a = Math.abs(gapM);
  if (a < 1000) return `${sign}${Math.round(a / 5) * 5} m`;
  return `${sign}${(a / 1000).toFixed(1).replace('.', ',')} km`;
}
