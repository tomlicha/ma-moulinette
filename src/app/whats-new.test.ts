import { describe, expect, it } from 'vitest';
import type { WhatsNewEntry } from '../domain/whatsnew/entries';
import { SyncJournal } from '../infra/sync/journal';
import type { SyncItem } from '../infra/sync/protocol';
import type { KeyValueStore } from '../shared/util/key-value-store';
import { WhatsNew } from './whats-new';
import { WhatsNewMarks } from './whats-new-marks';

const memory = (): KeyValueStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};
const e = (id: string, extra: Partial<WhatsNewEntry> = {}): WhatsNewEntry => ({ id, kind: 'new', title: id, text: 't', icon: 'route', ...extra });
const ENTRIES = [e('2026-11-17-a'), e('2026-11-18-b', { featured: true }), e('2026-11-20-c')];
const NOW = Date.UTC(2026, 10, 20, 12);

function setup(opts: { existing?: boolean; entries?: WhatsNewEntry[] } = {}) {
  const store = memory();
  const clock = { t: 1000 };
  const journal = new SyncJournal(memory(), () => clock.t++);
  const marks = new WhatsNewMarks(store, journal);
  const wn = new WhatsNew({ marks, entries: opts.entries ?? ENTRIES, now: () => NOW, existingUser: () => opts.existing ?? false });
  return { store, journal, marks, wn };
}

describe('WhatsNew : premier lancement', () => {
  it('installation neuve : rien à annoncer, tout est vu', () => {
    const { wn, marks } = setup();
    wn.start();
    expect(marks.get('announced')).toBe('2026-11-20-c');
    expect(marks.get('read')).toBe('2026-11-20-c');
    expect(wn.pending()).toBeUndefined();
    expect(wn.unread).toBe(false);
  });

  it('utilisateur existant : il voit le récap de tout ce qui est plus récent que le repère de départ', () => {
    const { wn } = setup({ existing: true });
    wn.start();
    expect(wn.pending()?.total).toBe(3);
    expect(wn.unread).toBe(true);
  });

  it('start ne fait rien la deuxième fois, ni si le compte a déjà donné un repère', () => {
    const { wn, marks } = setup();
    marks.raise('announced', '2026-11-18-b');
    wn.start();
    expect(marks.get('announced')).toBe('2026-11-18-b');
    expect(marks.get('read')).toBe('2026-11-18-b');
    expect(wn.pending()?.featured.id).toBe('2026-11-20-c');
  });
});

describe('WhatsNew : gestes', () => {
  it('« C\'est parti » : tout est annoncé et lu', () => {
    const { wn, marks } = setup({ existing: true });
    wn.start();
    wn.acknowledge();
    expect(wn.pending()).toBeUndefined();
    expect(wn.unread).toBe(false);
    expect(marks.get('read')).toBe('2026-11-20-c');
  });

  it('« Tout voir » : la carte ne se rouvre pas, mais le non-lu reste jusqu\'à la lecture', () => {
    const { wn } = setup({ existing: true });
    wn.start();
    wn.announce();
    expect(wn.pending()).toBeUndefined();
    expect(wn.unread).toBe(true);
    wn.acknowledge();
    expect(wn.unread).toBe(false);
  });

  it('une nouveauté publiée plus tard rouvre la carte pour elle seule', () => {
    const entries = [...ENTRIES];
    const { wn } = setup({ entries });
    wn.start();
    expect(wn.pending()).toBeUndefined();
    entries.push(e('2026-11-25-d'));
    expect(wn.pending()?.total).toBe(1);
    expect(wn.pending()?.featured.id).toBe('2026-11-25-d');
    expect(wn.entries.map((x) => x.id)).toEqual(['2026-11-25-d', '2026-11-20-c', '2026-11-18-b', '2026-11-17-a']);
  });

  it('la visite est notée sans toucher aux repères', () => {
    const { wn, marks } = setup();
    expect(wn.visitedAt).toBeUndefined();
    wn.noteVisit();
    expect(wn.visitedAt).toBe(NOW);
    expect(marks.get('announced')).toBeUndefined();
  });

  it('un repère qui change prévient l\'écran (le point orange)', () => {
    const { wn } = setup({ existing: true });
    let n = 0;
    wn.on('changed', () => n++);
    wn.start();
    wn.acknowledge();
    expect(n).toBeGreaterThan(0);
  });
});

