import { RiderInputs } from '../ui/ride/rider-inputs';
import { setupRiderProfile } from '../ui/devices/rider-profile';
import { setupWheel } from '../ui/shared/wheel-picker';
import { byId as $ } from '../ui/shared/dom';
import type { Wiring } from './wiring';

export function composeRider(w: Wiring): void {
  /** Les champs de FTP et de masse du coureur (rider-inputs.ts). */
  const riderInputs = new RiderInputs();
  w.riderInputs = riderInputs;

  riderInputs.load({ ftpW: w.settings.ftpW(), massKg: w.settings.massKg() });

  const readFtp = () => riderInputs.ftpW;
  w.readFtp = readFtp;

  const readMass = () => riderInputs.massKg;

  riderInputs.onMassChange(() => {
    w.settings.save('mass', readMass());
    w.syncJournal.record('setting', 'mass', readMass());
  });

  riderInputs.onFtpChange(() => {
    w.settings.save('ftp', readFtp());
    w.syncJournal.record('setting', 'ftp', readFtp());
    w.ftpChanged();
  });

  /** Même radar sur l'écran Appareils (grand) et sur l'accueil (réduit) : rôle de l'appareil et nom réel dans chaque bulle. */
  const riderProfile = setupRiderProfile({
    massSource: riderInputs.massInput,
    ftpSource: riderInputs.ftpInput,
    readFtp,
    readMass,
    summary: $('rider-summary'),
    dialog: $<HTMLDialogElement>('rider-dialog'),
    wheel: setupWheel($<HTMLDialogElement>('wheel-dialog')),
    openers: [$('rider-open')],
  });
  w.riderProfile = riderProfile;
}
