import { describe, expect, it, vi } from 'vitest';
import { defaultBlock, type EditorBlock } from '../domain/workout/blocks';
import { WorkoutLibrary } from '../domain/workout/library';
import { SAMPLE_WORKOUTS } from '../domain/workout/samples';
import type { KeyValueStore } from '../shared/util/key-value-store';
import { EditorSession, type EditorDraft } from './editor-session';

function memory(): KeyValueStore & { data: Map<string, string>; failWrites: boolean } {
  const data = new Map<string, string>();
  const store = {
    data,
    failWrites: false,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (store.failWrites) throw new Error('QuotaExceeded');
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
  return store;
}

function setup(over: { confirm?: boolean } = {}) {
  const store = memory();
  let n = 0;
  const library = new WorkoutLibrary(store, () => `w${++n}`);
  const log = vi.fn();
  const confirmDiscard = vi.fn(() => over.confirm ?? true);
  const session = new EditorSession({ library, ftp: () => 200, log, confirmDiscard });
  const events: string[] = [];
  session.on('opened', () => events.push('opened'));
  session.on('changed', () => events.push('changed'));
  session.on('focused', (k) => events.push(`focused:${k}`));
  return { session, library, store, log, confirmDiscard, events };
}

const blocks = (): EditorBlock[] => [defaultBlock('warmup'), defaultBlock('intervals'), defaultBlock('cooldown')];
const draft = (over: Partial<EditorDraft> = {}): EditorDraft => ({ name: 'Ma séance', description: '', blocks: blocks(), ...over });
const sample = SAMPLE_WORKOUTS[0]!;

describe('EditorSession', () => {
  it('part sans séance ouverte', () => {
    const { session } = setup();
    expect(session.draft).toBeUndefined();
    expect(session.isDirty()).toBe(false);
    expect(session.keyOf()).toBeUndefined();
  });

  describe('ouvrir', () => {
    it('ouvre une séance, sélectionne le deuxième bloc et vide l\'historique', () => {
      const { session, events } = setup();
      session.open(draft());
      expect(session.draft?.name).toBe('Ma séance');
      expect(session.selected).toBe(1);
      expect(session.history.canUndo).toBe(false);
      expect(events).toEqual(['opened']);
    });

    it('une séance ouverte telle quelle n\'est pas « modifiée » ; importée ou nouvelle, elle l\'est', () => {
      const { session } = setup();
      session.open(draft());
      expect(session.isDirty()).toBe(false);
      session.open(draft(), true);
      expect(session.isDirty()).toBe(true);
    });

    it('un modèle est en lecture seule, jamais « modifié »', () => {
      const { session } = setup();
      session.openKey(`sample:${sample.id}`);
      expect(session.draft?.readOnly).toBe(true);
      expect(session.isDirty()).toBe(false);
      expect(session.keyOf()).toBe(`sample:${sample.id}`);
    });

    it('demande avant d\'abandonner des modifications, et les garde si on refuse', () => {
      const { session, confirmDiscard, events } = setup({ confirm: false });
      session.open(draft({ name: 'A' }), true);
      events.length = 0;
      expect(session.open(draft({ name: 'B' }))).toBe(false);
      expect(confirmDiscard).toHaveBeenCalledTimes(1);
      expect(session.draft?.name).toBe('A');
      expect(events).toEqual([]);
    });

    it('ne demande rien quand rien n\'est modifié', () => {
      const { session, confirmDiscard } = setup();
      session.open(draft());
      session.open(draft({ name: 'B' }));
      expect(confirmDiscard).not.toHaveBeenCalled();
    });

    it('rouvre une séance enregistrée par sa clé, et ignore une clé inconnue', () => {
      const { session, library } = setup();
      const saved = library.save({ name: 'Ancienne', blocks: blocks() });
      expect(session.openKey(`lib:${saved.id}`)).toBe(true);
      expect(session.draft).toMatchObject({ id: saved.id, name: 'Ancienne' });
      expect(session.openKey('lib:inconnue')).toBe(false);
      expect(session.openKey('sample:inconnu')).toBe(false);
    });

    it('à défaut, ouvre la première séance du coureur, sinon le premier modèle', () => {
      const a = setup();
      a.session.openFallback(false);
      expect(a.session.keyOf()).toBe(`sample:${sample.id}`);
      const b = setup();
      const saved = b.library.save({ name: 'La mienne', blocks: blocks() });
      b.session.openFallback(false);
      expect(b.session.keyOf()).toBe(`lib:${saved.id}`);
    });

    it('publie la séance choisie seulement si on le demande', () => {
      const { session, events, library } = setup();
      const saved = library.save({ name: 'La mienne', blocks: blocks() });
      session.openFallback(false);
      expect(events.filter((e) => e.startsWith('focused'))).toEqual([]);
      session.openFallback(true);
      expect(events).toContain(`focused:lib:${saved.id}`);
    });

    it('dupliquer un modèle donne une séance à soi, modifiée, indépendante', () => {
      const { session } = setup();
      session.openKey(`sample:${sample.id}`);
      const original = session.draft!;
      session.duplicateModel();
      expect(session.draft).not.toBe(original);
      expect(session.draft?.readOnly).toBeUndefined();
      expect(session.draft?.name).toBe(`${original.name} (copie)`);
      expect(session.isDirty()).toBe(true);
      expect(session.draft?.blocks).toEqual(original.blocks);
      expect(session.draft?.blocks).not.toBe(original.blocks);
    });

    it('dupliquer ne fait rien sur une séance normale', () => {
      const { session, events } = setup();
      session.open(draft());
      events.length = 0;
      session.duplicateModel();
      expect(events).toEqual([]);
    });
  });

  describe('importer un fichier', () => {
    it('refuse un fichier illisible', () => {
      const { session } = setup();
      const r = session.importFile('x.zwo', 'pas du XML');
      expect(r.kind).toBe('error');
      expect(session.draft).toBeUndefined();
    });

    it('ouvre une séance valide, comme brouillon à enregistrer', () => {
      const { session } = setup();
      const r = session.importFile(sample.fileName, sample.text);
      expect(r.kind).toBe('opened');
      expect(session.draft?.blocks.length).toBeGreaterThan(0);
      expect(session.isDirty()).toBe(true);
      expect(session.draft?.readOnly).toBeUndefined();
    });

    it('est abandonné si le coureur garde ses modifications', () => {
      const { session } = setup({ confirm: false });
      session.open(draft({ name: 'En cours' }), true);
      expect(session.importFile(sample.fileName, sample.text)).toEqual({ kind: 'cancelled' });
      expect(session.draft?.name).toBe('En cours');
    });
  });

  describe('suivre le choix de l\'application', () => {
    it('garde la séance ouverte si elle est modifiée, s\'il n\'y a pas de choix ou si c\'est la même', () => {
      const { session, library } = setup();
      const saved = library.save({ name: 'A', blocks: blocks() });
      session.openKey(`lib:${saved.id}`);
      expect(session.syncTo(`lib:${saved.id}`)).toBe(true);
      expect(session.syncTo('')).toBe(true);
      session.commit((bs) => bs.slice(1));
      expect(session.syncTo(`sample:${sample.id}`)).toBe(true); // modifiée : on n'y touche pas
      expect(session.draft?.id).toBe(saved.id);
    });

    it('suit un autre choix quand rien n\'est modifié', () => {
      const { session, library } = setup();
      const saved = library.save({ name: 'A', blocks: blocks() });
      session.openKey(`lib:${saved.id}`);
      expect(session.syncTo(`sample:${sample.id}`)).toBe(false);
      expect(session.keyOf()).toBe(`sample:${sample.id}`);
    });

    it('sans rien d\'ouvert, ouvre le choix, ou à défaut le premier disponible', () => {
      const a = setup();
      expect(a.session.syncTo(`sample:${sample.id}`)).toBe(false);
      expect(a.session.keyOf()).toBe(`sample:${sample.id}`);
      const b = setup();
      b.session.syncTo('lib:disparue');
      expect(b.session.draft).toBeDefined();
    });
  });

  describe('modifier', () => {
    it('une modification s\'inscrit dans l\'historique, redessine et rend la séance « modifiée »', () => {
      const { session, library, events } = setup();
      const saved = library.save({ name: 'A', blocks: blocks() });
      session.openKey(`lib:${saved.id}`);
      events.length = 0;
      session.commit((bs) => bs.slice(0, 2));
      expect(session.draft?.blocks).toHaveLength(2);
      expect(session.history.canUndo).toBe(true);
      expect(session.isDirty()).toBe(true);
      expect(events).toEqual(['changed']);
    });

    it('un modèle ne se modifie pas', () => {
      const { session, events } = setup();
      session.openKey(`sample:${sample.id}`);
      const before = structuredClone(session.draft!.blocks);
      events.length = 0;
      session.commit((bs) => bs.slice(1));
      session.undo();
      session.redo();
      expect(session.draft?.blocks).toEqual(before);
      expect(events).toEqual([]);
    });

    it('la sélection reste dans les bornes', () => {
      const { session } = setup();
      session.open(draft());
      session.commit((bs) => bs, 99);
      expect(session.selected).toBe(2);
      session.select(-5);
      expect(session.selected).toBe(0);
      session.select(99);
      expect(session.selected).toBe(2);
    });

    it('choisir un bloc sans bloc ne fait rien', () => {
      const { session, events } = setup();
      session.open(draft({ blocks: [] }));
      events.length = 0;
      session.select(0);
      expect(events).toEqual([]);
    });

    it('modifier le bloc sélectionné laisse les autres intacts', () => {
      const { session } = setup();
      session.open(draft());
      const others = [session.draft!.blocks[0], session.draft!.blocks[2]];
      session.updateSelected((b) => ({ ...b, type: 'steady', durationS: 60, power: 0.5 }) as EditorBlock);
      expect(session.draft!.blocks[1]).toMatchObject({ type: 'steady', power: 0.5 });
      expect([session.draft!.blocks[0], session.draft!.blocks[2]]).toEqual(others);
    });

    it('échange le bloc sélectionné avec son voisin et le garde sélectionné', () => {
      const { session } = setup();
      session.open(draft());
      const [a, b, c] = session.draft!.blocks;
      session.select(0);
      session.moveSelected(1);
      expect(session.draft!.blocks).toEqual([b, a, c]);
      expect(session.selected).toBe(1);
      session.moveSelected(-1);
      expect(session.draft!.blocks).toEqual([a, b, c]);
      expect(session.selected).toBe(0);
    });

    it('ne déplace pas un bloc au-delà des extrémités', () => {
      const { session, events } = setup();
      session.open(draft());
      session.select(0);
      events.length = 0;
      session.moveSelected(-1);
      session.select(2);
      events.length = 0;
      session.moveSelected(1);
      expect(events).toEqual([]);
      expect(session.history.canUndo).toBe(false);
    });

    it('duplique le bloc sélectionné juste après lui et sélectionne la copie', () => {
      const { session } = setup();
      session.open(draft());
      session.select(1);
      const original = session.draft!.blocks[1]!;
      session.duplicateSelected();
      expect(session.draft!.blocks).toHaveLength(4);
      expect(session.draft!.blocks[2]).toEqual(original);
      expect(session.draft!.blocks[2]).not.toBe(original);
      expect(session.selected).toBe(2);
    });

    it('sépare un bloc d\'intervalles en blocs individuels', () => {
      const { session } = setup();
      session.open(draft());
      session.select(1); // le bloc d'intervalles : 5 répétitions
      session.splitSelected();
      expect(session.draft!.blocks.length).toBeGreaterThan(3);
      expect(session.draft!.blocks.some((b) => b.type === 'intervals' && b.repeat === 5)).toBe(false);
      session.undo();
      expect(session.draft!.blocks).toHaveLength(3);
    });

    it('séparer un bloc qui n\'est pas des intervalles ne fait rien', () => {
      const { session, events } = setup();
      session.open(draft());
      session.select(0);
      events.length = 0;
      session.splitSelected();
      expect(events).toEqual([]);
    });

    it('supprime le bloc sélectionné ; le suivant prend sa place, et le dernier est remplacé par le précédent', () => {
      const { session } = setup();
      session.open(draft());
      const [a, b, c] = session.draft!.blocks;
      session.select(1);
      session.deleteSelected();
      expect(session.draft!.blocks).toEqual([a, c]);
      expect(session.selected).toBe(1);
      session.deleteSelected();
      expect(session.draft!.blocks).toEqual([a]);
      expect(session.selected).toBe(0);
      session.deleteSelected();
      expect(session.draft!.blocks).toEqual([]);
      session.deleteSelected(); // plus rien à supprimer
      expect(session.draft!.blocks).toEqual([]);
      session.undo();
      expect(session.draft!.blocks).toEqual([a]);
      void b;
    });

    it('règle une valeur sur une copie, en une entrée d\'historique, et termine la frappe', () => {
      const { session, events } = setup();
      session.open(draft());
      const before = session.draft!.blocks;
      session.typing = true;
      events.length = 0;
      session.commitSet((v) => {
        (session.draft!.blocks[0] as { durationS: number }).durationS = v;
      }, 123);
      expect((session.draft!.blocks[0] as { durationS: number }).durationS).toBe(123);
      expect(session.draft!.blocks).not.toBe(before); // copie : l'historique garde l'ancien état intact
      expect((before[0] as { durationS: number }).durationS).toBe(600);
      expect(session.typing).toBe(false);
      expect(events).toEqual(['changed']);
      session.undo();
      expect((session.draft!.blocks[0] as { durationS: number }).durationS).toBe(600);
    });

    it('règler une valeur sur un modèle ne fait rien', () => {
      const { session, events } = setup();
      session.openKey(`sample:${sample.id}`);
      events.length = 0;
      session.commitSet(() => {
        throw new Error('ne doit pas être appelé');
      }, 1);
      expect(events).toEqual([]);
    });

    it('ajoute des copies de blocs à la position donnée et sélectionne le premier', () => {
      const { session } = setup();
      session.open(draft());
      const added = [defaultBlock('steady'), defaultBlock('ramp')];
      session.addBlocks(added, 1);
      expect(session.draft!.blocks).toHaveLength(5);
      expect(session.draft!.blocks[1]).toEqual(added[0]);
      expect(session.draft!.blocks[1]).not.toBe(added[0]);
      expect(session.selected).toBe(1);
      session.undo(); // une seule entrée d'historique pour tout l'ajout
      expect(session.draft!.blocks).toHaveLength(3);
    });

    it('déplace un bloc et le sélectionne, en une seule entrée d\'historique', () => {
      const { session } = setup();
      session.open(draft());
      const [a, b, c] = session.draft!.blocks;
      session.moveBlock(0, 2);
      expect(session.draft!.blocks).toEqual([b, c, a]);
      expect(session.selected).toBe(2);
      session.undo();
      expect(session.draft!.blocks).toEqual([a, b, c]);
    });

    it('déplacer un bloc à sa propre place ne change rien', () => {
      const { session, events } = setup();
      session.open(draft());
      events.length = 0;
      session.moveBlock(1, 1);
      expect(events).toEqual([]);
      expect(session.history.canUndo).toBe(false);
    });

    it('annule et rétablit, sans rien faire quand il n\'y a rien à annuler ou rétablir', () => {
      const { session, events } = setup();
      session.open(draft());
      events.length = 0;
      session.undo();
      session.redo();
      expect(events).toEqual([]);
      session.commit((bs) => bs.slice(1));
      session.undo();
      expect(session.draft!.blocks).toHaveLength(3);
      session.redo();
      expect(session.draft!.blocks).toHaveLength(2);
    });

    it('ramène la sélection dans les bornes après une annulation', () => {
      const { session } = setup();
      session.open(draft());
      session.commit((bs) => [...bs, defaultBlock('steady')], 3);
      expect(session.selected).toBe(3);
      session.undo();
      expect(session.selected).toBe(2);
    });
  });

  describe('enregistrer', () => {
    it('enregistre dans la bibliothèque : identifiant, nom nettoyé, plus « modifiée »', () => {
      const { session, library } = setup();
      session.open(draft({ name: '  Sweet spot  ', description: '  ' }), true);
      const r = session.save();
      expect(r?.kind).toBe('saved');
      expect(session.draft?.id).toBeDefined();
      expect(session.draft?.name).toBe('Sweet spot');
      expect(session.isDirty()).toBe(false);
      expect(session.baseStats).toBeDefined();
      expect(session.baseZones).toBeDefined();
      expect(library.list()).toHaveLength(1);
      expect(library.list()[0]!.description).toBeUndefined();
    });

    it('une séance sans nom en reçoit un', () => {
      const { session } = setup();
      session.open(draft({ name: '   ' }), true);
      const r = session.save();
      expect(r).toMatchObject({ kind: 'saved', workout: { name: 'Séance sans nom' } });
    });

    it('enregistrer deux fois met la même séance à jour', () => {
      const { session, library } = setup();
      session.open(draft(), true);
      session.save();
      session.commit((bs) => bs.slice(1));
      session.save();
      expect(library.list()).toHaveLength(1);
      expect(library.list()[0]!.blocks).toHaveLength(2);
    });

    it('refuse un modèle et des blocs invalides', () => {
      const { session, library } = setup();
      session.openKey(`sample:${sample.id}`);
      expect(session.save()).toBeUndefined();
      session.open(draft({ blocks: [] }), true);
      expect(session.save()).toBeUndefined();
      expect(library.list()).toHaveLength(0);
    });

    it('un stockage plein est un échec annoncé, pas une exception', () => {
      const { session, store } = setup();
      session.open(draft(), true);
      store.failWrites = true;
      expect(session.save()).toEqual({ kind: 'failed', message: 'QuotaExceeded' });
      expect(session.draft?.id).toBeUndefined();
      expect(session.isDirty()).toBe(true);
    });
  });

  describe('supprimer', () => {
    it('supprimer la séance ouverte la ferme', () => {
      const { session, library } = setup();
      session.open(draft(), true);
      session.save();
      const saved = library.list()[0]!;
      expect(session.removeSaved(saved)).toBe(true);
      expect(session.draft).toBeUndefined();
      expect(library.list()).toHaveLength(0);
      expect(session.isDirty()).toBe(false);
    });

    it('supprimer une autre séance laisse la séance ouverte', () => {
      const { session, library } = setup();
      const other = library.save({ name: 'Autre', blocks: blocks() });
      session.open(draft());
      expect(session.removeSaved(other)).toBe(false);
      expect(session.draft).toBeDefined();
    });
  });

  describe('FTP changée', () => {
    it('rouvre un modèle avec la nouvelle FTP, en gardant le bloc sélectionné', () => {
      const { session, events } = setup();
      session.openKey(`sample:${sample.id}`);
      session.select(2);
      events.length = 0;
      expect(session.reopenModel()).toBe(true);
      expect(session.keyOf()).toBe(`sample:${sample.id}`);
      expect(session.selected).toBe(2);
      expect(events).toContain('opened');
    });

    it('ne touche pas à une séance à soi', () => {
      const { session, events } = setup();
      session.open(draft());
      events.length = 0;
      expect(session.reopenModel()).toBe(false);
      expect(events).toEqual([]);
    });
  });

  describe('changement venu d\'un autre appareil', () => {
    it('une séance sans modification suit la nouvelle version, en gardant le bloc sélectionné', () => {
      const { session, library } = setup();
      const saved = library.save({ name: 'A', blocks: blocks() });
      session.openKey(`lib:${saved.id}`);
      session.select(2);
      library.save({ id: saved.id, name: 'A renommée', blocks: [...blocks(), defaultBlock('steady')] });
      session.adoptLibraryChange();
      expect(session.draft?.name).toBe('A renommée');
      expect(session.draft?.blocks).toHaveLength(4);
      expect(session.selected).toBe(2);
      expect(session.isDirty()).toBe(false);
    });

    it('supprimée ailleurs, elle laisse la place', () => {
      const { session, library } = setup();
      const saved = library.save({ name: 'A', blocks: blocks() });
      session.openKey(`lib:${saved.id}`);
      library.remove(saved.id);
      session.adoptLibraryChange();
      expect(session.keyOf()).toBe(`sample:${sample.id}`);
    });

    it('un brouillon modifié reste tel quel', () => {
      const { session, library, events } = setup();
      const saved = library.save({ name: 'A', blocks: blocks() });
      session.openKey(`lib:${saved.id}`);
      session.commit((bs) => bs.slice(1));
      library.save({ id: saved.id, name: 'Venue d\'ailleurs', blocks: blocks() });
      events.length = 0;
      session.adoptLibraryChange();
      expect(session.draft?.name).toBe('A');
      expect(events).toEqual([]);
    });

    it('une version identique ne rouvre rien', () => {
      const { session, library, events } = setup();
      const saved = library.save({ name: 'A', blocks: blocks() });
      session.openKey(`lib:${saved.id}`);
      events.length = 0;
      session.adoptLibraryChange();
      expect(events).toEqual([]);
    });
  });
});
