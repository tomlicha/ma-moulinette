import { blocksToWorkout, validateBlocks, workoutStats, workoutToBlocks, type EditorBlock, type WorkoutStats } from '../domain/workout/blocks';
import { UndoHistory } from '../domain/workout/history';
import type { SavedWorkout, WorkoutLibrary } from '../domain/workout/library';
import type { Workout } from '../domain/workout/model';
import { parseWorkout } from '../domain/workout/runner';
import { SAMPLE_WORKOUTS } from '../domain/workout/samples';
import { timeInZones, type ZoneTimes } from '../domain/workout/zones';
import { TypedEmitter } from '../shared/util/typed-emitter';

/** La séance ouverte dans l'éditeur. */
export interface EditorDraft {
  /** Identifiant dans la bibliothèque, une fois la séance enregistrée. */
  id?: string;
  /** Modèle livré avec l'application : affiché en lecture seule, on le duplique pour le modifier. */
  sampleId?: string;
  readOnly?: boolean;
  name: string;
  description: string;
  blocks: EditorBlock[];
}

export type ImportResult = { kind: 'error'; message: string } | { kind: 'cancelled' } | { kind: 'opened'; warnings: string[] };
export type SaveResult = { kind: 'saved'; workout: SavedWorkout } | { kind: 'failed'; message: string };

export interface EditorSessionDeps {
  library: WorkoutLibrary;
  ftp: () => number;
  log: (message: string) => void;
  /** Des modifications en cours seraient perdues : le coureur les abandonne-t-il ? */
  confirmDiscard: () => boolean;
}

/**
 * L'état de l'éditeur de séance : la séance ouverte, le bloc sélectionné, l'historique d'annulation, et ce qui la lie à
 * la bibliothèque (ouvrir, enregistrer, supprimer, suivre un changement venu d'ailleurs).
 *
 * Une seule responsabilité : tenir cet état et ses règles (un modèle est en lecture seule ; chaque modification passe
 * par `commit`, qui l'inscrit dans l'historique ; une séance enregistrée n'est « modifiée » que si elle a changé).
 * Il ne dessine rien et ne pose aucune question au coureur : il publie `opened` (une séance vient de s'ouvrir),
 * `changed` (les blocs ou la sélection ont changé) et `focused` (une séance est devenue la séance choisie de l'application).
 */
