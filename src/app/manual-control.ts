import type { RideSession } from './ride-session';
import type { TrainerController } from './trainer-controller';
import type { WorkoutSession } from './workout-session';

export interface ManualControlDeps {
  trainer: Pick<TrainerController, 'ergActive' | 'setErgActive' | 'sendGradeAfterErg' | 'engageErg' | 'retargetErg' | 'setManualGrade'>;
  rideSession: Pick<RideSession, 'active'>;
  workoutSession: Pick<WorkoutSession, 'running' | 'optOutErg' | 'reengageErg'>;
  log: (message: string) => void;
}

/**
 * Les commandes que le coureur donne à la main au trainer : engager ou relâcher l'ERG, changer sa cible, imposer une pente.
 *
 * Une seule responsabilité : les règles de ces gestes selon ce qui tourne. Pendant une séance, c'est elle qui fixe la
 * consigne : relâcher l'ERG le met en retrait jusqu'au réengagement, et changer la cible n'a pas d'effet. Pendant une
 * sortie, relâcher l'ERG rend la pente du parcours ; sinon le trainer ne quitte l'ERG qu'avec une consigne de pente.
 */
export class ManualControl {
  constructor(private readonly d: ManualControlDeps) {}

  /** Le bouton ERG : engage à `targetW`, ou relâche. `gradePct` : la pente de repli, hors sortie. */
  async toggleErg(targetW: number, gradePct: number): Promise<void> {
    const { trainer, rideSession, workoutSession, log } = this.d;
    if (trainer.ergActive) {
      trainer.setErgActive(false);
      if (workoutSession.running) workoutSession.optOutErg();
      if (rideSession.active) {
        log('ERG désengagé : pente du parcours reprise');
      } else {
        // Hors sortie, le trainer ne quitte l'ERG qu'avec une consigne de pente.
        await trainer.sendGradeAfterErg('ERG désengagé', gradePct);
      }
      return;
    }
    // Pendant une séance, réengager rend la main à la séance, qui renvoie aussitôt sa consigne du moment.
    if (workoutSession.running) return workoutSession.reengageErg();
    await trainer.engageErg(targetW);
  }

  /** Changer la cible pendant que l'ERG est engagé l'applique aussitôt (en séance, c'est la séance qui fixe la consigne). */
  retargetErg(targetW: number): void {
    const { trainer, workoutSession } = this.d;
    if (!trainer.ergActive || workoutSession.running) return;
    void trainer.retargetErg(targetW);
  }

  /** Impose une pente : elle remplace l'ERG. */
  async setGrade(gradePct: number): Promise<void> {
    await this.d.trainer.setManualGrade(gradePct);
  }
}
