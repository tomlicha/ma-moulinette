import type { SyncSource } from '../infra/sync/client';
import type { SyncJournal } from '../infra/sync/journal';
import type { SyncItem, SyncSetting } from '../infra/sync/protocol';
import type { SettingsStore } from './settings-store';

/** Les champs où le coureur règle sa FTP et sa masse : la synchronisation les met à jour. */
export interface RiderInputsPort {
  /** Met la valeur dans le champ (`undefined` : sa valeur par défaut). */
  setValue(id: SyncSetting, value: number | undefined): void;
}

export interface RiderSettingsSyncDeps {
  settings: SettingsStore;
  journal: Pick<SyncJournal, 'stamp'>;
  inputs: RiderInputsPort;
  /** La FTP a changé : séance en cours, profil et éditeur suivent. */
  ftpChanged: () => void;
  /** La fiche du coureur et son radar se relisent. */
  refreshProfile: () => void;
}

const IDS: readonly SyncSetting[] = ['ftp', 'mass'];

/**
 * La FTP et la masse du coureur, vues par la synchronisation avec son compte (docs/design/compte.md) : ce que
 * l'appareil en sait, et ce qu'il fait de ce qui vient d'un autre appareil. Une seule responsabilité : relier les
 * réglages gardés (`SettingsStore`) et leurs champs à la synchronisation.
 */
export class RiderSettingsSync implements SyncSource {
  readonly kind = 'setting' as const;

  constructor(private readonly d: RiderSettingsSyncDeps) {}

  all(): SyncItem[] {
    return IDS.flatMap((id): SyncItem[] => {
      const raw = this.d.settings.raw(id);
      // Un réglage sans version (fait avant la synchronisation) cède devant celui du compte.
      return raw === null ? [] : [{ kind: 'setting', id, body: Number(raw), updatedAt: this.d.journal.stamp('setting', id) ?? 0 }];
    });
  }

  apply(items: SyncItem[]): void {
    for (const i of items) {
      if (!IDS.includes(i.id as SyncSetting)) continue;
      const id = i.id as SyncSetting;
      const v = typeof i.body === 'number' ? i.body : undefined;
      // Pendant une sortie, la masse de la sortie ne change pas (Ride l'a prise au départ) : seule la valeur gardée suit.
      this.d.inputs.setValue(id, v);
      this.d.settings.save(id, v);
    }
    if (items.some((i) => i.id === 'ftp')) this.d.ftpChanged();
    this.d.refreshProfile();
  }

  clear(): void {
    for (const id of IDS) {
      this.d.inputs.setValue(id, undefined);
      this.d.settings.save(id, undefined);
    }
    this.d.ftpChanged();
    this.d.refreshProfile();
  }
}
