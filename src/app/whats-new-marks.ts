import { laterMark } from '../domain/whatsnew/later-mark';
import type { SyncSource } from '../infra/sync/client';
import type { SyncJournal } from '../infra/sync/journal';
import type { SyncItem, SyncTextSetting } from '../infra/sync/protocol';
import type { KeyValueStore } from '../shared/util/key-value-store';
import { TypedEmitter } from '../shared/util/typed-emitter';

/** `announced` : la plus récente entrée présentée dans la carte. `read` : la plus récente acquittée. */
export type Mark = 'announced' | 'read';

const SYNC_ID: Record<Mark, SyncTextSetting> = { announced: 'whatsnew-announced', read: 'whatsnew-read' };
const MARKS = Object.keys(SYNC_ID) as Mark[];

/**
 * Les repères de lecture des nouveautés (docs/design/nouveautes.md) : gardés sur l'appareil, et synchronisés avec le
 * compte pour que lire sur l'ordinateur évite de revoir sur l'iPhone. Une seule responsabilité : retenir ces deux
 * repères et les relier à la synchronisation ; quand montrer quoi, c'est `WhatsNew`.
 *
 * Un repère ne fait qu'**augmenter** (les ids de nouveautés commencent par leur date). Or la fusion du serveur garde
 * « la modification la plus récente » selon l'horloge de l'appareil : un appareil resté hors ligne pourrait renvoyer
 * une vieille valeur et faire reculer le compte. D'où deux règles : à la réception on garde le plus grand des deux ;
 * si le nôtre dépasse celui du compte, on le renvoie (horodatage neuf, il l'emporte). Le serveur n'a rien à savoir.
 */
export class WhatsNewMarks extends TypedEmitter<{ changed: [] }> implements SyncSource {
  readonly kind = 'setting' as const;

  /** Clés de stockage : elles ne changent pas, les valeurs déjà gardées sur les appareils en dépendent. */
  static readonly KEYS: Record<Mark | 'visited', string> = {
    announced: 'mamoulinette.whatsnew.announced',
    read: 'mamoulinette.whatsnew.read',
    visited: 'mamoulinette.whatsnew.visited',
  };

  constructor(
    private readonly store: KeyValueStore,
    private readonly journal: Pick<SyncJournal, 'record' | 'stamp'>,
  ) {
    super();
  }

  /** Le repère, ou `undefined` s'il n'a jamais été posé (nouvelle installation, stockage effacé). */
  get(mark: Mark): string | undefined {
    return this.read(WhatsNewMarks.KEYS[mark]) ?? undefined;
  }

  /** Aucun repère n'est posé. */
  get empty(): boolean {
    return MARKS.every((m) => this.get(m) === undefined);
  }

  /**
   * Monte le repère à `id` s'il est plus récent que le sien. Rend vrai s'il a changé. Le changement est noté pour la
   * synchronisation avec le compte.
   */
  raise(mark: Mark, id: string): boolean {
    const current = this.get(mark);
    if (laterMark(current, id) === current) return false;
    this.write(WhatsNewMarks.KEYS[mark], id);
    this.journal.record('setting', SYNC_ID[mark], id);
    this.emit('changed');
    return true;
  }

  /** Date de la dernière visite sur cet appareil (ms) : elle ne suit pas le compte. */
  visitedAt(): number | undefined {
    const n = Number(this.read(WhatsNewMarks.KEYS.visited));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  setVisitedAt(ms: number): void {
    this.write(WhatsNewMarks.KEYS.visited, String(ms));
  }

  all(): SyncItem[] {
    return MARKS.flatMap((m): SyncItem[] => {
      const v = this.get(m);
      // Sans version (posé avant la connexion) : il cède devant la date de celui du compte, puis `apply` garde le plus grand.
      return v === undefined ? [] : [{ kind: 'setting', id: SYNC_ID[m], body: v, updatedAt: this.journal.stamp('setting', SYNC_ID[m]) ?? 0 }];
    });
  }

  apply(items: SyncItem[]): void {
    let changed = false;
    for (const i of items) {
      const mark = MARKS.find((m) => SYNC_ID[m] === i.id);
      if (!mark || typeof i.body !== 'string') continue;
      const mine = this.get(mark);
      const best = laterMark(mine, i.body)!;
      if (best !== mine) {
        this.write(WhatsNewMarks.KEYS[mark], best);
        changed = true;
      } else if (mine !== i.body) {
        // Le compte est en retard sur nous : notre valeur repart avec un horodatage neuf.
        this.journal.record('setting', i.id, mine);
      }
    }
    if (changed) this.emit('changed');
  }

  clear(): void {
    for (const key of Object.values(WhatsNewMarks.KEYS)) this.write(key, undefined);
    this.emit('changed');
  }

  private read(key: string): string | null {
    try {
      return this.store.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string | undefined): void {
    try {
      if (value === undefined) this.store.removeItem(key);
      else this.store.setItem(key, value);
    } catch {
      // stockage bloqué : le repère vaut pour la session seulement
    }
  }
}
