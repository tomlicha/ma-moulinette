import { FTP_LIMITS, MASS_LIMITS } from '../domain/sim/rider-limits';
import { ALL_PROTOCOLS, type ControlProtocol } from '../infra/sensors/protocols/trainer-profiles';
import type { KeyValueStore } from '../shared/util/key-value-store';

/** Réglages numériques du coureur, ceux que la synchronisation avec le compte porte aussi. */
export type RiderSetting = 'ftp' | 'mass';

/**
 * Réglages gardés sur l'appareil : FTP, masse, protocole de pilotage du trainer.
 *
 * Une seule responsabilité : lire et écrire ces valeurs, avec leurs clés et leurs règles de validité. Elle ne touche ni
 * au DOM ni à la synchronisation. Un stockage bloqué (navigation privée) n'est jamais une erreur : la valeur vaut pour la session.
 */
export class SettingsStore {
  /** Clés de stockage : elles ne changent pas, les valeurs déjà gardées sur les appareils en dépendent. */
  static readonly KEYS: Record<RiderSetting | 'protocol', string> = {
    ftp: 'mamoulinette.ftp',
    mass: 'mamoulinette.mass',
    protocol: 'mamoulinette.trainerProtocol',
  };

  constructor(private readonly store: KeyValueStore) {}

  /** FTP gardée, si elle est plausible. */
  ftpW(): number | undefined {
    const v = this.number('ftp');
    return v !== undefined && v >= FTP_LIMITS.min ? v : undefined;
  }

  /** Masse gardée, si elle est dans les bornes. */
  massKg(): number | undefined {
    const v = this.number('mass');
    return v !== undefined && v >= MASS_LIMITS.min && v <= MASS_LIMITS.max ? v : undefined;
  }

  /** Valeur brute telle que gardée (`null` : jamais réglée), pour la synchronisation. */
  raw(id: RiderSetting): string | null {
    try {
      return this.store.getItem(SettingsStore.KEYS[id]);
    } catch {
      return null;
    }
  }

  /** Garde le réglage (`undefined` : revient à la valeur par défaut). */
  save(id: RiderSetting, value: number | undefined): void {
    this.write(SettingsStore.KEYS[id], value === undefined ? undefined : String(value));
  }

  /** Protocole de pilotage imposé par le coureur ; `undefined` : choix automatique selon le modèle du trainer. */
  trainerProtocol(): ControlProtocol | undefined {
    try {
      const saved = this.store.getItem(SettingsStore.KEYS.protocol) as ControlProtocol | null;
      return saved && ALL_PROTOCOLS.includes(saved) ? saved : undefined;
    } catch {
      return undefined;
    }
  }

  saveTrainerProtocol(protocol: ControlProtocol | undefined): void {
    this.write(SettingsStore.KEYS.protocol, protocol);
  }

  private number(id: RiderSetting): number | undefined {
    const raw = this.raw(id);
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  private write(key: string, value: string | undefined): void {
    try {
      if (value === undefined) this.store.removeItem(key);
      else this.store.setItem(key, value);
    } catch {
      // stockage bloqué : préférence non mémorisée, sans conséquence
    }
  }
}
