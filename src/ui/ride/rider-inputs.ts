import type { RiderInputsPort } from '../../app/rider-settings-sync';
import { DEFAULT_RIDER } from '../../domain/sim/physics';
import { normalizeFtp, normalizeMass } from '../../domain/sim/rider-limits';
import type { SyncSetting } from '../../infra/sync/protocol';
import { byId } from '../shared/dom';

/**
 * Les champs (cachés) où sont la FTP et la masse du coureur : la fiche du coureur les met à jour et déclenche leur
 * `change`, d'où la FTP continue d'être mémorisée et le profil des séances se redessine. Ils restent la source de vérité
 * de la page ; la masse se fige pendant une sortie (la sortie l'a prise au départ).
 */
export class RiderInputs implements RiderInputsPort {
  /** Les champs eux-mêmes : la fiche du coureur les lit et les met à jour. */
  readonly ftpInput = byId<HTMLInputElement>('wo-ftp');
  readonly massInput = byId<HTMLInputElement>('mass');

  /** Reprend les valeurs gardées sur l'appareil. */
  load(saved: { ftpW: number | undefined; massKg: number | undefined }): void {
    if (saved.ftpW !== undefined) this.ftpInput.value = String(saved.ftpW);
    if (saved.massKg !== undefined) this.massInput.value = String(saved.massKg);
  }

  /** La FTP du coureur, ramenée à une valeur plausible. */
  get ftpW(): number {
    return normalizeFtp(Number(this.ftpInput.value));
  }

  /** La masse du coureur, ramenée à une valeur plausible. */
  get massKg(): number {
    return normalizeMass(Number(this.massInput.value));
  }

  /** La masse avec laquelle une sortie démarre : la saisie, ou celle du coureur par défaut si le champ est vide. */
  get rideMassKg(): number {
    return Number(this.massInput.value) || DEFAULT_RIDER.massKg;
  }

  onFtpChange(handler: () => void): void {
    this.ftpInput.addEventListener('change', handler);
  }

  onMassChange(handler: () => void): void {
    this.massInput.addEventListener('change', handler);
  }

  /** La masse se règle avant de démarrer la sortie, pas pendant. */
  lockMass(locked: boolean): void {
    this.massInput.readOnly = locked;
    this.massInput.title = locked ? 'La masse se règle avant de démarrer la sortie.' : '';
  }

  setValue(id: SyncSetting, value: number | undefined): void {
    const input = id === 'ftp' ? this.ftpInput : this.massInput;
    input.value = String(value ?? input.defaultValue);
  }
}
