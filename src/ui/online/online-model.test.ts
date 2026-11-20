import { describe, expect, it } from 'vitest';
import type { GroupSummary } from '../../infra/net/group-protocol';
import { countdownText, durationText, groupLine, groupPill, leftText, ridersTitle, riderStatus } from './online-model';

const g = (over: Partial<GroupSummary> = {}): GroupSummary => ({ id: 'g1', name: 'Séance de Léa', workoutName: 'Sweet spot', courseId: 'col', t0: 10_000, durationS: 1500, count: 3, ...over });

describe('countdownText', () => {
  it('minutes et secondes au-delà d’une minute, secondes en dessous, « maintenant » passé l’heure', () => {
    expect(countdownText(185_000)).toBe('3:05');
    expect(countdownText(60_000)).toBe('1:00');
    expect(countdownText(59_100)).toBe('1:00'); // 59,1 s arrondi à 60 s
    expect(countdownText(45_000)).toBe('45 s');
    expect(countdownText(400)).toBe('1 s');
    expect(countdownText(0)).toBe('maintenant');
    expect(countdownText(-5000)).toBe('maintenant');
  });
});

describe('durationText', () => {
  it('en minutes, puis en heures', () => {
    expect(durationText(1500)).toBe('25 min');
    expect(durationText(10)).toBe('1 min');
    expect(durationText(3900)).toBe('1 h 05');
  });
});

describe('groupLine', () => {
  it('dit le départ à venir ou le temps déjà roulé', () => {
    expect(groupLine(g(), 10_000 - 245_000, 'Col des Érables')).toBe('Sweet spot · Col des Érables · 25 min · départ dans 4:05 · 3 coureurs');
    expect(groupLine(g({ count: 1 }), 10_000 + 600_000, 'Col des Érables')).toBe('Sweet spot · Col des Érables · 25 min · en cours depuis 10 min · 1 coureur');
  });
});

describe('la liste « En ligne »', () => {
  it('dit si le coureur roule, et combien la liste ne montre pas', () => {
    expect(riderStatus({ riding: true })).toBe('en sortie');
    expect(riderStatus({ riding: false })).toBe('en ligne');
    expect(ridersTitle(0, 0)).toBe('En ligne');
    expect(ridersTitle(12, 12)).toBe('En ligne · 12');
    expect(ridersTitle(30, 128)).toBe('En ligne · 30 sur 128');
  });
});

describe('la pastille et les raisons de départ', () => {
  it('compte les coureurs du groupe', () => {
    expect(groupPill(1)).toBe('Séance de groupe · 1 coureur');
    expect(groupPill(6)).toBe('Séance de groupe · 6 coureurs');
  });
  it('explique tout sauf ce que le coureur a voulu', () => {
    expect(leftText('manual', 'x')).toBe('');
    for (const r of ['self-stopped', 'offline', 'over', 'full', 'unknown', 'empty', 'invalid', 'missed', 'busy']) expect(leftText(r, 'Séance de Léa').length).toBeGreaterThan(10);
    expect(leftText('over', 'Séance de Léa')).toContain('Séance de Léa');
  });
});
