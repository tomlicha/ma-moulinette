import { CHAINRING_LIMITS, VIRTUAL_GEARS, clampGear, nearestGear, realRatio } from '../domain/sim/virtual-gears';
import type { KeyValueStore } from '../shared/util/key-value-store';
import { TypedEmitter } from '../shared/util/typed-emitter';

export interface GearState {
  /** Vélo monté avec un Zwift Cog : les vitesses virtuelles sont actives. */
  enabled: boolean;
  /** Vitesse choisie, de 1 à 24. */
  gear: number;
  virtualRatio: number;
  realRatio: number;
}

/** Ce qui a changé : un changement de vitesse en roulant (`shift`) ou un réglage du vélo (`setup`). */
export type GearChange = 'shift' | 'setup';

/**
 * Les vitesses virtuelles du Zwift Cog : monté ou non, plateau, vitesse choisie, et leur mémorisation sur l'appareil.
 * Le calcul des braquets est dans domain/sim/virtual-gears.ts ; les boutons et le clavier sont dans ui/ride/gears-view.ts.
 * Un stockage illisible ou bloqué n'est jamais une erreur : valeurs par défaut, réglage non mémorisé.
 */
export class VirtualGearbox extends TypedEmitter<{ changed: [state: GearState, why: GearChange] }> {
  /** Clés de stockage : elles ne changent pas, les valeurs déjà gardées sur les appareils en dépendent. */
  static readonly KEYS = { cog: 'mamoulinette.cog', chainring: 'mamoulinette.chainring' } as const;

  private cog: boolean;
  private ring: number;
  private index: number;

  constructor(private readonly store: KeyValueStore) {
    super();
    this.cog = this.read(VirtualGearbox.KEYS.cog) === '1';
    const stored = Number(this.read(VirtualGearbox.KEYS.chainring));
    this.ring = VirtualGearbox.validRing(stored) ? stored : CHAINRING_LIMITS.default;
    this.index = nearestGear(realRatio(this.ring));
  }

  state(): GearState {
    return { enabled: this.cog, gear: this.index + 1, virtualRatio: VIRTUAL_GEARS[this.index]!, realRatio: realRatio(this.ring) };
  }

  /** Plateau du vélo, en dents. */
  get chainring(): number {
    return this.ring;
  }

  get gearCount(): number {
    return VIRTUAL_GEARS.length;
  }

  /** Monte ou démonte le Zwift Cog. */
  setEnabled(enabled: boolean): void {
    this.cog = enabled;
    this.write(VirtualGearbox.KEYS.cog, enabled ? '1' : '0');
    this.emit('changed', this.state(), 'setup');
  }

  /** Change le plateau ; une valeur hors bornes est ignorée (le réglage reste ce qu'il était, l'événement part quand même). */
  setChainring(teeth: number): void {
    const n = Math.round(teeth);
    if (VirtualGearbox.validRing(n)) {
      this.ring = n;
      this.write(VirtualGearbox.KEYS.chainring, String(n));
      this.index = nearestGear(realRatio(n)); // nouveau braquet réel : on repart de la vitesse qui lui ressemble
    }
    this.emit('changed', this.state(), 'setup');
  }

  /** Change de vitesse de `by` crans (positif : plus dur). Sans effet si le Cog n'est pas monté ou en butée. */
  shift(by: number): void {
    if (!this.cog) return;
    const next = clampGear(this.index + by);
    if (next === this.index) return;
    this.index = next;
    this.emit('changed', this.state(), 'shift');
  }

  private static validRing(n: number): boolean {
    return Number.isInteger(n) && n >= CHAINRING_LIMITS.min && n <= CHAINRING_LIMITS.max;
  }

  private read(key: string): string | null {
    try {
      return this.store.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.store.setItem(key, value);
    } catch {
      // réglage non mémorisé, sans conséquence
    }
  }
}
