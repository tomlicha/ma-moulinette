import type { Journey } from '../domain/sim/journey';
import { ClimbCounter } from '../domain/sim/climb-counter';
import { draftFrom } from '../domain/sim/draft';
import { DEFAULT_RIDER } from '../domain/sim/physics';
import type { NetPosition } from '../domain/course/track';
import type { RidePacing } from '../domain/group/group-pace';
import { Ride, type RideSnapshot } from '../domain/sim/ride';
import { TypedEmitter } from '../shared/util/typed-emitter';
import type { GradeController, VirtualGearing } from './grade-controller';
import type { SensorReadings } from './sensor-readings';
import type { TrainerController } from './trainer-controller';

/** Un autre coureur de la salle, tel que l'aspiration le lit. */
export interface NearbyRider {
  point: { x: number; z: number; heading: number };
  speedMs: number;
  riding: boolean;
}

/** Ce que la sortie publie à chaque pas : où en est le cycliste, avec les mesures qui l'ont fait avancer. */
export interface RideFrame {
  snapshot: RideSnapshot;
  powerW: number;
  cadenceRpm: number;
}

/** La part du trainer dont la sortie a besoin (et rien de plus : c'est ce qu'un test doit simuler). */
export type RideTrainer = Pick<TrainerController, 'canSimulate' | 'capabilities' | 'setErgActive' | 'sendCourseGrade' | 'resetToFlat'>;

export interface RideSessionDeps {
  journey: Journey;
  readings: SensorReadings;
  grade: GradeController;
  trainer: RideTrainer;
  /** Les vitesses virtuelles, telles que le coureur les a réglées. */
  gearing: () => VirtualGearing;
  /** Les autres coureurs de la salle, pour l'aspiration. */
  riders: () => readonly NearbyRider[];
  /** Aide de rappel du suivi (part de traînée épargnée en plus), 0 hors suivi : voir `FollowSession.assist`. */
  assist?: () => number;
  clock?: () => number;
}

/** Le pas de la sortie : toutes les 100 ms, avec le temps réellement écoulé. */
const TICK_MS = 100;

/**
 * Une sortie virtuelle : sa vie (départ, pause faute de trainer, reprise, arrêt) et son pas régulier.
 *
 * Une seule responsabilité : faire avancer le cycliste sur le parcours à partir des mesures, et dire ce qui se passe.
 * Elle ne touche ni à l'écran, ni à la vue 3D, ni au réseau, ni à l'export : ils s'abonnent à `tick`.
 * Elle décide en revanche de la pente à envoyer au trainer (par le `GradeController`), puisque c'est une conséquence du pas.
 *
 * Événements : `started` (masse), `tick` (à chaque pas), `paused` / `stopped` (distance où le cycliste s'arrête),
 * `resumed`. Pendant `stopped`, la sortie est déjà terminée (`active` vaut `false`).
 */
