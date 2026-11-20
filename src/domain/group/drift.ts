/**
 * Dérive d'un coureur par rapport à son groupe (docs/design/groupe.md, « Recalage »). Tous les clients rejouent la même
 * simulation, donc sont au même endroit ; un client qui a raté un choix de route (onglet endormi, réseau très lent) ou dont
 * l'horloge s'est écartée n'est plus avec les autres **sans le savoir**. Il le voit en se comparant à eux : il est le seul à
 * ne plus être dans le peloton.
 *
 * Règle pure, sans horloge ni réseau : l'appelant donne le temps écoulé et ce qu'il voit des autres membres.
 *   - « dans le groupe » : à moins de `DRIFT_DISTANCE_M` d'au moins la moitié des autres membres qui roulent et qu'on reçoit ;
 *   - dérive : hors du groupe pendant `DRIFT_AFTER_S` d'affilée (ou, sans en voir un seul alors qu'il y en a, `BLIND_AFTER_S`) ;
 *   - recalage : on redemande l'état du groupe (tous les choix de route) et on rejoue la simulation. Jamais plus d'un par
 *     `RESYNC_MIN_INTERVAL_S`, ni plus de `RESYNC_MAX` d'affilée : si c'est l'autre qui a tort, ou que le rejeu ne change rien,
 *     on n'insiste pas.
 */

/** À cette distance d'un autre membre, on est dans le même peloton, en m. */
export const DRIFT_DISTANCE_M = 30;
/** Hors du peloton pendant ce temps : dérive, en s. */
export const DRIFT_AFTER_S = 6;
/** Sans voir aucun des autres membres pendant ce temps : on se recale aussi, en s. */
export const BLIND_AFTER_S = 20;
export const RESYNC_MIN_INTERVAL_S = 30;
export const RESYNC_MAX = 3;
/** Dans le peloton pendant ce temps : les recalages comptés repartent de zéro, en s. */
const RECOVERED_AFTER_S = 60;

export interface Point {
  x: number;
  z: number;
}

export class GroupDrift {
  private farS = 0;
  private blindS = 0;
  private okS = 0;
  private sinceResyncS = Infinity;
  private resyncs = 0;

  /**
   * À appeler à chaque pas. `others` : les autres membres qui roulent et dont on reçoit la position ; `expected` : combien
   * d'autres membres compte le groupe. Renvoie vrai quand il faut se recaler.
   */
  update(dtS: number, self: Point, others: readonly Point[], expected: number): boolean {
    this.sinceResyncS += dtS;
    if (expected <= 0) return this.calm();
    if (others.length === 0) {
      this.farS = 0;
      this.okS = 0;
      this.blindS += dtS;
      return this.blindS >= BLIND_AFTER_S && this.trigger();
    }
    this.blindS = 0;
    const near = others.filter((o) => Math.hypot(o.x - self.x, o.z - self.z) <= DRIFT_DISTANCE_M).length;
    if (near * 2 >= others.length) {
      this.farS = 0;
      this.okS += dtS;
      if (this.okS >= RECOVERED_AFTER_S) this.resyncs = 0;
      return false;
    }
    this.okS = 0;
    this.farS += dtS;
    return this.farS >= DRIFT_AFTER_S && this.trigger();
  }

  /** Une séance de groupe qui recommence ou un rejeu fait : les compteurs repartent. */
  reset(): void {
    this.farS = this.blindS = this.okS = 0;
  }

  private calm(): boolean {
    this.farS = this.blindS = 0;
    return false;
  }

  private trigger(): boolean {
    if (this.resyncs >= RESYNC_MAX || this.sinceResyncS < RESYNC_MIN_INTERVAL_S) return false;
    this.resyncs++;
    this.sinceResyncS = 0;
    this.farS = this.blindS = 0;
    return true;
  }
}
