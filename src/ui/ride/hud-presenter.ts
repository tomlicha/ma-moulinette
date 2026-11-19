import type { DeviceManager } from '../../app/device-manager';
import type { RideSession } from '../../app/ride-session';
import type { SensorReadings } from '../../app/sensor-readings';
import type { TrainerController } from '../../app/trainer-controller';
import type { WorkoutSession } from '../../app/workout-session';
import type { Journey } from '../../domain/sim/journey';
import type { RideHud } from './hud';
import type { RidePanel } from './ride-panel';

export interface HudPresenterContext {
  hud: RideHud;
  ridePanel: RidePanel;
  journey: Journey;
  readings: SensorReadings;
  trainer: TrainerController;
  devices: DeviceManager;
  rideSession: RideSession;
  workoutSession: WorkoutSession;
  readFtp: () => number;
  /** L'écran Sortie est ouvert : le HUD ne se met à jour (et les flèches ne servent) que là. */
  rideScreenOpen: () => boolean;
}

/**
 * Ce que le HUD et l'encart de la sortie affichent à chaque instant : il lit les mesures, la sortie, la séance et le
 * trainer, et les donne à l'affichage. Il porte aussi les choix du coureur sur la route (touche du HUD, flèches du
 * clavier, sortie de la piste d'un vélodrome), qui passent par le trajet.
 */
export class HudPresenter {
  constructor(private readonly c: HudPresenterContext) {
    setInterval(() => this.render(), 250);
    // Choix au carrefour : touche du HUD, ou flèches gauche et droite pour glisser la sélection d'une route à l'autre.
    c.hud.onChoose = (i) => {
      if (c.journey.choose(i)) this.render();
    };
    c.ridePanel.onTrackExit = () => {
      c.journey.setTrackExit(!c.journey.trackExitArmed);
      this.render();
    };
    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  render(): void {
    const { hud, ridePanel, journey, readings, trainer, devices, rideSession, workoutSession } = this.c;
    if (!this.c.rideScreenOpen()) return;
    const live = rideSession.snapshot; // la sortie en cours ; `undefined` hors sortie
    const runner = workoutSession.runner;
    const woState = workoutSession.state;
    hud.update({
      powerW: readings.averagePowerW(),
      heartRateBpm: readings.heartRateBpm(),
      cadenceRpm: readings.liveCadenceRpm(),
      // Pendant la sortie, la vitesse virtuelle (celle qui fait avancer la vue) ; sinon celle mesurée par le trainer.
      speedKmh: live ? live.speedKmh : readings.speedKmh(),
      ftpW: runner?.ftpW ?? this.c.readFtp(),
      ride: live ? { snapshot: live, climbM: rideSession.climbM } : undefined,
      workout: runner && woState ? { workout: runner.workout, state: woState, ftpW: runner.ftpW, intensity: runner.intensity } : undefined,
      message: runner ? woState?.message : undefined,
      control: trainer.ergActive ? 'erg' : live && trainer.capabilities?.simulation ? 'sim' : undefined,
      trainerConnected: devices.states.trainer === 'connected',
      heartRateConnected: devices.states.hr === 'connected',
      ...(live ? { junction: journey.pendingJunction(live.distanceM) } : {}),
    });
    // Encart : la carte suit le coureur ; elle passe seule au premier plan 250 m avant un carrefour (docs/design/sortie.md).
    const at = live ? live.distanceM : 0;
    ridePanel.update({
      distanceM: at,
      pending: live ? journey.pendingJunction(at) : undefined,
      // Sur la piste d'un vélodrome : la touche de sortie remplace le panneau « Carrefour » de chaque tour.
      trackExit: live && journey.onTrack(at) ? { armed: journey.trackExitArmed, inM: journey.trackExitInM(at) } : undefined,
    });
  }

  private onKey(e: KeyboardEvent): void {
    const { journey, rideSession } = this.c;
    if (e.ctrlKey || e.metaKey || e.altKey || !this.c.rideScreenOpen() || document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t instanceof HTMLElement && t.closest('input, select, textarea, [contenteditable]')) return;
    const by = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    // Sur la piste : flèche droite, sortir à la prochaine porte ; flèche gauche, rester sur la piste.
    const live = rideSession.snapshot;
    if (by && live && journey.onTrack(live.distanceM)) {
      e.preventDefault();
      journey.setTrackExit(by > 0);
      this.render();
      return;
    }
    const p = by && live ? journey.pendingJunction(live.distanceM) : undefined;
    if (!by || !p) return;
    e.preventDefault();
    if (journey.choose(Math.min(p.options.length - 1, Math.max(0, p.selected + by)))) this.render();
  }
}