export class EditorSession extends TypedEmitter<{
  opened: [];
  changed: [];
  focused: [key: string];
}> {
  draft: EditorDraft | undefined;
  selected = 0;
  readonly history = new UndoHistory<EditorBlock[]>();
  /** Version enregistrée (ou ouverte), pour l'indicateur « modifiée » et les écarts du résumé. */
  baseline = '';
  baseStats: WorkoutStats | undefined;
  baseZones: ZoneTimes | undefined;
  /** Saisie clavier en cours dans un champ : une seule entrée d'historique pour toute la frappe. */
  typing = false;

  constructor(private readonly deps: EditorSessionDeps) {
    super();
  }

  /** Clé d'une séance ouverte : `lib:<id>` (enregistrée) ou `sample:<id>` (modèle) ; rien pour un brouillon. */
  keyOf(d: EditorDraft | undefined = this.draft): string | undefined {
    return d?.id ? `lib:${d.id}` : d?.sampleId ? `sample:${d.sampleId}` : undefined;
  }

  workout(): Workout {
    return blocksToWorkout(this.draft?.name ?? '', this.draft?.description, this.draft?.blocks ?? []);
  }

  isDirty(): boolean {
    return !!this.draft && !this.draft.readOnly && JSON.stringify(this.draft) !== this.baseline;
  }

  /** Modèle livré avec l'application, relu (en watts, il dépend de la FTP) ; `undefined` s'il n'existe pas ou est illisible. */
  sampleWorkout(id: string): Workout | undefined {
    const s = SAMPLE_WORKOUTS.find((x) => x.id === id);
    if (!s) return undefined;
    try {
      return parseWorkout(s.fileName, s.text);
    } catch (e) {
      this.deps.log(`modèle illisible (${s.fileName}) : ${e instanceof Error ? e.message : e}`);
      return undefined;
    }
  }

  // --- Ouvrir ---

  /** Ouvre un brouillon ; `false` si le coureur préfère garder ses modifications en cours. */
  open(d: EditorDraft, unsaved = false): boolean {
    if (this.isDirty() && !this.deps.confirmDiscard()) return false;
    this.draft = d;
    this.selected = Math.min(1, d.blocks.length - 1);
    this.history.clear();
    this.typing = false;
    // Une séance importée ou nouvelle n'a pas de version enregistrée : elle part « modifiée ».
    this.baseline = unsaved ? '' : JSON.stringify(d);
    const w = this.workout();
    this.baseStats = unsaved ? undefined : workoutStats(w, this.deps.ftp());
    this.baseZones = unsaved ? undefined : timeInZones(w, this.deps.ftp());
    this.emit('opened');
    return true;
  }

  /** Ouvre la séance désignée par sa clé ; `false` si elle n'existe plus ou si le coureur garde son brouillon. */
  openKey(key: string): boolean {
    const [kind, id = ''] = key.split(':');
    if (kind === 'lib') {
      const w = this.deps.library.get(id);
      return !!w && this.open({ id: w.id, name: w.name, description: w.description ?? '', blocks: structuredClone(w.blocks) });
    }
    const w = this.sampleWorkout(id);
    if (!w) return false;
    return this.open({ sampleId: id, readOnly: true, name: w.name, description: w.description ?? '', blocks: workoutToBlocks(w, this.deps.ftp()).blocks });
  }

  /** Rien d'utilisable ouvert : la première séance du coureur, sinon le premier modèle. */
  openFallback(syncChoice: boolean): void {
    const first = this.deps.library.list()[0];
    const key = first ? `lib:${first.id}` : SAMPLE_WORKOUTS[0] ? `sample:${SAMPLE_WORKOUTS[0].id}` : undefined;
    if (key && this.openKey(key) && syncChoice) this.emit('focused', key);
  }

  /** Le modèle ouvert devient une séance à soi, à enregistrer : on ne modifie jamais un modèle. */
  duplicateModel(): void {
    const d = this.draft;
    if (!d?.readOnly) return;
    this.open({ name: `${d.name} (copie)`, description: d.description, blocks: structuredClone(d.blocks) }, true);
  }

  /** Ouvre une séance lue dans un fichier (.zwo, .erg, .mrc). */
  importFile(fileName: string, text: string): ImportResult {
    let w;
    try {
      w = parseWorkout(fileName, text);
    } catch (e) {
      return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
    const { blocks, warnings } = workoutToBlocks(w, this.deps.ftp());
    if (!this.open({ name: w.name, description: w.description ?? '', blocks }, true)) return { kind: 'cancelled' };
    return { kind: 'opened', warnings: [...w.warnings, ...warnings] };
  }

  /**
   * À l'arrivée sur l'écran : ouvre la séance choisie dans l'application, sauf si un brouillon modifié est en cours.
   * Une séance sans modification suit le choix fait ailleurs (accueil, sortie). Rend `true` si la séance ouverte reste
   * en place (rien n'a été ouvert : l'écran se redessine seulement).
   */
  syncTo(want: string): boolean {
    if (this.draft && (this.isDirty() || !want || want === this.keyOf())) return true;
    if (!(want && this.openKey(want)) && !this.draft) this.openFallback(false);
    return false;
  }

  /** La FTP a changé : un modèle en watts (.erg, .mrc) se relit en % de la FTP, on le rouvre. `false` : ce n'était pas un modèle. */
  reopenModel(): boolean {
    if (!this.draft?.readOnly) return false;
    const key = this.keyOf();
    const keep = this.selected;
    this.draft = undefined;
    if (key && this.openKey(key)) this.select(keep);
    return true;
  }

  /**
   * Séances changées depuis un autre appareil (synchronisation du compte). Une séance ouverte sans modification suit la
   * nouvelle version, ou laisse la place si elle a été supprimée ; un brouillon modifié reste tel quel : l'enregistrer
   * en fera la version la plus récente.
   */
  adoptLibraryChange(): void {
    const d = this.draft;
    if (!d?.id || this.isDirty()) return;
    const w = this.deps.library.get(d.id);
    if (!w) {
      this.draft = undefined;
      this.baseline = '';
      this.openFallback(false);
      return;
    }
    const next: EditorDraft = { id: w.id, name: w.name, description: w.description ?? '', blocks: structuredClone(w.blocks) };
    if (JSON.stringify(next) === this.baseline) return;
    const keep = this.selected;
    this.open(next);
    if (next.blocks.length) this.select(Math.min(keep, next.blocks.length - 1));
  }

  // --- Enregistrer, supprimer ---

  /** Enregistre la séance ouverte ; `undefined` si elle ne peut pas l'être (modèle, ou blocs à corriger). */
  save(): SaveResult | undefined {
    const d = this.draft;
    if (!d || d.readOnly || validateBlocks(d.blocks).length) return undefined;
    try {
      const saved = this.deps.library.save({
        id: d.id,
        name: d.name.trim() || 'Séance sans nom',
        description: d.description.trim() || undefined,
        blocks: d.blocks,
      });
      d.id = saved.id;
      d.name = saved.name;
      this.baseline = JSON.stringify(d);
      this.baseStats = workoutStats(this.workout(), this.deps.ftp());
      this.baseZones = timeInZones(this.workout(), this.deps.ftp());
      return { kind: 'saved', workout: saved };
    } catch (e) {
      return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Supprime une séance de la bibliothèque. Rend `true` si c'était la séance ouverte (il n'y en a plus d'ouverte). */
  removeSaved(w: SavedWorkout): boolean {
    this.deps.library.remove(w.id);
    const wasOpen = this.draft?.id === w.id;
    if (wasOpen) {
      this.draft = undefined;
      this.baseline = '';
    }
    return wasOpen;
  }

  // --- Modifier ---

  /** Applique une modification des blocs en l'inscrivant d'abord dans l'historique. */
  commit(change: (blocks: EditorBlock[]) => EditorBlock[], nextSelected = this.selected): void {
    const d = this.draft;
    if (!d || d.readOnly) return;
    this.history.record(d.blocks);
    d.blocks = change(d.blocks);
    this.selected = Math.max(0, Math.min(nextSelected, d.blocks.length - 1));
    this.emit('changed');
  }

  /**
   * Règle une valeur d'un bloc en modifiant une copie des blocs : une entrée d'historique, et la frappe en cours est
   * terminée. `set` reçoit `v` et modifie les blocs de la séance ouverte.
   */
  commitSet(set: (v: number) => void, v: number): void {
    const d = this.draft;
    if (!d || d.readOnly) return;
    this.history.record(d.blocks);
    this.typing = false;
    d.blocks = structuredClone(d.blocks);
    set(v);
    this.emit('changed');
  }

  updateSelected(f: (b: EditorBlock) => EditorBlock): void {
    this.commit((bs) => bs.map((b, i) => (i === this.selected ? f(b) : b)));
  }

  /** Insère des blocs (copies) à l'indice `at` et sélectionne le premier : une seule entrée d'historique. */
  addBlocks(blocks: EditorBlock[], at: number): void {
    this.commit((bs) => [...bs.slice(0, at), ...structuredClone(blocks), ...bs.slice(at)], at);
  }

  /** Place le bloc `from` à l'indice `to` et le sélectionne : une seule entrée d'historique. */
  moveBlock(from: number, to: number): void {
    if (from === to) return;
    this.commit((bs) => {
      const c = [...bs];
      const [m] = c.splice(from, 1);
      c.splice(to, 0, m!);
      return c;
    }, to);
  }

  select(i: number): void {
    const d = this.draft;
    if (!d?.blocks.length) return;
    this.selected = Math.max(0, Math.min(i, d.blocks.length - 1));
    this.emit('changed');
  }

  undo(): void {
    const d = this.draft;
    if (!d || d.readOnly) return;
    const prev = this.history.undo(d.blocks);
    if (!prev) return;
    d.blocks = prev;
    this.selected = Math.min(this.selected, prev.length - 1);
    this.emit('changed');
  }

  redo(): void {
    const d = this.draft;
    if (!d || d.readOnly) return;
    const next = this.history.redo(d.blocks);
    if (!next) return;
    d.blocks = next;
    this.selected = Math.min(this.selected, next.length - 1);
    this.emit('changed');
  }
}
