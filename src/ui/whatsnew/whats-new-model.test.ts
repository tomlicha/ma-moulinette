import { describe, expect, it } from 'vitest';
import type { WhatsNewEntry } from '../../domain/whatsnew/entries';
import { countLabel, dayLabel, filterEntries, sinceLabel, splitByRead } from './whats-new-model';

const e = (id: string, kind: WhatsNewEntry['kind'] = 'new'): WhatsNewEntry => ({ id, kind, title: id, text: 't', icon: 'route' });
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);

describe('dayLabel', () => {
  it('jour et mois abrégé', () => {
    expect(dayLabel('2026-11-20-accueil')).toEqual({ day: '20', month: 'NOV.' });
    expect(dayLabel('2026-01-05-x')).toEqual({ day: '5', month: 'JANV.' });
    expect(dayLabel('2026-12-31-x')).toEqual({ day: '31', month: 'DÉC.' });
  });
  it('un id sans date : rien', () => {
    expect(dayLabel('sans-date')).toBeUndefined();
  });
});

describe('sinceLabel', () => {
  it('en mots, du plus court au plus long', () => {
    expect(sinceLabel(NOW - 2 * 3600_000, NOW)).toBe("aujourd'hui");
    expect(sinceLabel(NOW - DAY, NOW)).toBe('hier');
    expect(sinceLabel(NOW - 9 * DAY, NOW)).toBe('il y a 9 jours');
    expect(sinceLabel(NOW - 21 * DAY, NOW)).toBe('il y a 3 semaines');
    expect(sinceLabel(NOW - 75 * DAY, NOW)).toBe('il y a 2 mois');
  });
});

describe('listes', () => {
  const list = [e('2026-11-20-c'), e('2026-11-18-b', 'improved'), e('2026-11-17-a')];

  it('countLabel : singulier et pluriel', () => {
    expect(countLabel(1)).toBe('1 nouveauté');
    expect(countLabel(8)).toBe('8 nouveautés');
  });

  it('filterEntries', () => {
    expect(filterEntries(list, 'all')).toHaveLength(3);
    expect(filterEntries(list, 'improved').map((x) => x.id)).toEqual(['2026-11-18-b']);
    expect(filterEntries(list, 'new')).toHaveLength(2);
  });

  it('splitByRead : plus récent que le repère de lecture = non lu, l\'ordre est gardé', () => {
    const { unread, seen } = splitByRead(list, '2026-11-17-a');
    expect(unread.map((x) => x.id)).toEqual(['2026-11-20-c', '2026-11-18-b']);
    expect(seen.map((x) => x.id)).toEqual(['2026-11-17-a']);
  });

  it('splitByRead sans repère : tout est non lu', () => {
    expect(splitByRead(list, undefined).unread).toHaveLength(3);
    expect(splitByRead(list, '2026-11-20-c').unread).toHaveLength(0);
  });
});
