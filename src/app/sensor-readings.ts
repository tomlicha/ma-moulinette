import { PowerAverage } from '../domain/sim/power-average';
import type { Measurement } from '../infra/sensors/types';

/** Au-delà de ce délai sans mesure, le capteur est considéré silencieux : le cycliste est à l'arrêt dans la simulation. */
export const POWER_STALE_MS = 3000;

interface Stamped {
  value: number;
  at: number;
}

/**
 * Dernières valeurs reçues des capteurs, avec leur fraîcheur.
 *
 * Une seule responsabilité : retenir ce que les capteurs ont dit et rendre chaque valeur seulement tant qu'elle est
 * récente. Elle ne sait ni d'où vient la mesure (trainer, ceinture, simulateur) ni à quoi elle sert (simulation, HUD).
 */
export class SensorReadings {
  private power?: Stamped;
  private cadence?: Stamped;
  private heartRate?: Stamped;
  private speed?: Stamped;
  private readonly average = new PowerAverage();

  constructor(
    private readonly clock: () => number = () => performance.now(),
    private readonly staleMs = POWER_STALE_MS,
  ) {}

  /** Retient les champs présents dans la mesure : un capteur qui ne parle que de cadence ne touche pas à la puissance. */
  record(m: Partial<Measurement>): void {
    const now = this.clock();
    if (m.powerW !== undefined) {
      this.power = { value: m.powerW, at: now };
      this.average.push(m.powerW, now);
    }
    if (m.cadenceRpm !== undefined) this.cadence = { value: m.cadenceRpm, at: now };
    if (m.heartRateBpm !== undefined) this.heartRate = { value: m.heartRateBpm, at: now };
    if (m.speedKmh !== undefined) this.speed = { value: m.speedKmh, at: now };
  }

  /** Puissance en watts ; 0 si le capteur se tait (c'est ce que veut la simulation). */
  powerW(): number {
    return this.fresh(this.power) ?? 0;
  }

  /** Cadence en tr/min ; 0 si le capteur se tait. */
  cadenceRpm(): number {
    return this.fresh(this.cadence) ?? 0;
  }

  /** Cadence récente, ou `undefined` : pour qui doit distinguer « 0 tr/min » de « pas de mesure » (braquet virtuel, HUD). */
  liveCadenceRpm(): number | undefined {
    return this.fresh(this.cadence);
  }

  heartRateBpm(): number | undefined {
    return this.fresh(this.heartRate);
  }

  speedKmh(): number | undefined {
    return this.fresh(this.speed);
  }

  /** Puissance moyenne sur 3 s, `undefined` quand le capteur se tait. */
  averagePowerW(): number | undefined {
    return this.average.value(this.clock());
  }

  private fresh(s: Stamped | undefined): number | undefined {
    return s && this.clock() - s.at <= this.staleMs ? s.value : undefined;
  }
}
