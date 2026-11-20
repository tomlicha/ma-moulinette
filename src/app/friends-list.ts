import type { FriendsResult } from '../infra/net/friends';
import type { Friend } from '../shared/protocol/friends';
import { TypedEmitter } from '../shared/util/typed-emitter';

/** La part du serveur de comptes dont la liste a besoin (et rien de plus : c'est ce qu'un test doit simuler). */
export interface FriendsApi {
  list(): Promise<FriendsResult>;
  add(id: string): Promise<FriendsResult>;
  remove(id: string): Promise<FriendsResult>;
}

/** La part de la salle : elle reçoit la liste, pour mettre les amis en tête et laisser entrer ceux de « mes amis ». */
export interface FriendsWorld {
  setFriends(ids: readonly string[]): void;
}

export type FriendChange = 'ok' | Extract<FriendsResult, { ok: false }>['reason'];

/**
 * Mes amis : les coureurs que j'ai ajoutés depuis la liste « En ligne », rangés avec mon compte (D1) et dits à la salle.
 * L'ajout est à sens unique : l'autre n'est pas prévenu. La liste suit mon geste tout de suite et revient en arrière si le
 * serveur refuse (trop d'amis, compte inconnu, connexion perdue).
 *
 * Événement : `changed` (la liste).
 */
export class FriendsList extends TypedEmitter<{ changed: [friends: readonly Friend[]] }> {
  private current: Friend[] = [];

  constructor(private readonly deps: { api: FriendsApi; world: FriendsWorld }) {
    super();
  }

  get friends(): readonly Friend[] {
    return this.current;
  }

  has(id: string): boolean {
    return this.current.some((f) => f.id === id);
  }

  /** Relit la liste du compte (à la connexion à la salle) et la dit à la salle. Sans compte ou sans serveur, rien ne change. */
  async load(): Promise<void> {
    const r = await this.deps.api.list();
    if (r.ok) this.apply(r.friends);
  }

  /** Ajoute `id` (nommé `name` dans la liste « En ligne ») ; rend ce que le serveur en a dit. */
  async add(id: string, name: string): Promise<FriendChange> {
    if (this.has(id)) return 'ok';
    const before = this.current;
    this.apply([...before, { id, name }]);
    const r = await this.deps.api.add(id);
    if (r.ok) {
      this.apply(r.friends);
      return 'ok';
    }
    this.apply(before);
    return r.reason;
  }

  async remove(id: string): Promise<FriendChange> {
    const before = this.current;
    if (!this.has(id)) return 'ok';
    this.apply(before.filter((f) => f.id !== id));
    const r = await this.deps.api.remove(id);
    if (r.ok) {
      this.apply(r.friends);
      return 'ok';
    }
    this.apply(before);
    return r.reason;
  }

  /** La connexion à la salle est perdue ou le compte déconnecté : la liste n'est plus celle de personne. */
  clear(): void {
    this.apply([]);
  }

  private apply(friends: Friend[]): void {
    const same = friends.length === this.current.length && friends.every((f, i) => f.id === this.current[i]!.id && f.name === this.current[i]!.name);
    this.current = friends;
    this.deps.world.setFriends(friends.map((f) => f.id));
    if (!same) this.emit('changed', friends);
  }
}
