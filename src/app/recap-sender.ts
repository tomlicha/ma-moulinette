import type { StravaOutcome, StravaReadiness } from './ride-export';
import { TypedEmitter } from '../shared/util/typed-emitter';

/** Durée du compte à rebours avant l'envoi automatique à Strava. */
export const COUNTDOWN_S = 8;

/**
 * Où en est l'envoi du récapitulatif : compte à rebours (l'envoi part seul), en attente d'un geste, en cours, fait,
 * refusé (on peut réessayer), ou impossible (rien à envoyer, ou fichier refusé pour de bon).
 */
export type SendState = 'countdown' | 'manual' | 'sending' | 'sent' | 'error' | 'none';

export interface RecapSenderDeps {
  /** Envoie la sortie à Strava sous ce nom. */
  send(name: string): Promise<StravaOutcome>;
  /** Le nom que le cycliste a choisi, lu au moment de l'envoi. */
  name(): string;
  countdownS?: number;
}

/**
 * L'envoi du récapitulatif à Strava : le compte à rebours, l'envoi automatique, ce qui le suspend, les essais.
 * L'écran (ui/recap/recap.ts) affiche ses états et lui signale les gestes ; elle ne décide de rien.
 *
 * Événements : `state` à chaque changement d'état (avec le résultat de l'envoi, s'il y en a un) ; `tick` chaque seconde
 * du compte à rebours, avec les secondes restantes (la première fois tout de suite).
 */
export class RecapSender extends TypedEmitter<{ state: [state: SendState, outcome?: StravaOutcome]; tick: [secondsLeft: number] }> {
  private current: SendState = 'none';
  private strava: StravaReadiness = 'none';
  private defaultName = '';
  private began = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private left = 0;
  private readonly countdownS: number;

  constructor(private readonly deps: RecapSenderDeps) {
    super();
    this.countdownS = deps.countdownS ?? COUNTDOWN_S;
  }

  get state(): SendState {
    return this.current;
  }

  /** Strava est prêt, à connecter, ou absent ; devient `login` quand Strava refuse l'accès en pleine sortie. */
  get readiness(): StravaReadiness {
    return this.strava;
  }

  /** Un nouveau récapitulatif : compte à rebours si Strava est prêt, sinon on attend un geste (ou il n'y a rien à envoyer). */
  begin(readiness: StravaReadiness, defaultName: string): void {
    this.stopCountdown();
    this.strava = readiness;
    this.defaultName = defaultName;
    this.began = true;
    if (readiness === 'ready') {
      this.left = this.countdownS;
      this.setState('countdown');
      this.tick();
      this.timer = setInterval(() => this.tick(), 1000);
    } else {
      this.setState(readiness === 'none' ? 'none' : 'manual');
    }
  }

  /** Arrête le compte à rebours sans envoyer : l'envoi attend un geste. Sans effet hors compte à rebours. */
  hold(): void {
    if (this.current !== 'countdown') return;
    this.stopCountdown();
    this.setState('manual');
  }

  /** Envoie maintenant. Sans effet si rien n'a commencé, si un envoi est en cours ou si c'est déjà fait. */
  async send(): Promise<void> {
    if (!this.began || this.current === 'sending' || this.current === 'sent') return;
    this.stopCountdown();
    this.setState('sending');
    const outcome = await this.deps.send(this.deps.name().trim() || this.defaultName);
    if (outcome.ok) {
      this.setState('sent', outcome);
    } else {
      // Accès Strava perdu : le bouton dira qu'il rouvrira la connexion, pas seulement « Réessayer ».
      if (outcome.login) this.strava = 'login';
      this.setState(outcome.kept ? 'error' : 'none', outcome);
    }
  }

  /** Le récapitulatif se ferme : un envoi programmé part tout de suite plutôt que d'être annulé. */
  release(): void {
    if (this.current === 'countdown') void this.send();
    this.stopCountdown();
  }

  private tick(): void {
    this.emit('tick', this.left);
    if (this.left <= 0) {
      this.stopCountdown();
      void this.send();
    }
    this.left--;
  }

  private stopCountdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private setState(state: SendState, outcome?: StravaOutcome): void {
    this.current = state;
    this.emit('state', state, outcome);
  }
}
