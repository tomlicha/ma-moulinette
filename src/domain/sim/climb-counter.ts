/** Dénivelé positif cumulé à partir des altitudes successives de la sortie. */
export class ClimbCounter {
  private last: number | undefined;
  total = 0;

  add(altitudeM: number) {
    if (this.last !== undefined && altitudeM > this.last) this.total += altitudeM - this.last;
    this.last = altitudeM;
  }

  reset() {
    this.last = undefined;
    this.total = 0;
  }
}
