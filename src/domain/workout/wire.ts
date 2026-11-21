import type { StepKind, Target, Workout, WorkoutMessage, WorkoutStep } from './model';

/**
 * Une séance qui voyage sur le réseau (séance de groupe) : le serveur la relaie à des inconnus qui vont l'exécuter. Elle est
 * donc relue **strictement** des deux côtés : ce qui n'est pas dans les bornes est refusé en bloc, jamais corrigé en silence.
 */

const KINDS: readonly StepKind[] = ['warmup', 'steady', 'ramp', 'on', 'off', 'cooldown', 'free', 'max'];

export const WIRE_MAX_STEPS = 300;
export const WIRE_MAX_MESSAGES = 100;
export const WIRE_MAX_STEP_S = 4 * 3600;
export const WIRE_MAX_TOTAL_S = 6 * 3600;
const MAX_FTP_FRACTION = 5;
const MAX_WATTS = 2500;
const MAX_TEXT = 200;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function readTarget(v: unknown): Target | undefined {
  if (!isObject(v)) return undefined;
  if (v.kind === 'free') return { kind: 'free' };
  if (v.kind === 'ftp' && num(v.from, 0, MAX_FTP_FRACTION) && num(v.to, 0, MAX_FTP_FRACTION)) return { kind: 'ftp', from: v.from, to: v.to };
  if (v.kind === 'watts' && num(v.from, 0, MAX_WATTS) && num(v.to, 0, MAX_WATTS)) return { kind: 'watts', from: v.from, to: v.to };
  return undefined;
}

function readStep(v: unknown): WorkoutStep | undefined {
  if (!isObject(v) || !KINDS.includes(v.kind as StepKind) || !num(v.durationS, 1, WIRE_MAX_STEP_S)) return undefined;
  const target = readTarget(v.target);
  if (!target) return undefined;
  const step: WorkoutStep = { kind: v.kind as StepKind, durationS: v.durationS, target };
  if (v.targetRange !== undefined) {
    if (v.targetRange !== true || target.kind !== 'ftp') return undefined;
    step.targetRange = true;
  }
  if (v.zoneIndex !== undefined) {
    if (!num(v.zoneIndex, 1, 6) || !Number.isInteger(v.zoneIndex)) return undefined;
    step.zoneIndex = v.zoneIndex;
  }
  if (v.cadenceRpm !== undefined) {
    if (!num(v.cadenceRpm, 0, 250)) return undefined;
    step.cadenceRpm = v.cadenceRpm;
  }
  return step;
}

function readMessage(v: unknown): WorkoutMessage | undefined {
  if (!isObject(v) || !num(v.atS, 0, WIRE_MAX_TOTAL_S) || !text(v.text, MAX_TEXT) || !num(v.durationS, 0, 3600)) return undefined;
  return { atS: v.atS, text: v.text, durationS: v.durationS };
}

/** Relit une séance reçue du réseau ; `undefined` si quoi que ce soit sort des bornes. Les avertissements de lecture ne voyagent pas. */
export function readWireWorkout(v: unknown): Workout | undefined {
  if (!isObject(v) || !text(v.name, 80) || !Array.isArray(v.steps) || v.steps.length < 1 || v.steps.length > WIRE_MAX_STEPS) return undefined;
  const steps: WorkoutStep[] = [];
  for (const s of v.steps) {
    const step = readStep(s);
    if (!step) return undefined;
    steps.push(step);
  }
  if (steps.reduce((t, s) => t + s.durationS, 0) > WIRE_MAX_TOTAL_S) return undefined;
  const rawMessages = v.messages === undefined ? [] : v.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length > WIRE_MAX_MESSAGES) return undefined;
  const messages: WorkoutMessage[] = [];
  for (const m of rawMessages) {
    const message = readMessage(m);
    if (!message) return undefined;
    messages.push(message);
  }
  if (v.description !== undefined && !text(v.description, 400)) return undefined;
  return { name: v.name, ...(typeof v.description === 'string' ? { description: v.description } : {}), steps, messages, warnings: [] };
}
