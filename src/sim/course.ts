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
  /** La route (de carrefour à carrefour) sous `distanceM` : où elle commence sur le trajet et sa longueur, en m. */
  roadAt?(distanceM: number): { startM: number; lengthM: number };
  /**
   * L'ascenseur sous `distanceM`, s'il y en a un : la simulation y avance au rythme de la cabine (`lengthM` en
   * `durationS`), pas à celui du cycliste, et la pente y est nulle.
   */
  liftAt?(distanceM: number): LiftState | undefined;
}

/** Un ascenseur en cours de montée (ou de descente), vu du trajet. */
export interface LiftState {
  /** Où il commence sur le trajet, sa longueur de trajet (en m) et la durée de la montée (en s). */
  startM: number;
  lengthM: number;
  durationS: number;
  /** Avancement, de 0 à 1. */
  progress: number;
  /** Altitudes du monde au départ et à l'arrivée, dans le sens de marche, et altitude en ce moment, en m. */
  fromAltitudeM: number;
  toAltitudeM: number;
  altitudeM: number;
  /** Nom de l'arrivée (la Gare céleste en montant). */
  toName: string;
  /** Nom de l'ascenseur. */
  name: string;
}
