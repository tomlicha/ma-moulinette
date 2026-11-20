import { LEGACY_BASELINE, type WhatsNewEntry } from '../domain/whatsnew/entries';
import { entriesAfter, hasUnread, newestId, selectForCard, type Selection } from '../domain/whatsnew/unseen';
import { TypedEmitter } from '../shared/util/typed-emitter';
import type { WhatsNewMarks } from './whats-new-marks';

export interface WhatsNewDeps {
  marks: Pick<WhatsNewMarks, 'get' | 'raise' | 'visitedAt' | 'setVisitedAt' | 'on'>;
  entries: readonly WhatsNewEntry[];
  now: () => number;
  /** L'appareil a déjà servi (réglages ou appareils gardés) : le premier lancement de cette fonction n'est pas une installation neuve. */
  existingUser: () => boolean;
}

/**
 * Les nouveautés vues depuis la dernière visite (docs/design/nouveautes.md) : ce que la carte doit présenter, ce qui reste
 * à lire, et les gestes qui acquittent. Une seule responsabilité : décider à partir des repères et du catalogue. Les
 * repères eux-mêmes et leur synchronisation sont dans `WhatsNewMarks` ; quand ouvrir la carte, dans la composition.
 */
export class WhatsNew extends TypedEmitter<{ changed: [] }> {
  private started = false;

  constructor(private readonly d: WhatsNewDeps) {
    super();
    d.marks.on('changed', () => this.emit('changed'));
  }

  /** Tout le catalogue, la plus récente d'abord (le journal). */
  get entries(): WhatsNewEntry[] {
    return entriesAfter(this.d.entries, undefined);
  }

  /**
   * Pose les repères d'un appareil qui n'en a pas, à appeler une fois la première synchronisation passée (le compte a pu
   * en donner) : installation neuve, rien à annoncer ; utilisateur existant, il verra le récap depuis le repère de départ.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    const { marks } = this.d;
    if (marks.get('announced') === undefined) {
      const base = this.d.existingUser() ? LEGACY_BASELINE : newestId(this.d.entries);
      if (base !== undefined) marks.raise('announced', base);
    }
    // Un compte peut n'avoir donné que le repère de la carte : le non-lu part de lui.
    const announced = marks.get('announced');
    if (marks.get('read') === undefined && announced !== undefined) marks.raise('read', announced);
    this.emit('changed'); // le point orange peut maintenant s'afficher
  }

  /** Ce que la carte présente ; `undefined` : rien de nouveau depuis la dernière visite. */
  pending(): Selection | undefined {
    return selectForCard(this.d.entries, this.d.marks.get('announced'), this.d.now());
  }

  /** Reste-t-il du non-lu (le point orange de l'accueil) ? */
  get unread(): boolean {
    if (!this.started) return false; // avant `start()`, les repères peuvent manquer : pas de faux point orange
    return hasUnread(this.d.entries, this.d.marks.get('read'));
  }

  /** Le repère de lecture : les entrées plus récentes sont non lues. */
  get readMark(): string | undefined {
    return this.d.marks.get('read');
  }

  /** Date (ms) de la dernière visite sur cet appareil. */
  get visitedAt(): number | undefined {
    return this.d.marks.visitedAt();
  }

  /** Une visite de plus : à appeler après avoir lu `pending()` et `visitedAt`. */
  noteVisit(): void {
    this.d.marks.setVisitedAt(this.d.now());
  }

  /** « Tout voir » : la carte a joué son rôle, elle ne se rouvrira pas ; la lecture suit à la fermeture du journal. */
  announce(): void {
    const id = newestId(this.d.entries);
    if (id !== undefined) this.d.marks.raise('announced', id);
  }

  /** Tout est lu : « C'est parti », la croix, « Tout marquer comme vu », fermeture du journal. */
  acknowledge(): void {
    const id = newestId(this.d.entries);
    if (id === undefined) return;
    this.d.marks.raise('announced', id);
    this.d.marks.raise('read', id);
  }
}
