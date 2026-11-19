import { browserStore, type KeyValueStore } from '../storage/key-value-store';
import { checkItem, keyOf, type SyncItem, type SyncKind, type SyncResponse } from './protocol';

interface JournalState {
  /** Compte dont les données sont sur cet appareil ; `null` : jamais synchronisé. */
  owner: string | null;
  /** Dernière révision reçue du serveur. */
  rev: number;
  /** Version (`updatedAt`) de chaque élément tel qu'il est sur l'appareil. */
  known: Record<string, number>;
  /** Modifications faites sur l'appareil, pas encore confirmées par le serveur ; une par élément, la dernière. */
  outbox: Record<string, SyncItem>;
}

const KEY = 'mamoulinette.sync';

const empty = (owner: string | null = null): JournalState => ({ owner, rev: 0, known: {}, outbox: {} });

/**
 * Journal de synchronisation de l'appareil : ce qui reste à envoyer au compte, et la version de chaque élément.
 * Il note les modifications même sans compte : à la connexion, elles partent avec le reste.
 * Gardé dans le navigateur, à côté des données elles-mêmes ; pur et sans réseau (le réseau : src/infra/sync/client.ts).
 */
export class SyncJournal {
  private s: JournalState;
  /** Appelé après chaque modification notée : le client programme un envoi. */
  onRecord?: () => void;

  constructor(
    private readonly store: KeyValueStore = browserStore(),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.s = this.load();
  }

  get owner(): string | null {
    return this.s.owner;
  }

  get rev(): number {
    return this.s.rev;
  }

  /** Version de l'élément sur l'appareil, s'il en a une. */
  stamp(kind: SyncKind, id: string): number | undefined {
    return this.s.known[keyOf({ kind, id })];
  }

  /** Une modification faite sur l'appareil (`body: null` : suppression). Ignorée si le serveur la refuserait. */
  record(kind: SyncKind, id: string, body: unknown, updatedAt = this.now()): void {
    const item = checkItem({ kind, id, body, updatedAt });
    if (!item) return;
    const key = keyOf(item);
    this.s.known[key] = updatedAt;
    this.s.outbox[key] = item;
    this.save();
    this.onRecord?.();
  }

  /** Modifications à envoyer, `max` au plus. */
  pending(max = Infinity): SyncItem[] {
    return Object.values(this.s.outbox).slice(0, max);
  }

  /**
   * Première synchronisation de cet appareil : ses données rejoignent le compte (celles qui existaient avant le compte
   * comprises). La fusion garde, élément par élément, la version la plus récente.
   */
  adopt(owner: string, local: SyncItem[]): void {
    for (const raw of local) {
      const item = checkItem(raw);
      if (!item) continue;
      const key = keyOf(item);
      if (this.s.outbox[key]) continue;
      this.s.outbox[key] = item;
      this.s.known[key] = item.updatedAt;
    }
    this.s.owner = owner;
    this.s.rev = 0;
    this.save();
  }

  /** Un autre compte prend l'appareil : on repart de rien (l'appelant vide les données locales). */
  reset(owner: string): void {
    this.s = empty(owner);
    this.save();
  }

  /**
   * Réponse du serveur à l'envoi de `sent` : retire de la file ce qui est confirmé et rend les éléments à appliquer sur
   * l'appareil (venus d'ailleurs, ou une version du serveur plus récente que la nôtre).
   */
  settle(sent: SyncItem[], res: SyncResponse): SyncItem[] {
    // Envoyées : confirmées, ou refusées pour de bon (`res.rejected`), elles quittent la file. Une modification faite
    // pendant l'envoi a une autre version : elle reste à envoyer.
    for (const s of sent) {
      const key = keyOf(s);
      if (this.s.outbox[key]?.updatedAt === s.updatedAt) delete this.s.outbox[key];
    }

    const apply: SyncItem[] = [];
    for (const raw of res.items) {
      const item = checkItem(raw);
      if (!item) continue;
      const key = keyOf(item);
      const pend = this.s.outbox[key];
      if (pend && pend.updatedAt > item.updatedAt) continue; // la nôtre, plus récente, partira au prochain envoi
      if (pend) delete this.s.outbox[key];
      const known = this.s.known[key];
      if (known !== undefined && known >= item.updatedAt) continue;
      this.s.known[key] = item.updatedAt;
      apply.push(item);
    }
    this.s.rev = res.rev;
    this.save();
    return apply;
  }

  private load(): JournalState {
    try {
      const raw = JSON.parse(this.store.getItem(KEY) ?? 'null') as Partial<JournalState> | null;
      if (!raw || typeof raw !== 'object') return empty();
      return {
        owner: typeof raw.owner === 'string' ? raw.owner : null,
        rev: Number.isSafeInteger(raw.rev) && raw.rev! >= 0 ? raw.rev! : 0,
        known: raw.known && typeof raw.known === 'object' ? raw.known : {},
        outbox: raw.outbox && typeof raw.outbox === 'object' ? raw.outbox : {},
      };
    } catch {
      return empty();
    }
  }

  private save() {
    try {
      this.store.setItem(KEY, JSON.stringify(this.s));
    } catch {
      // quota : le journal vit en mémoire jusqu'au prochain lancement ; la synchronisation suivante le complétera
    }
  }
}
