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
