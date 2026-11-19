import type { SensorHub } from '../infra/sensors/hub';
import type { ConnectionState, SimulationParams, TrainerAdapter, TrainerCapabilities } from '../infra/sensors/types';
import { TypedEmitter } from '../shared/util/typed-emitter';
import type { GradeController } from './grade-controller';

export interface TrainerControllerDeps {
  hub: SensorHub;
  grade: GradeController;
  log: (message: string) => void;
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Attente avant de réessayer l'envoi de la pente après un échec : pas de marteau sur le trainer. */
const GRADE_RETRY_MS = 2000;

/**
 * Le trainer branché : sa connexion, son état, et tout ce qu'on lui commande (ERG, pente).
 *
 * Une seule responsabilité : parler au trainer et dire où il en est. Il ne sait rien de la sortie ni de la séance, ni de
 * l'écran : il publie `state` (changement d'état du trainer courant) et `erg` (consigne de puissance engagée ou relâchée),
 * et les autres s'y abonnent.
 */
export class TrainerController extends TypedEmitter<{
  state: [state: ConnectionState, detail: string | undefined];
  erg: [engaged: boolean];
}> {
  private adapter?: TrainerAdapter;
  private current: ConnectionState = 'disconnected';

  constructor(private readonly deps: TrainerControllerDeps) {
    super();
  }

  /** L'adaptateur courant, pour qui doit connaître son modèle (télémétrie, appareils connus). */
  get device(): TrainerAdapter | undefined {
    return this.adapter;
  }

  get state(): ConnectionState {
    return this.current;
  }

  get connected(): boolean {
    return this.current === 'connected';
  }

  get name(): string | undefined {
    return this.adapter?.name;
  }

  get capabilities(): TrainerCapabilities | undefined {
    return this.adapter?.capabilities;
  }

  /** Connecté et capable de suivre une puissance cible. */
  get canErg(): boolean {
    return this.connected && !!this.adapter?.capabilities.targetPower;
  }

  /** Connecté et capable de simuler une pente. */
  get canSimulate(): boolean {
    return this.connected && !!this.adapter?.capabilities.simulation;
  }

  /** ERG engagé : la consigne de puissance prime sur la pente du parcours. */
  get ergActive(): boolean {
    return this.deps.grade.ergActive;
  }

  /** Prend `adapter` comme trainer courant. Le précédent est lâché : il ne doit pas se reconnecter dans notre dos. */
  attach(adapter: TrainerAdapter): void {
    if (this.adapter && this.adapter !== adapter) void this.adapter.disconnect();
    this.adapter = adapter;
    this.deps.hub.attachTrainer(adapter);
    adapter.on('state', (state, detail) => {
      if (this.adapter !== adapter) return; // ancien adaptateur remplacé par un nouveau choix d'appareil
      this.current = state;
      this.emit('state', state, detail);
    });
  }

  /** Prend `adapter` et s'y connecte ; un échec est journalisé, pas relancé. */
  async connect(adapter: TrainerAdapter, nameHint?: string): Promise<void> {
    this.attach(adapter);
    try {
      await adapter.connect(nameHint);
    } catch (e) {
      this.deps.log(`échec de connexion : ${reason(e)}`);
    }
  }

  disconnect(): void {
    void this.adapter?.disconnect();
  }

  /** Engage ou relâche l'état « ERG » (sans rien envoyer) ; relâché, la prochaine mise à jour renvoie la pente du parcours. */
  setErgActive(engaged: boolean): void {
    this.deps.grade.setErgActive(engaged);
    this.emit('erg', engaged);
  }

  /** Envoie une commande au trainer et journalise l'issue. Rend `true` si elle est partie. */
  async send(label: string, command: () => Promise<void>): Promise<boolean> {
    try {
      await command();
      this.deps.log(`${label} envoyé`);
      return true;
    } catch (e) {
      this.deps.log(`${label} refusé : ${reason(e)}`);
      return false;
    }
  }

  /** Consigne de puissance, sans journal ni changement d'état (la séance renvoie la sienne toutes les secondes). */
  setTargetPower(watts: number): Promise<void> {
    return this.deps.hub.setTargetPower(watts);
  }

  /** Engage l'ERG à `watts`. */
  async engageErg(watts: number): Promise<boolean> {
    const sent = await this.send(`ERG ${watts} W`, () => this.deps.hub.setTargetPower(watts));
    if (sent) this.setErgActive(true);
    return sent;
  }

  /** Change la cible de l'ERG déjà engagé. */
  retargetErg(watts: number): Promise<boolean> {
    return this.send(`ERG ${watts} W`, () => this.deps.hub.setTargetPower(watts));
  }

  /** Pente imposée à la main : elle remplace l'ERG. */
  async setManualGrade(gradePct: number): Promise<boolean> {
    const sent = await this.send(`SIM ${gradePct} %`, () => this.deps.hub.setSimulation({ gradePct }));
    if (sent) this.setErgActive(false);
    return sent;
  }

  /** Hors sortie virtuelle, le trainer ne quitte l'ERG qu'avec une consigne de pente : on la lui envoie, avec `label`. */
  sendGradeAfterErg(label: string, gradePct: number): Promise<boolean> {
    return this.send(`${label}, SIM ${gradePct} %`, () => this.deps.hub.setSimulation({ gradePct }));
  }

  /**
   * Relâche l'ERG pris par la séance. Sans sortie virtuelle, le trainer ne le quitte qu'avec une consigne de pente ;
   * avec une sortie, la pente du parcours la remplace aussitôt. Sans trainer connecté, il n'y a rien à envoyer.
   */
  releaseErg(why: string, options: { rideActive: boolean; gradePct: number }): void {
    if (!this.ergActive) return;
    this.setErgActive(false);
    if (options.rideActive || !this.connected) return this.deps.log(why);
    void this.sendGradeAfterErg(why, options.gradePct);
  }

  /** Pente du parcours : envoyée au trainer, avec un nouvel essai un peu plus tard si l'envoi échoue. */
  sendCourseGrade(command: SimulationParams): void {
    this.deps.hub.setSimulation(command).catch((e) => {
      this.deps.log(`pente non envoyée : ${reason(e)}`);
      setTimeout(() => this.deps.grade.retry(), GRADE_RETRY_MS);
    });
  }

  /** Fin de sortie : le trainer revient à plat (sans rien dire si l'envoi échoue). */
  resetToFlat(): void {
    if (this.connected) void this.deps.hub.setSimulation({ gradePct: 0 }).catch(() => {});
  }
}
