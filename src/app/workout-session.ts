import { ErgFollower } from '../domain/workout/erg-follower';
import { STEP_LABEL, type Workout } from '../domain/workout/model';
import { WorkoutRunner, type WorkoutState } from '../domain/workout/runner';
import { TypedEmitter } from '../shared/util/typed-emitter';
import type { TrainerController } from './trainer-controller';

/** La part du trainer dont la séance a besoin (et rien de plus : c'est ce qu'un test doit simuler). */
export type WorkoutTrainer = Pick<TrainerController, 'connected' | 'ergActive' | 'setErgActive' | 'setTargetPower' | 'releaseErg'>;

export interface WorkoutSessionDeps {
  trainer: WorkoutTrainer;
  /** FTP du coureur, au moment où la séance démarre. */
  ftpW: () => number;
  /** Une sortie virtuelle est en cours (le trainer suit alors la pente du parcours quand l'ERG est relâché). */
  rideActive: () => boolean;
  /** Pente à envoyer pour sortir de l'ERG quand aucune sortie n'est en cours. */
  manualGradePct: () => number;
  log: (message: string) => void;
  clock?: () => number;
}

/** Séance menée jusqu'au bout : de quoi bâtir le récapitulatif. */
export interface CompletedWorkout {
  workout: Workout;
  ftpW: number;
}

/** Le pas de la séance : toutes les 250 ms. */
const TICK_MS = 250;
/** Après un envoi raté, on attend avant de réessayer, pour ne pas marteler le trainer. */
const SEND_RETRY_MS = 2000;
const INTENSITY = { min: 0.5, max: 1.5 } as const;

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Une séance structurée : la séance choisie, son déroulement minuté, et la consigne ERG qu'elle impose au trainer.
 *
 * Une seule responsabilité : dérouler les paliers et piloter l'ERG en conséquence. Elle ne touche ni à l'écran, ni à la
 * sortie virtuelle (c'est l'appelant qui démarre l'une avec l'autre), ni à l'export, ni au récapitulatif : elle publie
 * ce qui se passe.
 *
 * Événements : `state` (à chaque pas, et `undefined` quand la séance se vide), `changed` (démarrage, pause, fin :
 * de quoi redessiner les boutons), `intensity` (nouvelle intensité), `started` (nom), `stepped` (consigne et palier du pas),
 * `completing` (dernier palier fini, avant le nettoyage), `ended` (après le nettoyage ; `completed` si menée au bout).
 */
