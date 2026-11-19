import type { WorkoutChoice } from '../../app/workout-catalog';
import type { Workout } from '../../domain/workout/model';
import { profileShapes } from '../../domain/workout/profile';
import { setBlocked, type BlockReason } from '../shared/blocked';
import { byId } from '../shared/dom';
import { formatDuration } from '../shared/duration';

const PROFILE_W = 1000;
const PROFILE_H = 120;
const NO_WORKOUT = "Aucune séance choisie : choisis-en une sur l'accueil.";
const fmtTime = (s: number) => formatDuration(Math.floor(s));
const total = (w: Workout) => w.steps.reduce((t, s) => t + s.durationS, 0);

/** Ce que le coureur peut demander avec les commandes de la séance. */
export interface WorkoutControlsActions {
  /** Une séance est choisie dans la liste de l'accueil (`lib:<id>`, `sample:<id>`, ou vide). */
  choose(value: string): void;
  /** Démarrer la séance, depuis le menu de la sortie. */
  start(): void;
  /** Démarrer la séance, depuis l'accueil (qui ouvre d'abord la sortie). */
  startFromHome(): void;
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
}

/**
 * Les commandes de la séance : la liste de l'accueil (avec son profil), le démarrage, et, pendant la séance, pause, palier
 * suivant, arrêt et intensité, dans le menu de la sortie et, sur téléphone couché, posées sur la vue. Il demande
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
  private readonly select = byId<HTMLSelectElement>('home-wo-select');
  private readonly homeStart = byId<HTMLButtonElement>('home-wo-start');
  private readonly shapes = byId('home-wo-shapes');

  constructor(actions: WorkoutControlsActions) {
    this.select.addEventListener('change', () => actions.choose(this.select.value));
    this.homeStart.addEventListener('click', () => actions.startFromHome());
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

  /** La séance choisie dans la liste (`lib:<id>`, `sample:<id>`, ou vide). */
  get choice(): string {
    return this.select.value;
  }

  setChoice(value: string): void {
    this.select.value = value;
  }

  /** Reconstruit la liste en gardant le choix s'il existe encore. */
  showChoices(mine: WorkoutChoice[], samples: WorkoutChoice[]): void {
    const keep = this.select.value;
    const opt = (value: string, label: string) => Object.assign(document.createElement('option'), { value, textContent: label });
    const mineGroup = document.createElement('optgroup');
    mineGroup.label = 'Mes séances';
    mineGroup.append(...mine.map((c) => opt(c.value, c.label)));
    const sampleGroup = document.createElement('optgroup');
    sampleGroup.label = 'Modèles';
    sampleGroup.append(...samples.map((c) => opt(c.value, c.label)));
    this.select.replaceChildren(opt('', '— choisir une séance —'), ...(mineGroup.children.length ? [mineGroup] : []), sampleGroup);
    this.select.value = [...this.select.options].some((o) => o.value === keep) ? keep : '';
  }

  /** Le nom de la séance choisie, sa durée et sa description, dans le menu de la sortie. */
  showWorkoutName(w: Workout | undefined): void {
    byId('wo-name').textContent = w ? `${w.name} · ${fmtTime(total(w))}${w.description ? ` · ${w.description}` : ''}` : NO_WORKOUT;
  }

  /** Le profil de la séance sur l'accueil, pour la FTP du coureur. */
  showProfile(w: Workout | undefined, ftpW: number): void {
    this.shapes.replaceChildren();
    byId('home-wo-meta').textContent = w ? `${w.name} · ${fmtTime(total(w))}` : 'Aucune séance choisie.';
    if (!w) return;
    for (const s of profileShapes(w, ftpW, PROFILE_W, PROFILE_H)) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', s.d);
      path.setAttribute('class', s.zone);
      this.shapes.append(path);
    }
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
    setBlocked(this.homeStart, m.startReason);
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
  }
}
