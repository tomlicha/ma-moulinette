import type { Workout, WorkoutStep, Target, StepKind } from '../../../domain/workout/model.ts';
import type {
  FinalSurgeMapperOptions,
  FinalSurgeRecord,
  MappedFinalSurgeWorkout,
} from './types.ts';

const DEFAULT_MAX_REPEAT = 50;
const DEFAULT_MAX_STEPS = 2_000;
type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function get(record: RecordLike, ...keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}
function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}
function firstText(record: RecordLike | undefined, ...keys: string[]): string | undefined {
  return record ? text(get(record, ...keys)) : undefined;
}
function dateText(record: RecordLike): string | undefined {
  return firstText(record, 'WorkoutDay', 'workoutDay', 'ScheduledDate', 'scheduledDate', 'Date', 'date');
}
function workoutKey(record: RecordLike): string | undefined {
  return firstText(record, 'WorkoutKey', 'workoutKey', 'workout_key', 'Key', 'key', 'Id', 'id', 'WorkoutId');
}
function unwrapBuilder(payload: unknown): RecordLike | undefined {
  let current: unknown = payload;
  for (let depth = 0; depth < 5; depth += 1) {
    if (Array.isArray(current)) { current = current.find(isRecord) ?? current[0]; continue; }
    if (!isRecord(current)) return undefined;
    if (get(current, 'target_options', 'targetOptions', 'steps', 'Steps')) return current;
    const next = get(current, 'data', 'Data', 'result', 'Result', 'builder', 'Builder', 'workoutBuilder', 'WorkoutBuilder');
    if (next === undefined) return current;
    current = next;
  }
  return isRecord(current) ? current : undefined;
}
function isBikeSport(value: string | undefined): boolean {
  const sport = (value ?? '').toLowerCase();
  return sport.includes('bike') || ['cycling', 'biking', 'cycle'].includes(sport);
}
function selectWorkoutOption(builder: RecordLike): RecordLike | undefined {
  const raw = get(builder, 'target_options', 'targetOptions', 'TargetOptions');
  const options = Array.isArray(raw) ? raw.filter(isRecord) : [];
  if (!options.length) return builder;
  // Le sport est le premier critère : accepter les libellés Final Surge comme « Bike - Interval ».
  return options.find((option) => isBikeSport(firstText(option, 'sport', 'Sport', 'type', 'Type')));
}
function parseDurationSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== 'string') return undefined;
  const input = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(input)) { const seconds = Number(input); return seconds > 0 ? Math.round(seconds) : undefined; }
  const parts = input.split(':');
  if (parts.length !== 2 && parts.length !== 3) return undefined;
  if (parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return undefined;
  const [first = 0, second = 0, third = 0] = parts.map(Number);
  const seconds = parts.length === 2 ? first * 60 + second : first * 3_600 + second * 60 + third;
  return seconds > 0 ? Math.round(seconds) : undefined;
}
function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim().replace(/[, ]/g, '').replace(/%|watts?|w$/i, '');
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function numericPair(record: RecordLike): { low?: number; high?: number } {
  return {
    low: finiteNumber(get(record, 'targetLow', 'TargetLow', 'low', 'Low', 'min', 'Min')),
    high: finiteNumber(get(record, 'targetHigh', 'TargetHigh', 'high', 'High', 'max', 'Max')),
  };
}
function targetEntries(raw: unknown): RecordLike[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  return isRecord(raw) ? [raw] : [];
}
function midpoint(low: number | undefined, high: number | undefined): number | undefined {
  if (low === undefined) return high;
  if (high === undefined) return low;
  return (low + high) / 2;
}
function mapZoneIndex(rawTargets: unknown): number | undefined {
  for (const entry of targetEntries(rawTargets)) {
    const type = (firstText(entry, 'targetType', 'TargetType', 'type', 'Type') ?? '').toLowerCase().replace(/[ _-]/g, '');
    const option = (firstText(entry, 'targetOption', 'TargetOption', 'unit', 'Unit') ?? '').toLowerCase();
    if (type === 'zone' || type === 'zoneindex' || /zone\s*index/.test(option) || option.includes('zoneindex')) {
      const { low, high } = numericPair(entry);
      const encoded = option.match(/zone\s*index\s*([1-6])/i)?.[1];
      const value = low ?? high ?? (encoded ? Number(encoded) : undefined);
      if (value !== undefined && Number.isInteger(value) && value >= 1 && value <= 6 && (high === undefined || high === value)) return value;
    }
  }
  return undefined;
}
function mapPowerTarget(rawTargets: unknown, warnings: string[], stepNumber: number): Target {
  const power = targetEntries(rawTargets).find((entry) => {
    const type = (firstText(entry, 'targetType', 'TargetType', 'type', 'Type') ?? '').toLowerCase();
    return type === 'power' || type === 'watts' || type === 'watt';
  });
  if (!power) return { kind: 'free' };
  const { low, high } = numericPair(power);
  const value = midpoint(low, high);
  if (value === undefined || value <= 0) {
    warnings.push(`Étape ${stepNumber} : cible de puissance Final Surge illisible, consigne laissée libre.`);
    return { kind: 'free' };
  }
  const descriptor = [
    firstText(power, 'targetType', 'TargetType'),
    firstText(power, 'targetOption', 'TargetOption'),
    firstText(power, 'unit', 'Unit', 'units', 'Units'),
  ].filter(Boolean).join(' ').toLowerCase();
  const isPercent = /percent|%|ftp|threshold|fraction/.test(descriptor);
  const isWatts = /watt|\bw\b|absolute/.test(descriptor) && !isPercent;
  if (!isPercent && !isWatts) {
    warnings.push(`Étape ${stepNumber} : unité de cible de puissance inconnue (${descriptor || 'non précisée'}), consigne laissée libre.`);
    return { kind: 'free' };
  }
  if (low !== undefined && high !== undefined && low !== high) {
    const unitLabel = isPercent ? '% FTP' : 'W';
    const displayPower = (number: number): number => isPercent && number <= 3 ? number * 100 : number;
    const format = (number: number): string => String(Number(number.toFixed(2)));
    warnings.push(`Étape ${stepNumber} : la plage de puissance ${format(displayPower(low))}–${format(displayPower(high))} ${unitLabel} est ramenée à son point milieu (${format(displayPower(value))} ${unitLabel}) pour produire une consigne ERG fixe.`);
  }
  if (isPercent) {
    const fraction = value > 3 ? value / 100 : value;
    if (fraction <= 0 || fraction > 3) {
      warnings.push(`Étape ${stepNumber} : pourcentage FTP hors limites, consigne laissée libre.`);
      return { kind: 'free' };
    }
    return { kind: 'ftp', from: fraction, to: fraction };
  }
  return { kind: 'watts', from: value, to: value };
}
function mapCadence(rawTargets: unknown, warnings: string[], stepNumber: number): number | undefined {
  const cadence = targetEntries(rawTargets).find((entry) => {
    const type = (firstText(entry, 'targetType', 'TargetType', 'type', 'Type') ?? '').toLowerCase();
    return type === 'cadence' || type === 'rpm';
  });
  if (!cadence) return undefined;
  const { low, high } = numericPair(cadence);
  const value = midpoint(low, high);
  if (value === undefined || value <= 0 || value > 250) {
    warnings.push(`Étape ${stepNumber} : cible de cadence non reconnue.`);
    return undefined;
  }
  if (low !== undefined && high !== undefined && low !== high) warnings.push(`Étape ${stepNumber} : la plage de cadence ${low}–${high} est ramenée à ${Math.round(value)} tr/min.`);
  return Math.round(value);
}
function mapIntensity(value: unknown): StepKind {
  switch ((text(value) ?? 'ACTIVE').toUpperCase()) {
    case 'WARMUP': case 'WARM_UP': return 'warmup';
    case 'REST': case 'RECOVERY': return 'off';
    case 'COOLDOWN': case 'COOL_DOWN': return 'cooldown';
    case 'MAX': case 'MAXIMUM': return 'max';
    case 'FREE': case 'OPEN': return 'free';
    case 'ACTIVE': default: return 'steady';
  }
}
function readSteps(option: RecordLike): unknown[] {
  const raw = get(option, 'steps', 'Steps', 'data', 'Data');
  return Array.isArray(raw) ? raw : [];
}
function expandSteps(rawSteps: unknown[], output: WorkoutStep[], warnings: string[], limits: Required<FinalSurgeMapperOptions>, depth = 0): void {
  if (depth > 8) { warnings.push('La structure contient des répétitions imbriquées trop profondes; le reste a été ignoré.'); return; }
  for (const raw of rawSteps) {
    if (output.length >= limits.maxSteps) { warnings.push(`La séance dépasse ${limits.maxSteps} étapes; les étapes restantes ont été ignorées.`); return; }
    if (!isRecord(raw)) { warnings.push('Un élément de structure Final Surge non reconnu a été ignoré.'); continue; }
    const type = (firstText(raw, 'type', 'Type') ?? 'step').toLowerCase();
    if (type === 'repeat' || type === 'repetition') {
      const countRaw = get(raw, 'repeats', 'repeat', 'Repeat', 'count', 'Count');
      const count = typeof countRaw === 'number' ? Math.floor(countRaw) : Number(countRaw);
      const children = get(raw, 'data', 'Data', 'steps', 'Steps');
      if (!Number.isInteger(count) || count < 1 || !Array.isArray(children)) { warnings.push('Un groupe de répétitions invalide a été ignoré.'); continue; }
      if (count > limits.maxRepeatCount) { warnings.push(`Un groupe de ${count} répétitions dépasse la limite de ${limits.maxRepeatCount}; il a été ignoré.`); continue; }
      const before = output.length;
      for (let repeat = 0; repeat < count; repeat += 1) {
        expandSteps(children, output, warnings, limits, depth + 1);
        if (output.length >= limits.maxSteps) break;
      }
      if (output.length > before) warnings.push(`Un groupe de ${count} répétitions a été déplié en étapes individuelles pour l'exécution.`);
      continue;
    }
    if (type !== 'step' && type !== 'workoutstep') { warnings.push(`Un bloc Final Surge de type « ${type} » a été ignoré.`); continue; }
    const durationType = (firstText(raw, 'durationType', 'DurationType') ?? 'TIME').toUpperCase();
    if (durationType !== 'TIME') {
      warnings.push(`Étape ${output.length + 1} : durée de type ${durationType} non convertible (Ma Moulinette attend des secondes); étape ignorée.`);
      continue;
    }
    const duration = parseDurationSeconds(get(raw, 'duration', 'Duration', 'durationS', 'DurationS'));
    if (!duration) { warnings.push(`Étape ${output.length + 1} : durée absente ou invalide; étape ignorée.`); continue; }
    const targets = get(raw, 'target', 'Target', 'targets', 'Targets');
    const stepNumber = output.length + 1;
    const zoneIndex = mapZoneIndex(targets);
    const target = zoneIndex === undefined ? mapPowerTarget(targets, warnings, stepNumber) : { kind: 'free' as const };
    const cadenceRpm = mapCadence(targets, warnings, stepNumber);
    const intensity = mapIntensity(get(raw, 'intensity', 'Intensity'));
    const kind: StepKind = intensity === 'free' || target.kind === 'free' ? (intensity === 'free' ? 'free' : intensity) : intensity;
    output.push({ kind, durationS: duration, target, ...(zoneIndex !== undefined ? { zoneIndex } : {}), ...(cadenceRpm !== undefined ? { cadenceRpm } : {}) });
  }
}


