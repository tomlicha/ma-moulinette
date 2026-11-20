import type { Workout } from '../../domain/workout/model';
import { setBlocked, type BlockReason } from '../shared/blocked';
import { byId } from '../shared/dom';
import { formatDuration } from '../shared/duration';

const NO_WORKOUT = "Aucune séance choisie : choisis-en une sur l'accueil.";
const fmtTime = (s: number) => formatDuration(Math.floor(s));
const total = (w: Workout) => w.steps.reduce((t, s) => t + s.durationS, 0);

/** Ce que le coureur peut demander avec les commandes de la séance. */
export interface WorkoutControlsActions {
  /** Démarrer la séance, depuis le menu de la sortie. */
  start(): void;
  togglePause(): void;
  skip(): void;
  stop(): void;
  adjustIntensity(delta: number): void;
}

export interface WorkoutControlsModel {
  /** Une séance est en cours. */
  running: boolean;
  paused: boolean;
  /** Pourquoi on ne peut pas démarrer la séance maintenant (`undefined` : on peut). */
  startReason: string | BlockReason | undefined;
  /** Séance de groupe : le temps est celui du groupe, ni pause ni palier suivant ; « Arrêter » devient « Quitter le groupe ». */
  locked?: boolean;
}

/**
 * Les commandes de la séance : le démarrage et, pendant la séance, pause, palier suivant, arrêt et intensité, dans le menu de la sortie et, sur téléphone couché, posées sur la vue. Il demande
 * (`WorkoutControlsActions`) ; les règles sont dans la séance.
 */
export class WorkoutControlsView {
  private readonly start = byId<HTMLButtonElement>('wo-start');
  private readonly pause = byId<HTMLButtonElement>('wo-pause');
  private readonly skip = byId<HTMLButtonElement>('wo-skip');
  private readonly stop = byId<HTMLButtonElement>('wo-stop');
  private readonly easier = byId<HTMLButtonElement>('wo-easier');
  private readonly harder = byId<HTMLButtonElement>('wo-harder');
  private readonly quick = byId('ride-quick');
  private readonly quickPause = byId<HTMLButtonElement>('rq-pause');
  private readonly quickSkip = byId<HTMLButtonElement>('rq-skip');
  private readonly stopLabel = this.stop.textContent;

  constructor(actions: WorkoutControlsActions) {
    this.start.addEventListener('click', () => actions.start());
    // Commandes posées sur la vue : elles relaient celles du menu, qui portent les règles.
    for (const [quick, target] of [
      [this.quickPause, this.pause],
      [byId<HTMLButtonElement>('rq-skip'), this.skip],
      [byId<HTMLButtonElement>('rq-easier'), this.easier],
      [byId<HTMLButtonElement>('rq-harder'), this.harder],
    ] as const) {
      quick.addEventListener('click', () => target.click());
    }
    this.pause.addEventListener('click', () => actions.togglePause());
    this.skip.addEventListener('click', () => actions.skip());
    this.stop.addEventListener('click', () => actions.stop());
    this.easier.addEventListener('click', () => actions.adjustIntensity(-0.05));
    this.harder.addEventListener('click', () => actions.adjustIntensity(0.05));
  }

  /** Le nom de la séance choisie, sa durée et sa description, dans le menu de la sortie. */
  showWorkoutName(w: Workout | undefined): void {
    byId('wo-name').textContent = w ? `${w.name} · ${fmtTime(total(w))}${w.description ? ` · ${w.description}` : ''}` : NO_WORKOUT;
  }

  /** Intensité de la séance, affichée dans le menu et dans les commandes posées sur la vue. */
  showIntensity(fraction: number): void {
    const text = `${Math.round(fraction * 100)} %`;
    byId('wo-intensity').textContent = text;
    byId('rq-intensity').textContent = text;
  }

  /** Règle ce qui est disponible : « Démarrer » avant la séance, les commandes de déroulement pendant. */
  render(m: WorkoutControlsModel): void {
    setBlocked(this.start, m.startReason);
    for (const b of [this.pause, this.skip, this.stop, this.easier, this.harder]) setBlocked(b, m.running ? undefined : 'Démarre d’abord la séance.');
    this.pause.textContent = m.paused ? 'Reprendre' : 'Pause';
    // Téléphone couché : les mêmes commandes, posées sur la vue (voir ui/ride/sortie.css).
    this.quick.hidden = !m.running;
    this.quickPause.setAttribute('aria-pressed', String(m.paused));
    this.quickPause.setAttribute('aria-label', m.paused ? 'Reprendre' : 'Pause');
    // Dans le menu de la sortie : « Démarrer » avant la séance, les commandes de déroulement pendant.
    this.start.hidden = m.running;
    for (const b of [this.pause, this.skip, this.stop]) b.hidden = !m.running;
    byId('wo-intensity-row').hidden = !m.running;
    // Séance de groupe : le temps est celui du groupe.
    const locked = !!m.locked && m.running;
    for (const b of [this.pause, this.skip]) b.hidden = !m.running || locked;
    for (const b of [this.quickPause, this.quickSkip]) b.hidden = locked;
    this.stop.textContent = locked ? 'Quitter la séance de groupe' : this.stopLabel;
  }
}
