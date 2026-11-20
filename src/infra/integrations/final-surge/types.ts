/** Types for the undocumented Final Surge web-app API.
 * Keep these payloads deliberately loose: Final Surge does not publish a stable schema.
 */
export type FinalSurgeRecord = Record<string, unknown>;

export interface FinalSurgeDateRange {
  /** Inclusive calendar date, YYYY-MM-DD. */
  startDate: string;
  /** Inclusive calendar date, YYYY-MM-DD. */
  endDate: string;
}

export interface FinalSurgeClientOptions {
  /** Session token obtained outside this module. Never pass an athlete password. */
  accessToken: string;
  /** Final Surge user key returned by the account/profile flow. */
  userKey: string;
  /** Defaults to the beta web-app API. This is not a public/stable API. */
  baseUrl?: string;
  /** Injectable for tests and Cloudflare Worker compatibility. */
  fetch?: typeof fetch;
}

export interface FinalSurgeSourceMetadata {
  provider: 'final-surge';
  workoutKey?: string;
  scheduledAt?: string;
}

export interface MappedFinalSurgeWorkout {
  workout: import('../../../domain/workout/model.ts').Workout;
  source: FinalSurgeSourceMetadata;
}

export interface FinalSurgeMapperOptions {
  /** Maximum number of intervals expanded from a single repetition group. */
  maxRepeatCount?: number;
  /** Maximum number of steps emitted from a single workout. */
  maxSteps?: number;
}
