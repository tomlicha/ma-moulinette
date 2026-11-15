/**
 * Ce que la simulation exige d'un parcours : une altitude et une pente en fonction de la distance parcourue.
 * Une `Route` (boucle à segments) et un `Journey` (trajet sur un réseau routier) la remplissent toutes les deux.
 */
export interface Course {
  readonly name: string;
  altitudeAt(distanceM: number): number;
  /** Pente lissée sur une fenêtre de 2 × `halfWindowM`, en %. */
  gradeAt(distanceM: number, halfWindowM?: number): number;
  /** Appelée par la simulation avec la distance du cycliste : un trajet y valide ses choix de carrefour. */
  update?(distanceM: number): void;
}
