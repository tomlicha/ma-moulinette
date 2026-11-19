import type { ControlProtocol } from '../../infra/sensors/protocols/trainer-profiles';
import type { TrainerCapabilities } from '../../infra/sensors/types';
import { setBlocked, type BlockReason } from '../shared/blocked';
import { byId } from '../shared/dom';
import { needTrainer, noControl } from './trainer-reasons';

/** Ce que la vue doit savoir pour savoir quoi permettre. */
export interface RideControlsModel {
  trainerConnected: boolean;
  trainerName: string | undefined;
  capabilities: TrainerCapabilities | undefined;
  rideActive: boolean;
  /** Protocole de pilotage imposé par le coureur, s'il y en a un. */
  forcedProtocol: ControlProtocol | undefined;
}

/** Ce que le coureur peut demander avec ces commandes. */
export interface RideControlsActions {
  /** Démarrer la sortie, ou l'arrêter. */
  toggleRide(): void;
  /** Le bouton ERG, avec la cible et la pente saisies. */
  toggleErg(targetW: number, gradePct: number): void;
  retargetErg(targetW: number): void;
  sendGrade(gradePct: number): void;
}

/**
 * Les commandes de la sortie : démarrer ou arrêter, engager l'ERG (cible en watts), imposer une pente à la main, et la
 * ligne du menu qui dit qui applique le braquet virtuel. Chaque bouton indisponible dit pourquoi (et mène à l'écran des
 * appareils quand c'est un trainer qui manque).
 */
export class RideControlsView {
  private readonly rideBtn = byId<HTMLButtonElement>('ride-toggle');
  private readonly ergBtn = byId<HTMLButtonElement>('erg-send');
  private readonly simBtn = byId<HTMLButtonElement>('sim-send');
  private readonly ergInput = byId<HTMLInputElement>('erg');
  private readonly gradeInput = byId<HTMLInputElement>('grade');

  constructor(
    actions: RideControlsActions,
    private readonly goDevices: () => void,
  ) {
    this.rideBtn.addEventListener('click', () => actions.toggleRide());
    this.ergBtn.addEventListener('click', () => actions.toggleErg(Number(this.ergInput.value), Number(this.gradeInput.value)));
    this.ergInput.addEventListener('change', () => actions.retargetErg(Number(this.ergInput.value)));
    this.simBtn.addEventListener('click', () => actions.sendGrade(Number(this.gradeInput.value)));
    this.gradeInput.addEventListener('input', () => {
      byId('grade-out').textContent = `${this.gradeInput.value} %`;
    });
  }

  /** Pente saisie, pour sortir de l'ERG hors sortie. */
  get manualGradePct(): number {
    return Number(this.gradeInput.value);
  }

  /** Le bouton ERG dit ce qu'il fera au prochain appui. */
  showErgEngaged(engaged: boolean): void {
    this.ergBtn.textContent = engaged ? "Désengager l'ERG" : "Engager l'ERG";
    this.ergBtn.classList.toggle('secondary', engaged);
  }

  /** Le bouton de la sortie dit ce qu'il fera au prochain appui. */
  showRideActive(active: boolean): void {
    this.rideBtn.textContent = active ? 'Arrêter la sortie' : 'Démarrer la sortie';
  }

  /**
   * Règle la disponibilité de chaque commande d'après le trainer et la sortie. Rend la raison qui empêche de démarrer une
   * sortie (`undefined` : on peut), que d'autres boutons « Rouler » reprennent.
   */
  render(m: RideControlsModel): BlockReason | undefined {
    const need = (text: string) => needTrainer(this.goDevices, text);
    const noCtl = (what: string) => noControl(this.goDevices, m.trainerName, what);
    byId('cog-mode').textContent = !m.trainerConnected
      ? ''
      : m.capabilities?.virtualGears
        ? 'Braquet géré par le trainer (protocole Zwift).'
        : m.forcedProtocol === 'zwift'
          ? 'Ce trainer ne répond pas au protocole Zwift : braquet simulé par la pente envoyée.'
          : 'Braquet simulé par la pente envoyée au trainer. Pour que le trainer le gère lui-même, choisis « Zwift » comme protocole de pilotage sur l’écran Appareils, puis reconnecte-le.';
    setBlocked(
      this.ergBtn,
      !m.trainerConnected
        ? need('Connecte d’abord ton home trainer pour lui imposer une puissance.')
        : !m.capabilities?.targetPower
          ? noCtl('mode ERG')
          : undefined,
    );
    setBlocked(
      this.simBtn,
      !m.trainerConnected
        ? need('Connecte d’abord ton home trainer pour lui imposer une pente.')
        : !m.capabilities?.simulation
          ? noCtl('mode SIM')
          : m.rideActive
            ? 'Pendant la sortie virtuelle, la pente vient du parcours. Arrête la sortie pour régler la pente à la main.'
            : undefined,
    );
    // La puissance seule suffit à rouler : la pente n'est envoyée que si le trainer sait la simuler.
    const needPowerToRide = m.trainerConnected || m.rideActive ? undefined : need('La sortie avance avec la puissance de ton home trainer : connecte-le d’abord.');
    setBlocked(this.rideBtn, needPowerToRide);
    return needPowerToRide;
  }
}
