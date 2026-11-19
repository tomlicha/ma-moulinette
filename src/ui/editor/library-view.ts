import type { EditorSession } from '../../app/editor-session';
import { blocksToWorkout, workoutStats, workoutToBlocks, type EditorBlock } from '../../domain/workout/blocks';
import type { SavedWorkout, WorkoutLibrary } from '../../domain/workout/library';
import type { Workout } from '../../domain/workout/model';
import { SAMPLE_WORKOUTS } from '../../domain/workout/samples';
import { byId, el, fmtLong, fold, miniProfile } from './dom';

export interface LibraryViewContext {
  session: EditorSession;
  library: WorkoutLibrary;
  ftp: () => number;
  log: (message: string) => void;
  /** Le coureur ouvre cette séance (clé `lib:<id>` ou `sample:<id>`). */
  onPick: (key: string) => void;
  /** Le coureur veut supprimer cette séance. */
  onRemove: (w: SavedWorkout) => void;
}

/**
 * La bibliothèque de l'écran Séances : mes séances (avec la séance en cours si elle n'est pas encore enregistrée), les
 * modèles livrés, la recherche, et le message de la bibliothèque (le journal est masqué sur cet écran).
 */
export class LibraryView {
  constructor(private readonly c: LibraryViewContext) {}

  /** Message dans la bibliothèque : import refusé, enregistrement impossible. Il est aussi journalisé. */
  say(msg?: string): void {
    const p = byId('lib-msg');
    p.textContent = msg ?? '';
    p.hidden = !msg;
    if (msg) this.c.log(msg);
  }

  /** Durée, puissance moyenne et charge d'une suite de blocs, en une ligne. */
  summary(blocks: EditorBlock[]): string {
    const s = workoutStats(blocksToWorkout('x', undefined, blocks), this.c.ftp());
    return `${fmtLong(s.durationS)} · ${s.avgW} W · charge ${s.load}`;
  }

  private row(key: string, w: Workout, meta: string, pressed: boolean, onPick?: () => void, onRemove?: () => void) {
    const main = el(
      'button',
      { type: 'button', className: 'lib-item' },
      miniProfile(w, this.c.ftp()),
      el('span', { className: 'lib-text' }, el('strong', { textContent: w.name || 'Séance sans nom' }), el('small', { textContent: meta })),
    );
    main.dataset.key = key;
    main.setAttribute('aria-pressed', String(pressed));
    if (onPick) main.addEventListener('click', onPick);
    const row = el('li', { className: 'lib-row' }, main);
    if (onRemove) {
      const del = el('button', { type: 'button', className: 'lib-del', textContent: '✕', title: 'Supprimer' });
      del.setAttribute('aria-label', `Supprimer la séance « ${w.name} »`);
      del.addEventListener('click', onRemove);
      row.append(del);
    }
    return row;
  }

  render(): void {
    const { session, library, onPick, onRemove } = this.c;
    // Les lignes sont reconstruites à chaque ouverture : le focus clavier revient sur la même ligne.
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && active.closest('.sea-lib') ? active.dataset.key : undefined;
    const q = fold(byId<HTMLInputElement>('lib-search').value.trim());
    const match = (name: string) => !q || fold(name).includes(q);
    const current = session.keyOf(session.draft);

    const saved = library.list();
    const mine: HTMLElement[] = [];
    // Une séance nouvelle, importée ou copiée n'est pas encore dans la bibliothèque : on la montre en tête, ouverte.
    if (session.draft && !session.draft.id && !session.draft.readOnly) mine.push(this.row('draft', session.workout(), 'Non enregistrée', true));
    for (const w of saved.filter((x) => match(x.name))) {
      const key = `lib:${w.id}`;
      mine.push(this.row(key, blocksToWorkout(w.name, w.description, w.blocks), this.summary(w.blocks), current === key, () => onPick(key), () => onRemove(w)));
    }
    if (!mine.length) mine.push(el('li', { className: 'note', textContent: saved.length ? 'Aucune séance ne correspond.' : 'Aucune séance enregistrée : crée-en une ou duplique un modèle.' }));
    byId('lib-list').replaceChildren(...mine);
    byId('lib-count').textContent = String(saved.length);

    const samples = SAMPLE_WORKOUTS.flatMap((s) => {
      const w = session.sampleWorkout(s.id);
      return w && match(w.name)
        ? [this.row(`sample:${s.id}`, w, this.summary(workoutToBlocks(w, this.c.ftp()).blocks), current === `sample:${s.id}`, () => onPick(`sample:${s.id}`))]
        : [];
    });
    byId('lib-samples').replaceChildren(...(samples.length ? samples : [el('li', { className: 'note', textContent: 'Aucun modèle ne correspond.' })]));
    byId('lib-sample-count').textContent = String(SAMPLE_WORKOUTS.length);

    if (focusKey) document.querySelector<HTMLElement>(`.sea-lib [data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }
}
