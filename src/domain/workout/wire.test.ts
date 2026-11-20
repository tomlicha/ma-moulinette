import { describe, expect, it } from 'vitest';
import type { Workout } from './model';
import { readWireWorkout, WIRE_MAX_STEPS } from './wire';

const good: Workout = {
  name: 'Sweet spot',
  description: 'deux fois vingt minutes',
  steps: [
    { kind: 'warmup', durationS: 300, target: { kind: 'ftp', from: 0.5, to: 0.75 }, cadenceRpm: 90 },
    { kind: 'steady', durationS: 1200, target: { kind: 'ftp', from: 0.9, to: 0.9 } },
    { kind: 'on', durationS: 60, target: { kind: 'watts', from: 300, to: 300 } },
    { kind: 'free', durationS: 120, target: { kind: 'free' } },
  ],
  messages: [{ atS: 10, text: 'Allez !', durationS: 5 }],
  warnings: ['ignoré'],
};

describe('readWireWorkout', () => {
  it('relit une séance bien formée, sans ses avertissements', () => {
    const r = readWireWorkout(JSON.parse(JSON.stringify(good)))!;
    expect(r).toEqual({ ...good, warnings: [] });
  });

  it("n'a besoin ni de description, ni de messages", () => {
    const { description: _d, messages: _m, ...bare } = good;
    expect(readWireWorkout(bare)).toMatchObject({ name: 'Sweet spot', messages: [] });
  });

  it.each([
    ['pas un objet', 'x'],
    ['sans nom', { ...good, name: 5 }],
    ['nom trop long', { ...good, name: 'x'.repeat(81) }],
    ['sans palier', { ...good, steps: [] }],
    ['trop de paliers', { ...good, steps: Array.from({ length: WIRE_MAX_STEPS + 1 }, () => good.steps[1]) }],
    ['genre inconnu', { ...good, steps: [{ ...good.steps[1], kind: 'sprint' }] }],
    ['durée nulle', { ...good, steps: [{ ...good.steps[1], durationS: 0 }] }],
    ['durée infinie', { ...good, steps: [{ ...good.steps[1], durationS: Infinity }] }],
    ['durée texte', { ...good, steps: [{ ...good.steps[1], durationS: '60' }] }],
    ['séance de plus de six heures', { ...good, steps: [good.steps[1], { ...good.steps[1], durationS: 4 * 3600 }, { ...good.steps[1], durationS: 4 * 3600 }] }],
    ['cible inconnue', { ...good, steps: [{ ...good.steps[1], target: { kind: 'rpe', from: 1, to: 2 } }] }],
    ['fraction de FTP démesurée', { ...good, steps: [{ ...good.steps[1], target: { kind: 'ftp', from: 0, to: 50 } }] }],
    ['watts négatifs', { ...good, steps: [{ ...good.steps[1], target: { kind: 'watts', from: -1, to: 100 } }] }],
    ['cadence absurde', { ...good, steps: [{ ...good.steps[1], cadenceRpm: 900 }] }],
    ['message trop long', { ...good, messages: [{ atS: 0, text: 'x'.repeat(201), durationS: 5 }] }],
    ['messages pas en liste', { ...good, messages: {} }],
  ])('refuse en bloc : %s', (_label, bad) => {
    expect(readWireWorkout(bad)).toBeUndefined();
  });

  it("ne garde que les champs connus (rien d'autre ne passe)", () => {
    const r = readWireWorkout({ ...good, evil: '<script>', steps: [{ ...good.steps[1], extra: 1 }] })!;
    expect(r).not.toHaveProperty('evil');
    expect(r.steps[0]).not.toHaveProperty('extra');
  });
});
