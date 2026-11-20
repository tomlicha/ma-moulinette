import { radarTag, type RadarDevice, type RadarRole } from '../ride/radar-model';
import type { Radar } from '../ride/radar';

/**
 * L'état des appareils sur l'accueil : les points Trainer et Cardio de la pastille d'en-tête et de la carte « Appareils »
 * de l'iPhone. Même contrat que le radar (`update`), il s'abonne aux mêmes changements ; il remplace la tuile radar de
 * l'accueil, qui reste sur l'écran Appareils.
 */
export function createDeviceChips(root: ParentNode = document): Radar {
  return {
    update(devices: Record<RadarRole, RadarDevice>) {
      const anyOn = devices.trainer.state === 'connected' || devices.hr.state === 'connected';
      for (const chip of root.querySelectorAll<HTMLElement>('.chip-devices, .home-devices-card')) chip.dataset.any = String(anyOn);
      for (const pill of root.querySelectorAll<HTMLElement>('.dev-pill[data-dev-role]')) {
        const role = pill.dataset.devRole as RadarRole;
        const tag = radarTag(role, devices[role]);
        pill.dataset.tone = tag.tone;
        pill.title = `${tag.role} : ${tag.status}`;
      }
    },
  };
}
