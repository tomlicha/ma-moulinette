import { browserStore, type KeyValueStore } from '../../infra/storage/key-value-store';
import type { SyncJournal } from '../../infra/sync/journal';
import type { EditorBlock } from './blocks';

export interface SavedBlock {
  id: string;
  name: string;
  blocks: EditorBlock[];
  updatedAt: number;
}

const KEY = 'mamoulinette.blocks';

/** Contenu d'un bloc tel qu'il est synchronisé avec le compte (src/infra/sync/protocol.ts). */
export const blockBody = (b: SavedBlock) => ({ name: b.name, blocks: b.blocks });

/**
 * « Mes blocs » : blocs mis de côté par l'utilisateur depuis l'éditeur, gardés dans son navigateur et synchronisés
 * avec son compte (comme les séances).
 */
export class BlockLibrary {
  constructor(
    private readonly store: KeyValueStore = browserStore(),
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly journal?: Pick<SyncJournal, 'record'>,
  ) {}

  list(): SavedBlock[] {
    try {
      const raw = JSON.parse(this.store.getItem(KEY) ?? '[]') as unknown;
      if (!Array.isArray(raw)) return [];
      return (raw as SavedBlock[])
        .filter((b) => b && typeof b.id === 'string' && typeof b.name === 'string' && Array.isArray(b.blocks) && b.blocks.length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /** Ajoute le bloc (ou les blocs) à la bibliothèque ; une erreur de quota remonte : l'éditeur doit dire que c'est raté. */
  save(name: string, blocks: EditorBlock[], now = Date.now()): SavedBlock {
    const saved: SavedBlock = { id: this.newId(), name: name.trim() || 'Bloc sans nom', blocks: structuredClone(blocks), updatedAt: now };
    this.store.setItem(KEY, JSON.stringify([saved, ...this.list()]));
    this.journal?.record('block', saved.id, blockBody(saved), saved.updatedAt);
    return saved;
  }

  remove(id: string, now = Date.now()) {
    this.store.setItem(KEY, JSON.stringify(this.list().filter((b) => b.id !== id)));
    this.journal?.record('block', id, null, now);
  }

  /** Blocs venus du compte (remplacés ou ajoutés) et supprimés ailleurs ; rien n'est noté dans le journal. */
  merge(put: SavedBlock[], drop: string[]) {
    const gone = new Set([...drop, ...put.map((b) => b.id)]);
    this.store.setItem(KEY, JSON.stringify([...put, ...this.list().filter((b) => !gone.has(b.id))]));
  }

  /** Efface tous les blocs, sans rien noter (changement de compte). */
  clear() {
    this.store.setItem(KEY, '[]');
  }
}
