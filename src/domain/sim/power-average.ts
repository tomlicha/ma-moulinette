/** Moyenne glissante de la puissance (3 s par défaut, la convention des compteurs). `undefined` quand le capteur se tait. */
export class PowerAverage {
  private samples: { at: number; w: number }[] = [];

  constructor(private readonly windowMs = 3000) {}

  push(w: number, at: number) {
    this.samples.push({ at, w });
    this.trim(at);
  }

  value(now: number): number | undefined {
    this.trim(now);
    if (!this.samples.length) return undefined;
    return Math.round(this.samples.reduce((s, x) => s + x.w, 0) / this.samples.length);
  }

  reset() {
    this.samples = [];
  }

  private trim(now: number) {
    while (this.samples.length && now - this.samples[0]!.at > this.windowMs) this.samples.shift();
  }
}
