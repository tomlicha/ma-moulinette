import type { RiderParams } from '../domain/sim/physics';
import { GradeSlew, GradeThrottle } from '../domain/sim/grade-throttle';
import { gearedGradePct, trainerModelFor } from '../domain/sim/virtual-gears';
import type { SimulationParams } from '../infra/sensors/types';

/** Les vitesses virtuelles (Zwift Cog), telles que la fiche des réglages les décrit. */
export interface VirtualGearing {
  enabled: boolean;
  virtualRatio: number;
  realRatio: number;
}

export interface GradeUpdate {
  nowMs: number;
  /** Pente du parcours sous le cycliste, en %. */
  courseGradePct: number;
  speedMs: number;
  /** Cadence mesurée, `undefined` si le capteur se tait. */
  cadenceRpm: number | undefined;
  rider: RiderParams;
  gearing: VirtualGearing;
  /** Le trainer applique lui-même le braquet virtuel (protocole Zwift) : on lui donne la pente réelle et le braquet. */
  trainerAppliesGears: boolean;
  /** Un trainer est connecté et sait simuler une pente. */
  canSimulate: boolean;
}

/** Les protocoles portent la pente au centième de pourcent. */
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Avec les vitesses virtuelles, la pente suit aussi la vitesse : pas plus fin, envois plus rapprochés. */
const GEARED_THROTTLE = { minDeltaPct: 0.2, minIntervalMs: 500 } as const;

/**
 * Décide quelle pente envoyer au trainer, et quand.
 *
 * Une seule responsabilité : transformer la pente du parcours (et le braquet virtuel) en consigne de simulation, la
 * lisser, et ne la proposer à l'envoi que si elle compte. Elle n'envoie rien : elle rend la consigne, l'appelant la transmet.
 * Elle porte aussi l'état « ERG engagé », puisque la consigne de puissance prime sur la pente.
 */
export class GradeController {
  private throttle = new GradeThrottle();
  private readonly slew = new GradeSlew();
  private erg = false;

  /** ERG engagé : la consigne de puissance prime, l'envoi de la pente du parcours est suspendu. */
  get ergActive(): boolean {
    return this.erg;
  }

  setErgActive(on: boolean): void {
    this.erg = on;
    if (!on) this.throttle.reset(); // en sortie, la prochaine mise à jour renvoie la pente du parcours
  }

  /** Active ou coupe les vitesses virtuelles : le prochain pas renvoie la pente sans attendre, pour que le changement se sente. */
  setVirtualGears(enabled: boolean): void {
    this.throttle = enabled ? new GradeThrottle(GEARED_THROTTLE.minDeltaPct, GEARED_THROTTLE.minIntervalMs) : new GradeThrottle();
  }

  /** Nouvelle sortie, ou trainer reconnecté : il repart de zéro, on lui renvoie la pente. */
  reset(): void {
    this.slew.reset();
    this.throttle.reset();
  }

  /** Un envoi a échoué : le prochain pas réessaie. L'appelant attend un peu avant, pour ne pas marteler le trainer. */
  retry(): void {
    this.throttle.reset();
  }

  /**
   * Un pas de simulation. Rend la consigne à envoyer, ou `undefined` s'il n'y a rien à envoyer (changement trop faible,
   * trop tôt, ERG engagé, trainer qui ne simule pas). La pente est lissée à chaque pas, envoyée ou non.
   */
  update(u: GradeUpdate): SimulationParams | undefined {
    const native = u.gearing.enabled && u.trainerAppliesGears;
    // Protocole Zwift : le trainer reçoit la pente réelle et le braquet, et fait le calcul. Autres protocoles : la pente
    // envoyée est celle qui rend, avec le braquet réel, l'effort du braquet virtuel choisi.
    const model = u.gearing.enabled && !native ? trainerModelFor(u.rider) : undefined;
    const target = model
      ? round2(
          gearedGradePct({
            gradePct: u.courseGradePct,
            speedMs: u.speedMs,
            virtualRatio: u.gearing.virtualRatio,
            realRatio: u.gearing.realRatio,
            cadenceRpm: u.cadenceRpm,
            rider: u.rider,
            trainer: model,
          }),
        )
      : u.courseGradePct;
    const gradePct = round2(this.slew.next(target, u.nowMs));
    if (!u.canSimulate || this.erg || !this.throttle.shouldSend(gradePct, u.nowMs)) return undefined;
    this.throttle.markSent(gradePct, u.nowMs);
    return { gradePct, massKg: u.rider.massKg, ...model, ...(native ? { gearRatio: u.gearing.virtualRatio } : {}) };
  }
}
