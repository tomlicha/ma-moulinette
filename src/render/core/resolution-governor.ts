/**
 * Résolution dynamique : choisit la densité de pixels du canevas d'après le temps que prennent les images. Module sans
 * three.js (la vue lui donne les durées et applique ce qu'il décide), donc testable sans GPU.
 *
 * Le coût d'une image suit surtout le nombre de pixels (anticrénelage, ombres, brume, ciel calculés par pixel). Quand
 * les images tardent, baisser la densité d'un cran allège le travail du GPU dans la même proportion, pour une image un
 * peu plus douce ; quand elles vont bien depuis longtemps, on remonte. Objectif du projet : 30 images par seconde
 * stables (ENF-01).
 *
 * Règles pour ne pas osciller (chaque changement réalloue les tampons de l'image) :
 * - on regarde le 95e centile des durées sur une fenêtre, pas la moyenne : un téléphone qui saccade par à-coups est lent ;
 * - un délai minimal entre deux changements ;
 * - on ne remonte qu'après une longue période calme ;
 * - une densité qui vient d'être trop lourde est interdite un moment (sinon on y retournerait toutes les 25 s).
 */
export interface GovernorOptions {
  /** Densité de repos, en pixels par pixel CSS : le plafond. */
  max: number;
  /** Plancher (défaut : 0,75, ou `max` s'il est plus bas). */
  min?: number;
  /** Écart d'un cran, par défaut 0,25. */
  step?: number;
  /** Au-dessus de cette durée au 95e centile (ms), on baisse. Défaut 40 : sous 25 images par seconde. */
  slowMs?: number;
  /** Sous cette durée au 95e centile (ms), l'image est « à l'aise ». Défaut 22 : plus de 45 images par seconde. */
  fastMs?: number;
  /** Nombre d'images de la fenêtre. Défaut 90 (3 s à 30 images par seconde). */
  windowFrames?: number;
  /** Délai minimal entre deux changements (ms). Défaut 5 000. */
  cooldownMs?: number;
  /** Durée à l'aise avant de remonter d'un cran (ms). Défaut 20 000. */
  calmMs?: number;
  /** Durée pendant laquelle une densité jugée trop lourde reste interdite (ms). Défaut 300 000. */
  banMs?: number;
  /** Images ignorées au départ et à chaque reprise : compilation des shaders, caches froids. Défaut 60. */
  warmupFrames?: number;
}

/** Une pause plus longue que ceci (onglet masqué, page figée) n'est pas une image lente : la fenêtre repart. */
const GAP_MS = 1000;
/** Évaluation au plus toutes les 500 ms : inutile de trier la fenêtre à chaque image. */
const EVAL_EVERY_MS = 500;

export class ResolutionGovernor {
  private current: number;
  private readonly min: number;
  private readonly step: number;
  private readonly slowMs: number;
  private readonly fastMs: number;
  private readonly windowFrames: number;
  private readonly cooldownMs: number;
  private readonly calmMs: number;
  private readonly banMs: number;
  private readonly warmupFrames: number;
  private times: number[] = [];
  private warmup: number;
  private lastEval = -Infinity;
  private lastChange = -Infinity;
  private calmSince: number | undefined;
  /** Densité maximale permise tant que `capUntil` n'est pas passé : celle d'après une baisse. */
  private cap: number;
  private capUntil = -Infinity;

  constructor(private readonly o: GovernorOptions) {
    this.current = o.max;
    this.cap = o.max;
    this.min = Math.min(o.max, o.min ?? 0.75);
    this.step = o.step ?? 0.25;
    this.slowMs = o.slowMs ?? 40;
    this.fastMs = o.fastMs ?? 22;
    this.windowFrames = o.windowFrames ?? 90;
    this.cooldownMs = o.cooldownMs ?? 5000;
    this.calmMs = o.calmMs ?? 20_000;
    this.banMs = o.banMs ?? 300_000;
    this.warmupFrames = o.warmupFrames ?? 60;
    this.warmup = this.warmupFrames;
  }

  /** Densité de pixels actuelle. */
  get ratio(): number {
    return this.current;
  }

  /** La vue repart (écran masqué puis rouvert) : les durées d'avant ne disent rien de l'état présent. */
  reset(): void {
    this.times = [];
    this.calmSince = undefined;
    this.warmup = this.warmupFrames;
  }

  /**
   * Une image de plus : `dtMs` depuis la précédente, `nowMs` l'horloge. Renvoie la nouvelle densité si elle change,
   * sinon `undefined`.
   */
  frame(dtMs: number, nowMs: number): number | undefined {
    if (!(dtMs > 0)) return undefined;
    if (dtMs > GAP_MS) {
      this.reset();
      return undefined;
    }
    if (this.warmup > 0) {
      this.warmup--;
      return undefined;
    }
    this.times.push(dtMs);
    if (this.times.length > this.windowFrames) this.times.shift();
    if (this.times.length < this.windowFrames || nowMs - this.lastEval < EVAL_EVERY_MS) return undefined;
    this.lastEval = nowMs;

    const sorted = [...this.times].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    const settled = nowMs - this.lastChange >= this.cooldownMs;

    if (p95 > this.slowMs) {
      this.calmSince = undefined;
      if (settled && this.current > this.min) return this.change(Math.max(this.min, this.current - this.step), nowMs, true);
      return undefined;
    }
    if (p95 < this.fastMs) {
      this.calmSince ??= nowMs;
      if (nowMs >= this.capUntil) this.cap = this.o.max;
      if (settled && nowMs - this.calmSince >= this.calmMs && this.current < Math.min(this.o.max, this.cap)) {
        return this.change(Math.min(this.o.max, this.cap, this.current + this.step), nowMs, false);
      }
      return undefined;
    }
    this.calmSince = undefined; // entre les deux : on ne bouge pas
    return undefined;
  }

  private change(next: number, nowMs: number, lowered: boolean): number {
    if (lowered) {
      // La densité d'où l'on part était trop lourde : on ne la reprend pas de sitôt.
      this.cap = next;
      this.capUntil = nowMs + this.banMs;
    }
    this.current = next;
    this.lastChange = nowMs;
    this.times = [];
    this.calmSince = undefined;
    return next;
  }
}