describe('WhatsNewMarks : repères qui ne font qu\'augmenter', () => {
  it('raise ne recule jamais', () => {
    const { marks } = setup();
    expect(marks.raise('read', '2026-11-18-b')).toBe(true);
    expect(marks.raise('read', '2026-11-17-a')).toBe(false);
    expect(marks.raise('read', '2026-11-18-b')).toBe(false);
    expect(marks.get('read')).toBe('2026-11-18-b');
  });

  it('chaque changement est noté pour la synchronisation, au bon nom', () => {
    const { marks, journal } = setup();
    marks.raise('announced', '2026-11-18-b');
    expect(journal.pending().map((i) => ({ id: i.id, body: i.body }))).toEqual([{ id: 'whatsnew-announced', body: '2026-11-18-b' }]);
  });

  it('le compte a plus récent : on le prend', () => {
    const { marks, journal } = setup();
    marks.raise('read', '2026-11-17-a');
    const before = journal.pending().length;
    marks.apply([{ kind: 'setting', id: 'whatsnew-read', body: '2026-11-20-c', updatedAt: 5000 }]);
    expect(marks.get('read')).toBe('2026-11-20-c');
    expect(journal.pending()).toHaveLength(before); // rien à renvoyer
  });

  it('le compte est en retard : on garde le nôtre et on le renvoie avec un horodatage neuf', () => {
    const { marks, journal } = setup();
    marks.raise('read', '2026-11-20-c');
    const sent = journal.pending(); // l'envoi part : le journal l'efface à la réponse du serveur
    journal.settle(sent, { rev: 1, more: false, items: [], rejected: [] });
    expect(journal.pending()).toHaveLength(0);
    marks.apply([{ kind: 'setting', id: 'whatsnew-read', body: '2026-11-17-a', updatedAt: 9_999_999 }]);
    expect(marks.get('read')).toBe('2026-11-20-c');
    const again = journal.pending();
    expect(again).toHaveLength(1);
    expect(again[0]?.body).toBe('2026-11-20-c');
  });

  it('ignore les éléments qui ne sont pas les siens (FTP, masse)', () => {
    const { marks } = setup();
    const items: SyncItem[] = [{ kind: 'setting', id: 'ftp', body: 230, updatedAt: 1 }];
    marks.apply(items);
    expect(marks.empty).toBe(true);
  });

  it('all() offre les repères posés (première synchronisation)', () => {
    const { marks } = setup();
    expect(marks.all()).toEqual([]);
    marks.raise('announced', '2026-11-18-b');
    const [item] = marks.all();
    expect(item?.id).toBe('whatsnew-announced');
    expect(item?.body).toBe('2026-11-18-b');
  });

  it('clear() efface tout (un autre compte prend l\'appareil)', () => {
    const { marks } = setup();
    marks.raise('announced', '2026-11-18-b');
    marks.setVisitedAt(123);
    marks.clear();
    expect(marks.empty).toBe(true);
    expect(marks.visitedAt()).toBeUndefined();
  });

  it('un stockage bloqué ne lève rien', () => {
    const blocked: KeyValueStore = {
      getItem: () => {
        throw new Error('bloqué');
      },
      setItem: () => {
        throw new Error('bloqué');
      },
      removeItem: () => {
        throw new Error('bloqué');
      },
    };
    const marks = new WhatsNewMarks(blocked, new SyncJournal(memory()));
    expect(marks.get('read')).toBeUndefined();
    expect(() => marks.raise('read', '2026-11-18-b')).not.toThrow();
  });
});
