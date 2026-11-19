import { blocksToWorkout } from '../domain/workout/blocks';
import type { WorkoutLibrary } from '../domain/workout/library';
import type { Workout } from '../domain/workout/model';
import { parseWorkout } from '../domain/workout/runner';
import { SAMPLE_WORKOUTS } from '../domain/workout/samples';

/** Une séance proposée au choix : `value` est `lib:<id>` (séance du coureur) ou `sample:<id>` (modèle livré). */
export interface WorkoutChoice {
  value: string;
  label: string;
}

export interface WorkoutCatalogDeps {
  library: Pick<WorkoutLibrary, 'get' | 'list'>;
  log: (message: string) => void;
}

/**
 * Les séances qu'on peut choisir pour rouler : celles du coureur et les modèles livrés, et la séance que désigne un choix.
 * Une seule responsabilité : savoir ce qui existe et le retrouver. Il ne dessine pas la liste et ne retient pas le choix.
 */
export class WorkoutCatalog {
  constructor(private readonly d: WorkoutCatalogDeps) {}

  /** Les séances du coureur, puis les modèles. */
  choices(): { mine: WorkoutChoice[]; samples: WorkoutChoice[] } {
    return {
      mine: this.d.library.list().map((w) => ({ value: `lib:${w.id}`, label: w.name })),
      samples: SAMPLE_WORKOUTS.map((s) => ({ value: `sample:${s.id}`, label: parseWorkout(s.fileName, s.text).name })),
    };
  }

  /** La séance désignée par ce choix ; `undefined` si elle n'existe plus ou si le modèle est illisible. */
  resolve(value: string): Workout | undefined {
    const [kind, id] = value.split(':');
    if (kind === 'lib') {
      const saved = this.d.library.get(id ?? '');
      return saved && blocksToWorkout(saved.name, saved.description, saved.blocks);
    }
    const sample = SAMPLE_WORKOUTS.find((s) => s.id === id);
    if (!sample) return undefined;
    try {
      return parseWorkout(sample.fileName, sample.text);
    } catch (e) {
      this.d.log(`séance illisible (${sample.fileName}) : ${e instanceof Error ? e.message : e}`);
      return undefined;
    }
  }
}
