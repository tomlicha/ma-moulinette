/**
 * Décide quand renvoyer la pente au trainer : un changement notable, et pas plus d'une fois par `minIntervalMs`.
 * Chaque envoi coûte une écriture BLE et une réponse ; le trainer n'a pas besoin de 20 mises à jour par seconde.
 */
export class GradeThrottle {
  private lastSent?: { gradePct: number; at: number };

  constructor(
    private readonly minDeltaPct = 0.5,
    private readonly minIntervalMs = 1000,
  ) {}

  shouldSend(gradePct: number, nowMs: number): boolean {
    const last = this.lastSent;
    if (!last) return true;
    return nowMs - last.at >= this.minIntervalMs && Math.abs(gradePct - last.gradePct) >= this.minDeltaPct;
  }

  markSent(gradePct: number, nowMs: number) {
    this.lastSent = { gradePct, at: nowMs };
  }

  reset() {
    this.lastSent = undefined;
  }
}

/**
 * Lisse la pente envoyée au trainer : elle ne change pas de plus de `maxPctPerS` par seconde. Un trainer applique la
 * pente aussitôt ; une baisse brusque (replat, épingle, braquet virtuel) donne alors quelques secondes « trop faciles »
 * avant que l'effort ne revienne, et le cycliste ressent un décrochage plutôt qu'un relief.
 */
export class GradeSlew {
  private last?: { gradePct: number; at: number };

  constructor(private readonly maxPctPerS = 1.5) {}

  next(targetPct: number, nowMs: number): number {
    const last = this.last;
    let out = targetPct;
    if (last) {
      const maxStep = (this.maxPctPerS * Math.max(0, nowMs - last.at)) / 1000;
      out = last.gradePct + Math.max(-maxStep, Math.min(maxStep, targetPct - last.gradePct));
    }
    this.last = { gradePct: out, at: nowMs };
    return out;
  }

  reset() {
    this.last = undefined;
  }
}
