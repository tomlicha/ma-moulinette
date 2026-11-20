import { describe, expect, it } from 'vitest';
import { LEGACY_BASELINE, WHATS_NEW, type WhatsNewEntry } from './entries';
import { MAX_ENTRIES, daysBetween, dateOfId, entriesAfter, hasUnread, laterMark, newestId, selectForCard } from './unseen';

const e = (id: string, extra: Partial<WhatsNewEntry> = {}): WhatsNewEntry => ({ id, kind: 'new', title: id, text: 't', icon: 'route', ...extra });
const NOW = Date.UTC(2026, 10, 20, 12);

describe('catalogue', () => {
  it('ids uniques, datés, triés, de la forme acceptée par la synchronisation', () => {
    const ids = WHATS_NEW.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(dateOfId(id)).toBeDefined();
    }
  });

  it('parle à l\'utilisateur : pas de jargon de développeur (refonte interne, classes, CI…) dans les titres et les textes', () => {
    // Le catalogue ne garde que ce que le cycliste voit ou ressent (docs/design/nouveautes.md, CLAUDE.md).
    const JARGON = /\b(refactor\w*|refonte (interne|du code)|classes?|modules?|main\.ts|composition|CI|lint|dépendances?|typescript|vitest|worker|e2e)\b/i;
    for (const x of WHATS_NEW) expect(`${x.title} ${x.text}`, x.id).not.toMatch(JARGON);
  });

  it('champs complets, une seule vedette, tout est plus récent que le repère des utilisateurs existants', () => {
    for (const x of WHATS_NEW) {
      expect(x.title.trim()).not.toBe('');
      expect(x.text.trim()).not.toBe('');
    }
    expect(WHATS_NEW.filter((x) => x.featured).length).toBeLessThanOrEqual(1);
    expect(WHATS_NEW.every((x) => x.id > LEGACY_BASELINE)).toBe(true);
  });
});

describe('dateOfId', () => {
  it('lit la date au début de l\'id', () => {
    expect(dateOfId('2026-11-18-route')).toBe(Date.UTC(2026, 10, 18));
    expect(dateOfId('2026-11-18')).toBe(Date.UTC(2026, 10, 18));
  });
  it('refuse un id sans date', () => {
    expect(dateOfId('route-arc-en-ciel')).toBeUndefined();
    expect(dateOfId('2026-1-8-x')).toBeUndefined();
  });
});

describe('repères', () => {
  it('laterMark garde le plus récent, ou celui qui existe', () => {
    expect(laterMark('2026-11-17-a', '2026-11-18-b')).toBe('2026-11-18-b');
    expect(laterMark('2026-11-18-b', '2026-11-17-a')).toBe('2026-11-18-b');
    expect(laterMark(undefined, '2026-11-17-a')).toBe('2026-11-17-a');
    expect(laterMark('2026-11-17-a', undefined)).toBe('2026-11-17-a');
    expect(laterMark(undefined, undefined)).toBeUndefined();
  });

  it('newestId : l\'entrée la plus récente, quel que soit l\'ordre', () => {
    expect(newestId([e('2026-11-18-b'), e('2026-11-20-c'), e('2026-11-17-a')])).toBe('2026-11-20-c');
    expect(newestId([])).toBeUndefined();
  });

  it('entriesAfter : plus récent que le repère, la plus récente d\'abord ; sans repère, tout', () => {
    const list = [e('2026-11-17-a'), e('2026-11-18-b'), e('2026-11-20-c')];
    expect(entriesAfter(list, '2026-11-17-a').map((x) => x.id)).toEqual(['2026-11-20-c', '2026-11-18-b']);
    expect(entriesAfter(list, undefined)).toHaveLength(3);
    expect(entriesAfter(list, '2026-11-20-c')).toEqual([]);
    expect(entriesAfter(list, LEGACY_BASELINE)).toHaveLength(3);
  });

  it('hasUnread', () => {
    const list = [e('2026-11-17-a'), e('2026-11-18-b')];
    expect(hasUnread(list, '2026-11-17-a')).toBe(true);
    expect(hasUnread(list, '2026-11-18-b')).toBe(false);
    expect(hasUnread(list, undefined)).toBe(true);
  });
});

describe('selectForCard', () => {
  const list = [e('2026-11-17-a'), e('2026-11-18-b', { featured: true }), e('2026-11-19-c'), e('2026-11-20-d')];

  it('rien de plus récent que le repère : pas de carte', () => {
    expect(selectForCard(list, '2026-11-20-d', NOW)).toBeUndefined();
  });

  it('l\'utilisateur absent récupère tout ce qui a été publié depuis', () => {
    const s = selectForCard(list, '2026-11-16', NOW)!;
    expect(s.total).toBe(4);
    expect(s.featured.id).toBe('2026-11-18-b');
    expect(s.rest.map((x) => x.id)).toEqual(['2026-11-20-d', '2026-11-19-c', '2026-11-17-a']);
  });

  it('seul le plus récent manque : un seul héros, rien dessous', () => {
    const s = selectForCard(list, '2026-11-19-c', NOW)!;
    expect(s.total).toBe(1);
    expect(s.featured.id).toBe('2026-11-20-d');
    expect(s.rest).toEqual([]);
  });

  it('sans vedette, le héros est le plus récent', () => {
    const s = selectForCard([e('2026-11-17-a'), e('2026-11-19-c')], undefined, NOW)!;
    expect(s.featured.id).toBe('2026-11-19-c');
  });

  it('plusieurs vedettes : la plus récente', () => {
    const s = selectForCard([e('2026-11-17-a', { featured: true }), e('2026-11-19-c', { featured: true })], undefined, NOW)!;
    expect(s.featured.id).toBe('2026-11-19-c');
  });

  it('au plus 8 entrées, les plus récentes', () => {
    const many = Array.from({ length: 12 }, (_, i) => e(`2026-11-${String(i + 5).padStart(2, '0')}-x`));
    const s = selectForCard(many, undefined, NOW)!;
    expect(s.total).toBe(MAX_ENTRIES);
    expect(s.featured.id).toBe('2026-11-16-x');
  });

  it('au plus 60 jours : une entrée plus ancienne n\'est pas remontée', () => {
    const old = [e('2026-08-01-vieux'), e('2026-11-18-b')];
    const s = selectForCard(old, undefined, NOW)!;
    expect(s.total).toBe(1);
    expect(s.featured.id).toBe('2026-11-18-b');
    expect(selectForCard([e('2026-08-01-vieux')], undefined, NOW)).toBeUndefined();
  });
});

describe('daysBetween', () => {
  it('jours entiers, jamais négatif', () => {
    expect(daysBetween(Date.UTC(2026, 10, 11, 8), NOW)).toBe(9);
    expect(daysBetween(NOW, NOW - 5)).toBe(0);
  });
});
