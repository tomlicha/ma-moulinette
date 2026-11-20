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

/**
 * Identifiant local stable pour une séance Final Surge. Il doit être identique sur tous les appareils :
 * deux imports indépendants du même externalId deviennent ainsi le même élément dans le journal de synchronisation.
 */
function finalSurgeWorkoutId(externalId: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904223;
  let h4 = 2773480762;
  for (let i = 0; i < externalId.length; i += 1) {
    const code = externalId.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hash = [h1, h2, h3, h4].map((part) => (part >>> 0).toString(16).padStart(8, '0')).join('');
  return `fs-${hash}`;
}

function sourceOf(item: ImportedWorkout): WorkoutSource | undefined {
  const externalId = item.source.workoutKey?.trim();
  if (!externalId) return undefined;
  return { provider: 'final-surge', externalId, ...(item.source.scheduledAt ? { scheduledAt: item.source.scheduledAt } : {}) };
}

/** Orchestration applicative : transforme les séances du fournisseur, les déduplique et met à jour les imports existants. */
export function importFinalSurgeWorkouts(options: {
  library: Pick<WorkoutLibrary, 'list' | 'save' | 'remove'>;
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
