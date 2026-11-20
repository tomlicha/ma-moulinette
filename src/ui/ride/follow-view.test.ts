import { describe, expect, it } from 'vitest';
import type { FollowState } from '../../app/follow-session';
import { followEndText, followGapText, followStatusText } from './follow-view';

const state = (over: Partial<FollowState> = {}): FollowState => ({ slot: 1, name: 'Lucie', phase: 'following', gapM: 14, gapS: 3.2, assist: 0, ...over });

describe('followGapText', () => {
  it('donne les mètres et les secondes quand elle est devant', () => {
    expect(followGapText(state())).toBe('+15 m · 3 s'); // par 5 m, comme l'encart
  });
  it("pas de secondes derrière, ni sous une seconde, ni quand elle est à l'arrêt", () => {
    expect(followGapText(state({ gapM: -20, gapS: 2 }))).toBe('−20 m');
    expect(followGapText(state({ gapM: 3, gapS: 0.3 }))).toBe('+5 m');
    const { gapS: _ignored, ...still } = state();
    expect(followGapText(still)).toBe('+15 m');
  });
  it('à côté : 0 m, jamais « −0 m »', () => {
    expect(followGapText(state({ gapM: -0.4, gapS: undefined as unknown as number }))).toBe('0 m');
  });
});

describe('followStatusText', () => {
  it('dit chaque phase avec le nom', () => {
    expect(followStatusText(state({ phase: 'requesting' }))).toBe('Rejoindre Lucie…');
    expect(followStatusText(state({ phase: 'dropped' }))).toBe('Lucie est loin devant');
    expect(followStatusText(state({ phase: 'leader-paused' }))).toBe('Lucie a fait une pause');
    expect(followStatusText(state())).toBe('Suit Lucie · +15 m · 3 s');
  });
});

describe('followEndText', () => {
  it("se tait quand c'est le coureur qui arrête, et explique tout le reste", () => {
    expect(followEndText('manual', 'Lucie')).toBe('');
    for (const r of ['denied', 'refused', 'unavailable', 'left', 'leader-lost', 'leader-stopped', 'self-stopped', 'offline'] as const) {
      expect(followEndText(r, 'Lucie').length).toBeGreaterThan(10);
    }
    expect(followEndText('denied', 'Lucie')).toContain('Lucie');
  });
});
