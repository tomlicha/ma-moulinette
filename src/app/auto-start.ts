import type { RideSession } from './ride-session';
import type { TrainerController } from './trainer-controller';
import type { WorkoutSession } from './workout-session';

export interface AutoStartDeps {
  rideSession: Pick<RideSession, 'active'>;
  workoutSession: Pick<WorkoutSession, 'running' | 'workout'>;
  trainer: Pick<TrainerController, 'connected'>;
  /** L'écran Sortie est ouvert : le démarrage automatique n'y a lieu qu'ici. */
  rideScreenOpen: () => boolean;
  /** Quelque chose empêche de démarrer la séance choisie (pas de trainer, pas d'ERG) : on roule alors sans elle. */
  workoutBlocked: () => boolean;
  startWorkout: () => void;
  startRide: () => void;
  log: (message: string) => void;
}

/**
 * Démarrage au premier coup de pédale : sur l'écran Sortie, tant que rien n'a été lancé à la main, la première puissance
 * ou cadence reçue démarre la séance chargée (et la sortie qui la porte), ou la sortie libre s'il n'y en a pas.
 *
 * Armé en arrivant sur l'écran ou en choisissant une séance ; désarmé dès qu'une sortie ou une séance démarre, donc un
 * arrêt volontaire n'est pas défait par le pédalage qui continue.
 */
export class AutoStart {
  private armed = false;

  constructor(private readonly d: AutoStartDeps) {}

  /** Ne s'arme que si rien ne tourne : revenir sur l'écran en pleine sortie ne doit pas lancer une séance. */
  arm(): void {
    this.armed = !this.d.rideSession.active && !this.d.workoutSession.running;
  }

  disarm(): void {
    this.armed = false;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /** À appeler à chaque mesure reçue du trainer. */
  onMeasurement(m: { powerW?: number; cadenceRpm?: number }): boolean {
    const { rideSession, workoutSession, trainer, log } = this.d;
    if (!this.armed || workoutSession.running || !this.d.rideScreenOpen()) return false;
    if (!((m.powerW ?? 0) > 0 || (m.cadenceRpm ?? 0) > 0)) return false;
    if (workoutSession.workout && !this.d.workoutBlocked()) {
      log('premier coup de pédale : démarrage de la séance');
      this.d.startWorkout();
      return true;
    }
    if (!rideSession.active && trainer.connected) {
      log('premier coup de pédale : démarrage de la sortie');
      this.d.startRide();
      return true;
    }
    return false;
  }
}
