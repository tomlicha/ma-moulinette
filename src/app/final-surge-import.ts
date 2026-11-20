import type { EditorBlock } from '../domain/workout/blocks';
import type { SavedWorkout, WorkoutLibrary, WorkoutSource } from '../domain/workout/library';
import type { Workout, WorkoutStep } from '../domain/workout/model';

export interface ImportedWorkout {
  workout: Workout;
  source: { provider: 'final-surge'; workoutKey?: string; scheduledAt?: string };
}
export interface ImportResult { created: number; updated: number; unchanged: number; skipped: number; }

function blocksFromWorkout(workout: Workout, ftpW: number): EditorBlock[] {
  return workout.steps.map((step: WorkoutStep): EditorBlock => {
    const cadenceRpm = step.cadenceRpm;
    if (step.kind === 'warmup' || step.kind === 'cooldown' || step.kind === 'ramp') {
      const from = step.target.kind === 'ftp' ? step.target.from : step.target.kind === 'watts' ? step.target.from / ftpW : 0.5;
      const to = step.target.kind === 'ftp' ? step.target.to : step.target.kind === 'watts' ? step.target.to / ftpW : from;
      return { type: step.kind, durationS: step.durationS, from, to, ...(cadenceRpm ? { cadenceRpm } : {}) };
    }
    if (step.target.kind === 'free') return { type: 'free', durationS: step.durationS };
    const from = step.target.kind === 'ftp' ? step.target.from : step.target.from / ftpW;
    return { type: 'steady', durationS: step.durationS, power: from, ...(cadenceRpm ? { cadenceRpm } : {}) };
  });
}

function sourceOf(item: ImportedWorkout): WorkoutSource | undefined {
  const externalId = item.source.workoutKey?.trim();
  if (!externalId) return undefined;
  return { provider: 'final-surge', externalId, ...(item.source.scheduledAt ? { scheduledAt: item.source.scheduledAt } : {}) };
}

/** Orchestration applicative : transforme les séances du fournisseur, les déduplique et met à jour les imports existants. */
export function importFinalSurgeWorkouts(options: {
  library: Pick<WorkoutLibrary, 'list' | 'save'>;
  workouts: ImportedWorkout[];
  ftpW: number;
}): ImportResult {
  const ftpW = Number.isFinite(options.ftpW) && options.ftpW > 0 ? options.ftpW : 1;
  const existing = options.library.list();
  const bySource = new Map(existing.flatMap((w) => w.source?.provider === 'final-surge'
    ? [[w.source.externalId, w] as const] : []));
  const result: ImportResult = { created: 0, updated: 0, unchanged: 0, skipped: 0 };

  for (const item of options.workouts) {
    const mapped = item.workout;
    const source = sourceOf(item);
    if (!mapped.steps.length || !source) { result.skipped++; continue; }
    const blocks = blocksFromWorkout(mapped, ftpW);
    const warnings = [...mapped.warnings];
    if (mapped.steps.some((s) => s.kind === 'off' || s.kind === 'on' || s.kind === 'max')) {
      warnings.push('Certains types d’intensité Final Surge sont représentés comme paliers dans l’éditeur.');
    }
    const description = [mapped.description, ...warnings].filter(Boolean).join('\n\n');
    const previous = bySource.get(source.externalId);
    if (previous && previous.name === mapped.name && (previous.description ?? '') === description &&
      JSON.stringify(previous.blocks) === JSON.stringify(blocks) &&
      previous.source?.scheduledAt === source.scheduledAt) {
      result.unchanged++;
      continue;
    }
    const saved = options.library.save({
      ...(previous ? { id: previous.id } : {}),
      name: mapped.name,
      description,
      blocks,
      source,
    });
    bySource.set(source.externalId, saved);
    if (previous) result.updated++;
    else result.created++;
  }
  return result;
}
