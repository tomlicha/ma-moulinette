/**
 * Le point de groupe (docs/design/groupe.md, section 1) : en séance de groupe, la sortie de chacun avance au rythme d'un
 * **coureur de référence** qui roulerait la séance au même pourcentage de FTP, et non à la puissance réelle de chacun. Tout
 * le groupe est donc au même endroit au même instant, quelles que soient les jambes.
 *
 * Aucun serveur ne simule : chaque client rejoue la même simulation. Elle est **déterministe** :
 *   - le temps du groupe est découpé en pas fixes de `GROUP_TICK_MS` ; la puissance de référence est celle du palier au début
 *     du pas, la physique (`Ride`) avance du même pas. Le résultat ne dépend donc ni de la cadence des appels, ni du moment
 *     où l'on arrive : arriver en retard, c'est rejouer les pas manqués d'un trait.
 *   - la séance est celle du groupe, jouée avec la FTP et la masse du **créateur** du groupe (`GroupRef`, fixées à la création :
 *     elles ne changent pas si le créateur part) : la vitesse et la distance de tous, fichier FIT compris, sont les siennes.
 *     L'intensité réglée par un coureur ne touche que sa propre consigne ERG, jamais l'allure du groupe.
 *   - le trajet est le même pour tous : le parcours, et aux carrefours le choix du créateur du groupe (`Journey.setGroupRouting`),
 *     connu de chacun avant que sa simulation ne valide la route.
 */
import { DEFAULT_RIDER, type RiderParams } from '../sim/physics';
import type { Ride } from '../sim/ride';
import { WorkoutRunner } from '../workout/runner';
import type { Workout } from '../workout/model';

/** FTP et masse du coureur de référence : la vitesse du groupe, pas celle de quelqu'un. */
export const GROUP_REF_FTP_W = 250;
export const GROUP_REF_MASS_KG = 75;

/** Le coureur dont le groupe prend l'allure : le créateur du groupe, avec sa FTP et sa masse du moment de la création. */
export interface GroupRef {
  ftpW: number;
  massKg: number;
}

/** Coureur de référence par défaut (sans créateur connu) : de quoi tester, et valeur de repli. */
export const GROUP_DEFAULT_REF: GroupRef = { ftpW: GROUP_REF_FTP_W, massKg: GROUP_REF_MASS_KG };

/** Les paramètres physiques du coureur de référence. */
export const groupRider = (ref: GroupRef): RiderParams => ({ ...DEFAULT_RIDER, massKg: ref.massKg });

export const GROUP_RIDER: RiderParams = groupRider(GROUP_DEFAULT_REF);
/** Pas du temps de groupe, en ms. */
export const GROUP_TICK_MS = 100;
/** Part de la FTP de référence sur un palier libre (le groupe roule tranquille). */
export const GROUP_FREE_FRACTION = 0.6;
/** Garde-fou : au plus ce nombre de pas rejoués d'un appel (7 h de séance). */
const MAX_TICKS_PER_CALL = 250_000;

/** Ce que la sortie demande à qui lui impose son rythme : le cycliste à simuler, et d'avancer la sortie jusqu'à maintenant. */
export interface RidePacing {
  rider: RiderParams;
  advance(ride: Ride): void;
}

export class GroupPace implements RidePacing {
  readonly rider: RiderParams;
  private readonly runner: WorkoutRunner;
  private readonly refFtpW: number;
  private ticks = 0;

  /**
   * `elapsedMs` : le temps écoulé depuis le départ du groupe, sur l'horloge commune (négatif avant le départ). `ref` : le
   * coureur dont le groupe prend l'allure, le même pour tous (il vient du groupe, pas de l'appareil).
   */
  constructor(
    workout: Workout,
    private readonly elapsedMs: () => number,
    ref: GroupRef = GROUP_DEFAULT_REF,
  ) {
    this.rider = groupRider(ref);
    this.refFtpW = ref.ftpW;
    this.runner = new WorkoutRunner(workout, ref.ftpW, 1);
  }

  /** La séance est jouée jusqu'au bout : le groupe ne bouge plus. */
  get done(): boolean {
    return this.runner.state().done;
  }

  /** Le temps de groupe déjà joué, en s. */
  get playedS(): number {
    return (this.ticks * GROUP_TICK_MS) / 1000;
  }

  /** Avance `ride` jusqu'à l'instant courant du groupe, pas par pas. Avant le départ, ou une fois la séance finie : rien. */
  advance(ride: Ride): void {
    const target = Math.floor(this.elapsedMs() / GROUP_TICK_MS);
    const dtS = GROUP_TICK_MS / 1000;
    let n = 0;
    while (this.ticks < target && n < MAX_TICKS_PER_CALL) {
      const s = this.runner.state();
      if (s.done) return;
      ride.advance(dtS, s.targetW ?? GROUP_FREE_FRACTION * this.refFtpW);
      this.runner.advance(dtS);
      this.ticks++;
      n++;
    }
  }
}