export class RideSession extends TypedEmitter<{
  started: [massKg: number];
  tick: [frame: RideFrame];
  paused: [distanceM: number];
  resumed: [];
  stopped: [distanceM: number];
}> {
  private ride?: Ride;
  private timer?: ReturnType<typeof setInterval>;
  private lastTickMs = 0;
  private last?: RideSnapshot;
  private pausedFlag = false;
  private draftReduction = 0;
  /** Rythme imposé par un groupe : la sortie avance avec lui et non avec la puissance mesurée. */
  private pacing?: RidePacing;
  private readonly climb = new ClimbCounter();
  private readonly clock: () => number;

  constructor(private readonly deps: RideSessionDeps) {
    super();
    this.clock = deps.clock ?? (() => performance.now());
  }

  /** Une sortie est en cours (y compris en pause). */
  get active(): boolean {
    return this.ride !== undefined;
  }

  /** En pause faute de trainer : position et vitesse gardées, reprises à la reconnexion. */
  get paused(): boolean {
    return this.pausedFlag;
  }

  /** Le cycliste de la sortie (masse, paramètres) ; `undefined` hors sortie. */
  get rider(): Ride['rider'] | undefined {
    return this.ride?.rider;
  }

  /** Dernier état de la sortie en cours ; `undefined` hors sortie. */
  get snapshot(): RideSnapshot | undefined {
    return this.ride ? this.last : undefined;
  }

  /** Dénivelé positif de la sortie, en m. */
  get climbM(): number {
    return this.climb.total;
  }

  /** Part de la traînée de l'air épargnée en ce moment par l'aspiration derrière un autre coureur (0 : seul). */
  get draft(): number {
    return this.draftReduction;
  }

  /**
   * Démarre une sortie au départ du parcours `courseId`, ou derrière le coureur qu'on rejoint si `behind` est donné
   * (ses kilomètres se comptent alors depuis ce point). Sans effet si une sortie est déjà en cours.
   */
  start(massKg: number, courseId: string, behind?: NetPosition, pacing?: RidePacing): void {
    if (this.ride) return;
    this.pacing = pacing;
    this.deps.journey.setCourse(courseId); // repart du départ du parcours choisi, sans choix de carrefour en mémoire
    if (behind) this.deps.journey.placeAt(behind);
    this.ride = new Ride(this.deps.journey, pacing?.rider ?? { ...DEFAULT_RIDER, massKg });
    this.last = this.ride.snapshot();
    this.pausedFlag = false;
    this.climb.reset();
    this.deps.grade.reset();
    this.lastTickMs = this.clock();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emit('started', massKg);
  }

  /** Une séance de groupe impose son rythme à la sortie. */
  get paced(): boolean {
    return this.pacing !== undefined;
  }

  /**
   * Rejoue la sortie de groupe depuis le départ avec un nouveau rythme : le trajet repart du début du parcours (en gardant les
   * choix du groupe) et la simulation rattrape le temps du groupe au pas suivant. Sert à se recaler quand on a dérivé (un choix
   * de route raté). Sans effet hors séance de groupe.
   */
  repace(pacing: RidePacing): void {
    if (!this.ride || !this.pacing) return;
    this.deps.journey.reset();
    this.pacing = pacing;
    this.ride = new Ride(this.deps.journey, pacing.rider);
    this.last = this.ride.snapshot();
    this.climb.reset();
    this.deps.grade.reset();
  }

  /** Rend la sortie à la puissance du coureur (il quitte le groupe) : elle continue de là où elle est. */
  releasePacing(): void {
    this.pacing = undefined;
  }

  /** Trainer perdu : la sortie s'arrête de compter sans disparaître. */
  pause(): void {
    if (!this.ride || this.pausedFlag) return;
    this.pausedFlag = true;
    clearInterval(this.timer);
    this.emit('paused', this.ride.snapshot().distanceM);
  }

  /** Trainer revenu : la sortie repart d'où elle s'était arrêtée. */
  resume(): void {
    if (!this.ride || !this.pausedFlag) return;
    this.pausedFlag = false;
    this.deps.grade.reset(); // le trainer reconnecté repart de zéro : on lui renvoie la pente
    this.lastTickMs = this.clock();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emit('resumed');
  }

  /** Termine la sortie. `resetTrainer` : remet le trainer à plat (pas à faire si on repart aussitôt). */
  stop(resetTrainer = true): void {
    const ride = this.ride;
    if (!ride) return;
    clearInterval(this.timer);
    this.pausedFlag = false;
    this.deps.trainer.setErgActive(false);
    const distanceM = ride.snapshot().distanceM;
    this.ride = undefined;
    this.pacing = undefined;
    this.emit('stopped', distanceM);
    if (resetTrainer) this.deps.trainer.resetToFlat();
  }

  /** Un pas : mesures → physique → ce que chacun en fait (`tick`) → pente vers le trainer. Public pour les tests. */
  tick(): void {
    const ride = this.ride;
    if (!ride) return;
    const { readings, grade, trainer } = this.deps;
    const now = this.clock();
    const powerW = readings.powerW();
    let snapshot: RideSnapshot;
    if (this.pacing) {
      // Séance de groupe : tout le groupe est au même endroit au même instant, sans aspiration entre coureurs superposés.
      this.draftReduction = 0;
      ride.setDraft(0);
      this.pacing.advance(ride);
      snapshot = ride.snapshot();
    } else {
      this.updateDraft(ride);
      snapshot = ride.advance((now - this.lastTickMs) / 1000, powerW);
    }
    this.lastTickMs = now;
    this.last = snapshot;
    this.climb.add(snapshot.altitudeM);
    this.emit('tick', { snapshot, powerW, cadenceRpm: readings.cadenceRpm() });

    const command = grade.update({
      nowMs: now,
      courseGradePct: snapshot.gradePct,
      speedMs: snapshot.speedKmh / 3.6,
      cadenceRpm: readings.liveCadenceRpm(),
      rider: ride.rider,
      gearing: this.deps.gearing(),
      trainerAppliesGears: !!trainer.capabilities?.virtualGears,
      canSimulate: trainer.canSimulate,
    });
    if (command) trainer.sendCourseGrade(command);
  }

  /** Aspiration derrière les coureurs que la salle montre : recalculée à chaque pas, avec la position du coureur local. */
  private updateDraft(ride: Ride): void {
    const others = this.deps.riders();
    if (others.length === 0) {
      this.draftReduction = 0;
      ride.setDraft(0);
      return;
    }
    const me = this.deps.journey.pointAt(this.last?.distanceM ?? 0);
    const leaders = others.map((r) => ({ x: r.point.x, z: r.point.z, heading: r.point.heading, speedMs: r.speedMs, riding: r.riding }));
    const real = draftFrom({ x: me.x, z: me.z, heading: me.heading }, leaders).reduction;
    // L'aide du suivi ne s'ajoute pas à la vraie aspiration : la meilleure des deux compte, comme entre deux meneurs.
    this.draftReduction = Math.max(real, this.deps.assist?.() ?? 0);
    ride.setDraft(this.draftReduction);
  }
}
