import { fbm, smoothstep } from '../core/noise';

/**
 * Où pousse quoi. Fonctions pures de la position : le semis des arbres (`decor.ts`) et la couleur du sol (`terrain.ts`)
 * lisent la même carte, donc une forêt se voit de loin, sur le sol, avant que ses arbres ne soient dessinés.
 */

/** Altitudes entre lesquelles les arbres se raréfient puis disparaissent, en m (altitude réelle). */
export const TREELINE_LOW_M = 230;
export const TREELINE_HIGH_M = 340;

/**
 * Couvert forestier en (x, z), de 0 (pré) à 1 (forêt). De grandes masses de 300 à 800 m de large aux lisières nettes :
 * environ 40 % du pays est boisé.
 */
export function forestCover(x: number, z: number): number {
  return smoothstep(0.02, 0.2, fbm(x * 0.0021 + 13.7, z * 0.0021 - 5.2, 3));
}

/** Part de sapins dans un peuplement, de 0 (feuillus) à 1 (sapins) : les essences vont par bois entiers, pas mélangées. */
export function firShare(x: number, z: number, altitude: number): number {
  const stand = fbm(x * 0.0037 + 51.3, z * 0.0037 + 88.1, 2);
  return Math.min(1, Math.max(0, 0.5 + 1.4 * stand + 0.6 * smoothstep(110, 240, altitude)));
}

/** Les arbres s'arrêtent avec l'altitude : 1 en bas, 0 au-dessus de la limite des arbres. */
export function treelineFactor(altitude: number): number {
  return 1 - smoothstep(TREELINE_LOW_M, TREELINE_HIGH_M, altitude);
}
