import type { WorldStatus } from '../../infra/net/world-client';
import { byId } from '../shared/dom';
import type { RidePanel } from './ride-panel';
import { crowdLine, type RiderTags } from './rider-tags';

/**
 * La pastille de l'écran Sortie : combien de coureurs sont en ligne, ou où en est la connexion à la salle. Visible
 * seulement avec un compte connecté à la salle ; hors ligne, les autres coureurs disparaissent de l'écran.
 */
export class CrowdView {
  private readonly pill = byId('crowd');

  constructor(
    private readonly riderTags: RiderTags,
    private readonly ridePanel: RidePanel,
  ) {}

  render(status: WorldStatus, population: number): void {
    const s = status;
    this.pill.hidden = s === 'offline' || s === 'signed-out' || s === 'name-pending';
    this.pill.dataset.state = s === 'online' ? 'on' : 'off';
    this.pill.textContent =
      s === 'online'
        ? crowdLine(population)
        : s === 'connecting'
          ? 'Connexion…'
          : s === 'replaced'
            ? 'Connecté sur un autre appareil'
            : s === 'outdated'
              ? 'Mise à jour : recharger la page'
              : 'Connexion perdue, nouvel essai…';
    if (s !== 'online') {
      this.riderTags.clear();
      this.ridePanel.clearNearby();
    }
  }
}