/**
 * Accepte les séances cyclistes dont chaque étape chronométrée possède une
 * cible de puissance/FTP ou est explicitement libre (« No Target »).
 */
export function isCyclingIntervalWorkout(builderPayload: unknown): boolean {
  const builder = unwrapBuilder(builderPayload);
  if (!builder) return false;
  const selected = selectWorkoutOption(builder);
  if (!selected) return false;
  const sport = firstText(selected, 'sport', 'Sport', 'type', 'Type');
  if (!isBikeSport(sport)) return false;

  const hasPowerTargetOnEveryStep = (items: unknown[], depth = 0): boolean => {
    if (depth > 8 || items.length === 0) return false;
    return items.every((item) => {
      if (!isRecord(item)) return false;
      const type = (firstText(item, 'type', 'Type') ?? 'step').toLowerCase();
      if (type === 'repeat' || type === 'repetition') {
        const countRaw = get(item, 'repeats', 'repeat', 'Repeat', 'count', 'Count');
        const count = typeof countRaw === 'number' ? Math.floor(countRaw) : Number(countRaw);
        const children = get(item, 'data', 'Data', 'steps', 'Steps');
        return Number.isInteger(count) && count >= 1 && Array.isArray(children) &&
          hasPowerTargetOnEveryStep(children, depth + 1);
      }
      if (type !== 'step' && type !== 'workoutstep') return false;
      const durationType = (firstText(item, 'durationType', 'DurationType') ?? 'TIME').toUpperCase();
      if (durationType !== 'TIME' || !parseDurationSeconds(get(item, 'duration', 'Duration', 'durationS', 'DurationS'))) return false;
      const rawTargets = get(item, 'target', 'Target', 'targets', 'Targets');
      const targets = targetEntries(rawTargets);
      const hasPowerTarget = targets.some((target) => {
        const targetType = (firstText(target, 'targetType', 'TargetType', 'type', 'Type') ?? '').toLowerCase().replace(/[ _-]/g, '');
        return ['power', 'watt', 'watts', 'ftp', 'percentftp', 'zone', 'zoneindex'].includes(targetType) || /zone\\s*index/i.test(firstText(target, 'targetOption', 'TargetOption') ?? '');
      });
      const hasExplicitNoTarget = (Array.isArray(rawTargets) && targets.length === 0) || targets.some((target) => {
        const targetType = (firstText(target, 'targetType', 'TargetType', 'type', 'Type') ?? '').toLowerCase().replace(/[ _-]/g, '');
        const targetOption = (firstText(target, 'targetOption', 'TargetOption', 'unit', 'Unit') ?? '').toLowerCase().replace(/[ _-]/g, '');
        return ['none', 'notarget', 'free'].includes(targetType) || ['none', 'notarget', 'free'].includes(targetOption);
      });
      return hasPowerTarget || hasExplicitNoTarget;
    });
  };
  return hasPowerTargetOnEveryStep(readSteps(selected));
}
/** Convert a calendar summary and Workout Builder payload to Ma Moulinette's Workout model. */
export function mapFinalSurgeWorkout(summary: FinalSurgeRecord, builderPayload: unknown, options: FinalSurgeMapperOptions = {}): MappedFinalSurgeWorkout {
  const warnings: string[] = [];
  const limits: Required<FinalSurgeMapperOptions> = {
    maxRepeatCount: options.maxRepeatCount ?? DEFAULT_MAX_REPEAT,
    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
  };
  const builder = unwrapBuilder(builderPayload);
  const selected = builder ? selectWorkoutOption(builder) : undefined;
  const rawSteps = selected ? readSteps(selected) : [];
  if (!builder || !selected) warnings.push('Structure Workout Builder absente ou non reconnue.');
  if (builder && !rawSteps.length) warnings.push('La séance Final Surge ne contient aucune étape structurée.');
  const steps: WorkoutStep[] = [];
  expandSteps(rawSteps, steps, warnings, limits);
  const name = firstText(summary, 'Title', 'title', 'Name', 'name') ?? firstText(selected, 'name', 'Name') ?? 'Séance Final Surge';
  const description = firstText(summary, 'Description', 'description', 'Notes', 'notes');
  const workout: Workout = { name, ...(description ? { description } : {}), steps, messages: [], warnings: [...new Set(warnings)] };
  const key = workoutKey(summary);
  const scheduledAt = dateText(summary);
  const source: MappedFinalSurgeWorkout['source'] = {
    provider: 'final-surge',
    ...(key ? { workoutKey: key } : {}),
    ...(scheduledAt ? { scheduledAt } : {}),
  };
  return { workout, source };
}