export class WorkoutSession extends TypedEmitter<{
  state: [state: WorkoutState | undefined];
  changed: [];
  intensity: [fraction: number];
  started: [name: string];
  stepped: [targetW: number | undefined, stepIndex: number];
  completing: [];
  ended: [info: { reason: string; completed?: CompletedWorkout }];
}> {
  private chosen?: Workout;
  private current?: WorkoutRunner;
  private timer?: ReturnType<typeof setInterval>;
  private pausedFlag = false;
  /** En démarrage local différé, la séance attend la première mesure de pédalage. */
  private waitingForPedaling = false;
  private lastTickMs = 0;
  private last?: WorkoutState;
  private readonly follower = new ErgFollower();
  /** L'ERG a été désengagé à la main pendant la séance : elle continue sans imposer de consigne jusqu'au réengagement. */
  private ergOptOut = false;
  private sending = false;
  private holdUntilMs = 0;
  /** Séance de groupe : le temps vient d'une horloge commune (secondes depuis le départ), pas de ce coureur. */
  private external?: () => number;
  private readonly clock: () => number;

  constructor(private readonly deps: WorkoutSessionDeps) {
    super();
    this.clock = deps.clock ?? (() => performance.now());
  }

  /** La séance choisie, prête à démarrer. */
  get workout(): Workout | undefined {
    return this.chosen;
  }

  /** Le déroulement en cours ; `undefined` hors séance. */
  get runner(): WorkoutRunner | undefined {
    return this.current;
  }

  get running(): boolean {
    return this.current !== undefined;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  /** La séance suit l'horloge d'un groupe : ni pause ni palier passé à la main. */
  get synced(): boolean {
    return this.external !== undefined;
  }

  /** Dernier état connu de la séance en cours (palier, consigne, message). */
  get state(): WorkoutState | undefined {
    return this.last;
  }

  /** Choisit la séance à rouler (`undefined` : aucune). Sans effet pendant une séance : il faut d'abord l'arrêter. */
  select(workout: Workout | undefined): boolean {
    if (this.current) return false;
    this.chosen = workout;
    this.last = undefined;
    this.emit('state', undefined);
    return true;
  }

  /**
   * Démarre la séance choisie, avec la FTP du coureur. Sans effet sans séance choisie ou si une séance tourne déjà.
   * `clockS` : séance de groupe, le temps est celui du groupe (secondes depuis son départ) ; on arrive alors au bon palier,
   * même en retard, et on ne peut ni mettre en pause ni sauter de palier.
   */
  start(clockS?: () => number, waitForPedaling = false): void {
    const workout = this.chosen;
    if (!workout || this.current) return;
    this.external = clockS;
    const runner = new WorkoutRunner(workout, this.deps.ftpW());
    this.current = runner;
    this.pausedFlag = false;
    this.ergOptOut = false;
    this.holdUntilMs = 0;
    this.follower.reset();
    this.waitingForPedaling = waitForPedaling && !clockS;
    this.lastTickMs = this.clock();
    if (!this.waitingForPedaling) this.startClock();
    this.emit('intensity', 1);
    this.emit('changed');
    this.deps.log(`séance démarrée : ${workout.name}, FTP ${runner.ftpW} W`);
    this.emit('started', workout.name);
    if (!this.waitingForPedaling) this.tick();
    else {
      // Publier aussi l'état initial dans le getter `state` pendant l'attente du premier coup de pédale.
      this.last = runner.state();
      this.emit('state', this.last);
    }
  }

  /** Démarre le chronomètre au premier coup de pédale reçu du trainer. */
  onMeasurement(m: { powerW?: number; cadenceRpm?: number }): boolean {
    if (!this.current || !this.waitingForPedaling) return false;
    if (!((m.powerW ?? 0) > 0 || (m.cadenceRpm ?? 0) > 0)) return false;
    this.waitingForPedaling = false;
    this.lastTickMs = this.clock();
    this.startClock();
    this.deps.log('premier coup de pédale : chronomètre de la séance démarré');
    this.tick();
    return true;
  }

  private startClock(): void {
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Arrête la séance en cours (à la main) : l'ERG est relâché. */
  stop(why = 'séance arrêtée'): void {
    this.finish(why);
  }

  togglePause(): void {
    if (!this.current || this.external) return;
    this.pausedFlag = !this.pausedFlag;
    this.follower.reset();
    this.deps.log(this.pausedFlag ? 'séance en pause' : 'séance reprise');
    this.emit('changed');
  }

  /** Passe au palier suivant. */
  skip(): void {
    if (!this.current || this.external) return;
    const s = this.current.skip();
    this.follower.reset();
    this.deps.log(`séance : palier suivant (${STEP_LABEL[s.step.kind]})`);
    this.tick();
  }

  /** Change l'intensité de `delta` (0,05 = 5 %), entre 50 et 150 %. */
  adjustIntensity(delta: number): void {
    const runner = this.current;
    if (!runner || this.waitingForPedaling) return;
    runner.intensity = Math.min(INTENSITY.max, Math.max(INTENSITY.min, Math.round((runner.intensity + delta) * 100) / 100));
    this.emit('intensity', runner.intensity);
    this.follower.reset();
  }

  /** La FTP a changé : la séance en cours en tient compte aussitôt. */
  setFtp(ftpW: number): void {
    if (this.current) this.current.ftpW = ftpW;
  }

  /** Le coureur a désengagé l'ERG : la séance continue sans consigne jusqu'à ce qu'il le réengage. */
  optOutErg(): void {
    this.ergOptOut = true;
    this.deps.log('ERG désengagé : la séance continue sans imposer de consigne');
  }

  /** Le coureur réengage l'ERG : la séance reprend la main et renvoie aussitôt sa consigne du moment. */
  reengageErg(): void {
    this.ergOptOut = false;
    this.follower.reset();
    this.deps.log('ERG réengagé : la séance reprend sa consigne');
    this.tick();
  }

  /** Un pas : avance la séance (si elle compte du temps) et règle l'ERG. Public pour les tests. */
  tick(): void {
    const runner = this.current;
    if (!runner) return;
    const { trainer, log } = this.deps;
    const now = this.clock();
    const dt = (now - this.lastTickMs) / 1000;
    this.lastTickMs = now;
    // Sans trainer connecté, le temps de séance s'arrête : on ne compte pas un palier que personne ne pédale.
    // En groupe, le temps est celui du groupe : il passe même sans trainer, et on retrouve le bon palier à la reconnexion.
    const running = !this.pausedFlag && trainer.connected;
    const s = this.external ? runner.seek(this.external()) : running ? runner.advance(dt) : runner.state();
    this.last = s;
    this.emit('state', s);
    if (s.done) {
      const completed = { workout: runner.workout, ftpW: runner.ftpW };
      this.emit('completing'); // l'export s'arrêtera à la fin du dernier palier
      this.finish('séance terminée', completed);
      return;
    }
    // Consigne et palier notés dans l'enregistrement : le récapitulatif en tire la courbe et les blocs tenus.
    if (running) this.emit('stepped', s.targetW, s.stepIndex);
    if (!running || this.ergOptOut || this.sending || now < this.holdUntilMs) return;

    if (s.targetW === undefined) {
      this.follower.reset();
      trainer.releaseErg(`palier ${STEP_LABEL[s.step.kind].toLowerCase()} : ERG relâché`, this.releaseOptions());
      return;
    }
    if (!trainer.ergActive) this.follower.reset(); // ERG relâché ailleurs (fin de sortie, reconnexion) : on le reprend aussitôt
    const w = this.follower.next(s, now);
    if (w === undefined) return;
    this.sending = true;
    trainer
      .setTargetPower(w)
      .then(() => {
        if (!trainer.ergActive) {
          trainer.setErgActive(true);
          log(`séance : ERG engagé à ${w} W`);
        }
      })
      .catch((e) => {
        log(`séance : consigne ${w} W non envoyée (${reason(e)})`);
        this.follower.reset();
        this.holdUntilMs = this.clock() + SEND_RETRY_MS;
      })
      .finally(() => (this.sending = false));
  }

  private releaseOptions() {
    return { rideActive: this.deps.rideActive(), gradePct: this.deps.manualGradePct() };
  }

  private finish(why: string, completed?: CompletedWorkout): void {
    if (!this.current) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.current = undefined;
    this.waitingForPedaling = false;
    this.pausedFlag = false;
    this.ergOptOut = false;
    this.external = undefined;
    if (this.deps.trainer.ergActive) this.deps.trainer.releaseErg(why, this.releaseOptions());
    else this.deps.log(why);
    this.last = undefined;
    this.emit('state', undefined);
    this.emit('changed');
    this.emit('ended', completed ? { reason: why, completed } : { reason: why });
  }
}
