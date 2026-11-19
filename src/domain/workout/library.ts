import { browserStore, type KeyValueStore } from '../../infra/storage/key-value-store';
import type { SyncJournal } from '../../infra/sync/journal';
import type { EditorBlock } from './blocks';

export interface SavedWorkout {
  id: string;
  name: string;
  description?: string;
  blocks: EditorBlock[];
  updatedAt: number;
}

const KEY = 'mamoulinette.workouts';

/** Contenu d'une séance tel qu'il est synchronisé avec le compte (src/infra/sync/protocol.ts). */
export const workoutBody = (w: SavedWorkout) => ({ name: w.name, description: w.description, blocks: w.blocks });

/**
 * Séances créées dans l'éditeur, gardées dans le navigateur de l'utilisateur. Chaque modification est notée dans le
 * journal de synchronisation : avec un compte, elles suivent le coureur d'un appareil à l'autre (src/infra/sync/).
 */
export class WorkoutLibrary {
  constructor(
    private readonly store: KeyValueStore = browserStore(),
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly journal?: Pick<SyncJournal, 'record'>,
  ) {}

  list(): SavedWorkout[] {
    try {
      const raw = JSON.parse(this.store.getItem(KEY) ?? '[]') as unknown;
      if (!Array.isArray(raw)) return [];
      return (raw as SavedWorkout[])
        .filter((w) => w && typeof w.id === 'string' && typeof w.name === 'string' && Array.isArray(w.blocks))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  get(id: string): SavedWorkout | undefined {
    return this.list().find((w) => w.id === id);
  }

  /** Crée la séance si elle n'a pas d'identifiant, sinon la remplace. Renvoie la version enregistrée. */
  save(w: Omit<SavedWorkout, 'id' | 'updatedAt'> & { id?: string }, now = Date.now()): SavedWorkout {
    const saved: SavedWorkout = { ...w, id: w.id ?? this.newId(), updatedAt: now };
    this.write([saved, ...this.list().filter((x) => x.id !== saved.id)]);
    this.journal?.record('workout', saved.id, workoutBody(saved), saved.updatedAt);
    return saved;
  }

  remove(id: string, now = Date.now()) {
    this.write(this.list().filter((w) => w.id !== id));
    this.journal?.record('workout', id, null, now);
  }

  /** Séances venues du compte (remplacées ou ajoutées) et supprimées ailleurs ; rien n'est noté dans le journal. */
  merge(put: SavedWorkout[], drop: string[]) {
    const gone = new Set([...drop, ...put.map((w) => w.id)]);
    this.write([...put, ...this.list().filter((w) => !gone.has(w.id))]);
  }

  /** Efface toutes les séances, sans rien noter (changement de compte). */
  clear() {
    this.write([]);
  }

  private write(list: SavedWorkout[]) {
    this.store.setItem(KEY, JSON.stringify(list)); // une erreur de quota remonte : l'éditeur doit dire que l'enregistrement a échoué
  }
}
