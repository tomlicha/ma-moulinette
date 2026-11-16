/** Retard d'affichage des autres coureurs, en ms : de quoi avoir presque toujours deux messages qui encadrent l'instant. */
export const RENDER_DELAY_MS = 200;
/** Au-delà du dernier message, on prolonge la course à vitesse constante pendant au plus ce temps, en ms. */
export const MAX_EXTRAPOLATION_MS = 1000;
/** Nombre de messages sur lesquels s'estime l'écart entre l'horloge de l'émetteur et la nôtre. */
const CLOCK_WINDOW = 40;
/** Messages conservés derrière l'instant affiché, en ms. */
const KEEP_MS = 1000;

export interface Sample {
  /** Instant d'émission, horloge de l'émetteur, en ms. */
  t: number;
  /** Distance sur la piste du coureur, en m. */
  d: number;
  speedMs: number;
  cadenceRpm: number;
}

export interface Interpolated {
  d: number;
  speedMs: number;
  cadenceRpm: number;
  /** Vrai si l'instant affiché dépasse le dernier message de plus que `MAX_EXTRAPOLATION_MS` : coureur figé. */
  stale: boolean;
}

/**
 * Lissage d'un coureur distant : on affiche sa position avec `RENDER_DELAY_MS` de retard, interpolée entre les deux
 * messages qui encadrent cet instant ; faute de message assez récent, on prolonge sa course un moment.
 *
 * Les instants sont ceux de l'émetteur, ramenés à notre horloge par l'écart le plus petit observé entre arrivée et
 * émission : celui du message le plus rapide, donc le moins déformé par la gigue du réseau. Les deux horloges n'ont
 * pas à être synchronisées.
 */
export class Interpolator {
  private samples: Sample[] = [];
  private offsets: number[] = [];

  constructor(
    private readonly delayMs = RENDER_DELAY_MS,
    private readonly maxExtrapolationMs = MAX_EXTRAPOLATION_MS,
  ) {}

  /** Ajoute un message reçu à l'instant local `arrivalMs`. */
  push(arrivalMs: number, s: Sample): void {
    const last = this.samples[this.samples.length - 1];
    if (last && s.t <= last.t) return; // doublon ou message arrivé dans le désordre : le plus récent fait foi
    this.samples.push(s);
    this.offsets.push(arrivalMs - s.t);
    if (this.offsets.length > CLOCK_WINDOW) this.offsets.shift();
  }

  /** Oublie tout : le coureur a été replacé, ses anciennes distances n'ont plus de sens. */
  reset(): void {
    this.samples = [];
  }

  /** État à afficher à l'instant local `nowMs`, ou `undefined` sans aucun message. */
  at(nowMs: number): Interpolated | undefined {
    const n = this.samples.length;
    if (n === 0) return undefined;
    const t = nowMs - Math.min(...this.offsets) - this.delayMs;

    while (this.samples.length > 2 && this.samples[1]!.t < t - KEEP_MS) this.samples.shift();
    const ss = this.samples;
    const first = ss[0]!;
    if (t <= first.t) return { d: first.d, speedMs: first.speedMs, cadenceRpm: first.cadenceRpm, stale: false };

    for (let i = ss.length - 1; i > 0; i--) {
      const a = ss[i - 1]!;
      const b = ss[i]!;
      if (a.t <= t && t <= b.t) {
        const k = (t - a.t) / (b.t - a.t);
        return {
          d: a.d + (b.d - a.d) * k,
          speedMs: a.speedMs + (b.speedMs - a.speedMs) * k,
          cadenceRpm: a.cadenceRpm + (b.cadenceRpm - a.cadenceRpm) * k,
          stale: false,
        };
      }
    }

    const last = ss[ss.length - 1]!;
    const ahead = t - last.t;
    return {
      d: last.d + last.speedMs * (Math.min(ahead, this.maxExtrapolationMs) / 1000),
      speedMs: last.speedMs,
      cadenceRpm: last.cadenceRpm,
      stale: ahead > this.maxExtrapolationMs,
    };
  }
}
