import type {
  FinalSurgeClientOptions,
  FinalSurgeDateRange,
  FinalSurgeRecord,
} from './types.ts';

/** Final Surge's web app currently omits the first day of a multi-day WorkoutList range. */
const RANGE_PADDING_DAYS = 1;

export class FinalSurgeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FinalSurgeHttpError';
  }
}

export class FinalSurgeAuthenticationError extends FinalSurgeHttpError {
  constructor() {
    super('La session Final Surge a expiré ou n’est plus autorisée.', 401);
    this.name = 'FinalSurgeAuthenticationError';
  }
}

function assertIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${field} doit être une date YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${field} doit être une date YYYY-MM-DD valide.`);
  }
}

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function asRecord(value: unknown): FinalSurgeRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as FinalSurgeRecord)
    : undefined;
}

function unwrapPayload(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    const record = asRecord(current);
    if (!record) return current;
    const next = ['data', 'Data', 'result', 'Result', 'workout', 'Workout', 'builder', 'Builder']
      .map((key) => record[key])
      .find((item) => item !== undefined && item !== null);
    if (next === undefined) return current;
    current = next;
  }
  return current;
}

function recordsFromPayload(value: unknown): FinalSurgeRecord[] {
  const unwrapped = unwrapPayload(value);
  if (Array.isArray(unwrapped)) return unwrapped.map(asRecord).filter((item): item is FinalSurgeRecord => Boolean(item));
  const record = asRecord(unwrapped);
  if (!record) return [];
  for (const key of ['workouts', 'Workouts', 'items', 'Items', 'results', 'Results', 'WorkoutList']) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.map(asRecord).filter((item): item is FinalSurgeRecord => Boolean(item));
    }
  }
  return [];
}

function workoutDate(workout: FinalSurgeRecord): string | undefined {
  const raw = workout.WorkoutDay ?? workout.workoutDay ?? workout.Date ?? workout.date ?? workout.ScheduledDate;
  if (typeof raw !== 'string') return undefined;
  return raw.slice(0, 10);
}

/**
 * Read-only client for the endpoints currently used by Final Surge's own web app.
 * These endpoints are undocumented and may change without notice. Do not expose this
 * client as an official integration. Credential storage is handled by the server-side integration module.
 */
export class FinalSurgeClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: FinalSurgeClientOptions) {
    if (!options.accessToken.trim()) throw new TypeError('accessToken requis.');
    if (!options.userKey.trim()) throw new TypeError('userKey requis.');
    this.baseUrl = (options.baseUrl ?? 'https://beta.finalsurge.com/api').replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * Lists planned workouts in an inclusive date range. The range is padded because
   * the observed web-app endpoint can omit the first day of a multi-day query; results
   * are filtered back to the requested dates locally.
   */
  async listWorkouts(range: FinalSurgeDateRange): Promise<FinalSurgeRecord[]> {
    assertIsoDate(range.startDate, 'startDate');
    assertIsoDate(range.endDate, 'endDate');
    if (range.startDate > range.endDate) throw new RangeError('startDate doit précéder endDate.');

    const params = new URLSearchParams({
      scope: 'USER',
      scopekey: this.options.userKey,
      startdate: shiftDate(range.startDate, -RANGE_PADDING_DAYS),
      enddate: shiftDate(range.endDate, RANGE_PADDING_DAYS),
      ishistory: 'false',
      completedonly: 'false',
    });
    const payload = await this.get(`/WorkoutList?${params.toString()}`);
    return recordsFromPayload(payload).filter((item) => {
      const date = workoutDate(item);
      return !date || (date >= range.startDate && date <= range.endDate);
    });
  }

  /** Returns the Workout Builder JSON for one calendar workout. */
  async getStructuredWorkout(workoutKey: string): Promise<unknown> {
    if (!workoutKey.trim()) throw new TypeError('workoutKey requis.');
    const params = new URLSearchParams({
      scope: 'USER',
      scopekey: this.options.userKey,
      workout_key: workoutKey,
      array: 'true',
      newobject: 'true',
    });
    const payload = await this.get(`/WorkoutBuilderGet?${params.toString()}`);

    // Résumé structurel compact : évite d'envoyer le JSON complet (potentiellement très long)
    // dans les logs Cloudflare. Les valeurs ne sont conservées que pour les champs utiles au diagnostic.
    const diagnosticFields = new Set(['sport', 'type', 'targettype', 'unit', 'durationtype']);
    const summarize = (value: unknown, depth = 0): unknown => {
      if (Array.isArray(value)) {
        return { arrayLength: value.length, sample: value.slice(0, 2).map((item) => summarize(item, depth + 1)) };
      }
      if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).slice(0, 30);
        return Object.fromEntries(entries.map(([key, item]) => [
          key,
          diagnosticFields.has(key.toLowerCase())
            ? (typeof item === 'string' || typeof item === 'number' ? item : summarize(item, depth + 1))
            : depth >= 4
              ? typeof item
              : summarize(item, depth + 1),
        ]));
      }
      return typeof value;
    };
    console.info('[Final Surge] WorkoutBuilderGet structure:', JSON.stringify(summarize(payload)));

    return payload;
  }

  private async get(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.options.accessToken}`,
      },
    });

    if (response.status === 401) throw new FinalSurgeAuthenticationError();
    if (!response.ok) {
      throw new FinalSurgeHttpError(`Final Surge a répondu HTTP ${response.status}.`, response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new FinalSurgeHttpError('Réponse Final Surge non JSON.', response.status);
    }

    const record = asRecord(payload);
    if (record?.success === false || record?.Success === false) {
      const message = record.message ?? record.Message ?? 'Erreur retournée par Final Surge.';
      throw new FinalSurgeHttpError(String(message), response.status);
    }
    return payload;
  }
}
