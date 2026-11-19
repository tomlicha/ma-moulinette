/**
 * Profil de rendu de la vue 3D. Module sans three.js : l'application le lit au lancement, avant de charger la vue.
 *
 * - `high` : profil de l'ordinateur (décor dense, relief à 1,2 km, ombres 2048 px, HUD en verre dépoli).
 * - `low` : profil des écrans tactiles (décor allégé, relief à 800 m, ombres 1024 px, HUD sans flou).
 */
export type Quality = 'high' | 'low';

/**
 * `?quality=high|low` l'emporte ; sinon un écran tactile (téléphone, tablette) reçoit `low` : il a la scène de
 * l'ordinateur sur un GPU bien plus modeste, sous un HUD flouté recalculé à chaque image (audit du 16 novembre 2026, 1.5).
 */
export function chooseQuality(param: string | null, coarsePointer: boolean): Quality {
  if (param === 'high' || param === 'low') return param;
  return coarsePointer ? 'low' : 'high';
}

/**
 * Densité de pixels du canevas. `low` garde 1,5 au plus : un téléphone à 3 pixels par point y gagne quatre fois moins
 * de pixels à dessiner qu'en natif, sans l'image floue d'une densité de 1.
 */
export function pixelRatioFor(quality: Quality, devicePixelRatio: number): number {
  return Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.5);
}
