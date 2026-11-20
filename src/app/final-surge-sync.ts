import type { MappedFinalSurgeWorkout } from '../infra/integrations/final-surge/types';

export interface FinalSurgeImportSummary {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}
export interface FinalSurgeSyncResult extends FinalSurgeImportSummary {
  errors: string[];
  startDate: string;
  endDate: string;
}

function dateOnly(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

/** Fenêtre glissante de 14 jours calendaires : aujourd'hui inclus, jusqu'à J+13 inclus. */
export function finalSurgeSyncWindow(now = new Date()): { startDate: string; endDate: string } {
  const startDate = dateOnly(now);
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 13));
  return { startDate, endDate: end.toISOString().slice(0, 10) };
}

/** Synchronisation idempotente des séances planifiées des 14 prochains jours. */
export async function synchronizeFinalSurge(options: {
  fetchWorkouts: (startDate: string, endDate: string) => Promise<{ workouts: MappedFinalSurgeWorkout[]; errors: string[] }>;
  importWorkouts: (workouts: MappedFinalSurgeWorkout[]) => FinalSurgeImportSummary;
  now?: Date;
}): Promise<FinalSurgeSyncResult> {
  const { startDate, endDate } = finalSurgeSyncWindow(options.now);
  const fetched = await options.fetchWorkouts(startDate, endDate);
  const imported = options.importWorkouts(fetched.workouts);
  return { ...imported, errors: fetched.errors, startDate, endDate };
}
