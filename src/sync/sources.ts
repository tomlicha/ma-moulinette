import { blockBody, type BlockLibrary, type SavedBlock } from '../workout/block-library';
import type { EditorBlock } from '../workout/blocks';
import { workoutBody, type SavedWorkout, type WorkoutLibrary } from '../workout/library';
import type { SyncSource } from './client';
import type { SyncItem } from './protocol';

/** Séances de l'éditeur, élément par élément. `onChange` : la bibliothèque a changé (listes à refaire). */
export function workoutSource(lib: WorkoutLibrary, onChange: (ids: Set<string>) => void): SyncSource {
  return {
    kind: 'workout',
    all: () => lib.list().map((w): SyncItem => ({ kind: 'workout', id: w.id, body: workoutBody(w), updatedAt: w.updatedAt })),
    apply(items) {
      const put: SavedWorkout[] = [];
      const drop: string[] = [];
      for (const i of items) {
        if (i.body === null) drop.push(i.id);
        else {
          const b = i.body as { name: string; description?: string; blocks: EditorBlock[] };
          put.push({ id: i.id, name: b.name, description: b.description, blocks: b.blocks, updatedAt: i.updatedAt });
        }
      }
      lib.merge(put, drop);
      onChange(new Set(items.map((i) => i.id)));
    },
    clear() {
      lib.clear();
      onChange(new Set());
    },
  };
}

/** « Mes blocs ». */
export function blockSource(lib: BlockLibrary, onChange: () => void): SyncSource {
  return {
    kind: 'block',
    all: () => lib.list().map((b): SyncItem => ({ kind: 'block', id: b.id, body: blockBody(b), updatedAt: b.updatedAt })),
    apply(items) {
      const put: SavedBlock[] = [];
      const drop: string[] = [];
      for (const i of items) {
        if (i.body === null) drop.push(i.id);
        else {
          const b = i.body as { name: string; blocks: EditorBlock[] };
          put.push({ id: i.id, name: b.name, blocks: b.blocks, updatedAt: i.updatedAt });
        }
      }
      lib.merge(put, drop);
      onChange();
    },
    clear() {
      lib.clear();
      onChange();
    },
  };
}
