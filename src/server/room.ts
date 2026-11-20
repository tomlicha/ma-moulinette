/**
 * Salle temps réel : les coureurs d'un même monde. Le serveur ne simule rien : chacun calcule sa propre position,
 * la salle vérifie que l'état reçu est plausible, garde le dernier de chaque coureur et renvoie à tous un instantané
 * 4 fois par seconde. Logique pure, sans dépendance à Cloudflare : le Durable Object (`worker/world-room.ts`) ne fait
 * que brancher les WebSocket dessus.
 *
 * Messages texte (JSON), serveur → client :
 *   { type: 'welcome', slot, members: [{ slot, name }] }   à la connexion ; `slot` est le numéro du nouveau venu
 *   { type: 'join', slot, name }                            un coureur arrive
 *   { type: 'leave', slot }                                  un coureur part
 */
import { CLOSE_NAME_PENDING, CLOSE_OUTDATED, CLOSE_REPLACED, CLOSE_SIGNED_OUT } from '../shared/protocol/close-codes';
import type { RoadNetwork } from '../domain/course/network';
import { INTEREST_K, INTEREST_RANGE_M, MSG_SNAPSHOT, SNAPSHOT_MAX, StateCodec, STATE_BYTES } from '../infra/net/protocol';
import { parseClientMessage, type ClientGroupMessage, type FollowEndReason, type JoinableBy, type OnlineRider, type ServerGroupMessage } from '../infra/net/group-protocol';
import { FollowBook } from './follow-book';
import { MAX_FRIENDS } from '../shared/protocol/friends';
import { Groups, type GroupSnapshot, type GroupStore } from './groups';

/** Cadence des instantanés, en ms. */
export const TICK_MS = 250;
/** Un état plus vieux n'est plus relayé, en ms : le coureur ne donne plus de nouvelles. */
export const STATE_TTL_MS = 10_000;
/** Écart minimal entre deux états acceptés d'un même coureur, en ms : au-delà de 10 Hz, le surplus est ignoré. */
const MIN_INTERVAL_MS = 90;
/** Écart minimal entre deux « qui est en ligne » d'un même coureur, en ms : la réponse coûte un parcours de la salle. */
const MIN_WHO_INTERVAL_MS = 1000;
/** Coureurs montrés par une réponse « qui est en ligne ». */
export const WHO_MAX = 30;
/** Vitesse au-delà de laquelle un état est rejeté, en m/s (126 km/h : une descente de col, pas plus). */
export const MAX_SPEED_MS = 35;

export { CLOSE_NAME_PENDING, CLOSE_OUTDATED, CLOSE_REPLACED, CLOSE_SIGNED_OUT };

const ENTRY_BYTES = 2 + STATE_BYTES - 1;
/** Côté d'une case de l'index spatial, en m : de quoi trouver les voisins sans parcourir toute la salle. */
const CELL_M = 150;

export interface RoomOptions {
  /** Voisins envoyés à chacun au-delà de `interestK + 1` coureurs. `Infinity` : tout le monde voit tout le monde. */
  interestK?: number;
  /** Rayon de voisinage, en m. */
  rangeM?: number;
  /** Où ranger les groupes pour qu'ils survivent à un redémarrage du Durable Object (voir `restoreGroups`). */
  groupStore?: GroupStore;
  /** Où ranger les listes d'amis envoyées par les coureurs, pour qu'elles survivent à un redémarrage (voir `restoreFriends`). */
  friendStore?: FriendListStore;
  /**
   * `userId` est-il parmi les amis de `ofUserId` (ceux que celui-ci a ajoutés) ? Sert au réglage « Qui peut me rejoindre : mes
   * amis ». Par défaut, les listes envoyées par les coureurs (`friends`) ; une autre règle ne sert qu'aux tests.
   */
  areFriends?: (userId: string, ofUserId: string) => boolean;
}

/** Où la salle range la liste d'amis de chaque coureur connecté (le stockage du Durable Object). */
export interface FriendListStore {
  save(userId: string, ids: readonly string[]): void;
  remove(userId: string): void;
}

export interface Connection {
  send(data: string | ArrayBuffer): void;
  close(code: number, reason: string): void;
  /** Garde le coureur avec la connexion, pour le retrouver au réveil de la salle (voir `Room.restore`). */
  save?(member: Member): void;
}

export interface Member {
  slot: number;
  userId: string;
  name: string;
  /** Qui peut le rejoindre ; absent : tout le monde. */
  joinable?: JoinableBy;
}

interface Live extends Member {
  conn: Connection;
  /** Qui peut le rejoindre. Par défaut tout le monde, tant que la liste d'amis n'existe pas (docs/design/groupe.md). */
  joinable: JoinableBy;
  /** Dernière demande « qui est en ligne », en ms : on n'en traite pas plus d'une par `MIN_WHO_INTERVAL_MS`. */
  lastWhoAt?: number;
  /** Les 18 octets d'état du dernier message accepté, prêts à relayer. */
  body?: Uint8Array;
  at: number;
  /** Position dans le monde du dernier état accepté, en m (index spatial). */
  x: number;
  z: number;
}

interface Near {
  m: Live;
  d2: number;
}

/** Minuscules sans accents : « Léa » se trouve en tapant « lea ». */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export class Room {
  private readonly members = new Map<number, Live>();
  private readonly codec: StateCodec;
  /**
   * Prochain numéro à essayer. Les numéros ne sont pas réattribués aussitôt libérés : la fermeture tardive d'une
   * ancienne connexion ne doit pas faire partir le coureur qui aurait repris son numéro.
   */
  private nextSlot = 1;
  /** Messages rejetés (mal formés ou invraisemblables) : à surveiller. */
  rejected = 0;
  private readonly interestK: number;
  private readonly rangeM: number;
  private readonly follows = new FollowBook();
  private readonly groups: Groups;
  private readonly areFriends: (userId: string, ofUserId: string) => boolean;
  /** Les amis de chaque compte connecté (ceux qu'il a ajoutés), tels qu'il les a envoyés : il est le seul à en décider. */
  private readonly friendsOf = new Map<string, Set<string>>();
  private readonly friendStore: FriendListStore | undefined;

  constructor(
    private readonly network: RoadNetwork,
    private readonly now: () => number = () => Date.now(),
    opts: RoomOptions = {},
  ) {
    this.codec = new StateCodec(network);
    this.interestK = opts.interestK ?? INTEREST_K;
    this.rangeM = opts.rangeM ?? INTEREST_RANGE_M;
    this.friendStore = opts.friendStore;
    this.areFriends = opts.areFriends ?? ((userId, ofUserId) => this.friendsOf.get(ofUserId)?.has(userId) ?? false);
    this.groups = new Groups(opts.groupStore);
  }

  get size(): number {
    return this.members.size;
  }

  /** Vrai si un coureur a envoyé un état récemment : tant que c'est le cas, il faut des instantanés. */
  get active(): boolean {
    const t = this.now();
    for (const m of this.members.values()) if (m.body && t - m.at < STATE_TTL_MS) return true;
    return false;
  }

  /**
   * Fait entrer un coureur et renvoie son numéro. Un compte déjà présent (autre onglet, autre appareil) est remplacé :
   * l'ancienne connexion est fermée.
   */
  join(user: { id: string; name: string }, conn: Connection): number {
    for (const m of [...this.members.values()]) {
      if (m.userId === user.id) {
        this.leave(m.slot);
        m.conn.close(CLOSE_REPLACED, 'connecté ailleurs');
      }
    }
    const slot = this.freeSlot();
    this.members.set(slot, { slot, userId: user.id, name: user.name, conn, joinable: 'all', at: 0, x: 0, z: 0 });
    const members = [...this.members.values()].map(({ slot, name }) => ({ slot, name }));
    conn.send(JSON.stringify({ type: 'welcome', slot, members }));
    this.broadcast(JSON.stringify({ type: 'join', slot, name: user.name }), slot);
    return slot;
  }

  /** Reprend un coureur déjà connecté, sans rien annoncer : réveil du Durable Object après une mise en veille. */
  restore(member: Member, conn: Connection): void {
    this.members.set(member.slot, { ...member, conn, joinable: member.joinable ?? 'all', at: 0, x: 0, z: 0 });
    this.nextSlot = Math.max(this.nextSlot, member.slot + 1);
  }

  /**
   * Reprend les groupes rangés avant un redémarrage (à appeler après `restore` des coureurs : un coureur dont la connexion
   * n'a pas survécu est retiré de son groupe).
   */
  restoreGroups(snapshots: readonly GroupSnapshot[], next: number): void {
    this.groups.restore(snapshots, next, (slot) => this.members.has(slot));
  }

  /** Reprend les listes d'amis rangées avant un redémarrage (celles des comptes encore connectés). */
  restoreFriends(entries: readonly (readonly [string, readonly string[]])[]): void {
    const online = new Set([...this.members.values()].map((m) => m.userId));
    for (const [userId, ids] of entries) {
      if (online.has(userId)) this.friendsOf.set(userId, new Set(ids));
      else this.friendStore?.remove(userId);
    }
  }

  leave(slot: number): void {
    const gone = this.members.get(slot);
    if (!this.members.delete(slot)) return;
    // La liste d'amis part avec la dernière connexion du compte : à sa reconnexion, la page la renvoie.
    if (gone && ![...this.members.values()].some((m) => m.userId === gone.userId) && this.friendsOf.delete(gone.userId)) this.friendStore?.remove(gone.userId);
    const { wasFollowing, followers } = this.follows.drop(slot);
    this.leaveGroup(slot);
    this.broadcast(JSON.stringify({ type: 'leave', slot }));
    if (wasFollowing !== undefined) this.tell(wasFollowing, { type: 'unfollowedBy', slot });
    for (const f of followers) this.tell(f, { type: 'followEnd', reason: 'left' });
  }

  /** Message reçu d'un coureur : un état binaire, ou un petit ordre de suivi en texte. */
  receive(slot: number, data: string | ArrayBuffer): void {
    const m = this.members.get(slot);
    if (!m) return;
    if (typeof data === 'string') return this.receiveText(m, data);
    const t = this.now();
    if (m.body && t - m.at < MIN_INTERVAL_MS) return;
    const state = this.codec.decodeState(data);
    const edge = state && this.network.edges.get(state.pos.edgeId);
    if (!state || !edge || state.speedMs > MAX_SPEED_MS || state.pos.s > edge.lengthM + 1) {
      this.rejected++;
      return;
    }
    m.body = new Uint8Array(StateCodec.bodyOf(data)); // copie : le tampon reçu peut être réutilisé
    m.at = t;
    const p = edge.pointAt(state.pos.s);
    m.x = p.x;
    m.z = p.z;
  }

  private receiveText(m: Live, text: string): void {
    const msg = parseClientMessage(text);
    if (!msg) {
      this.rejected++;
      return;
    }
    this.handle(m, msg);
  }

  private handle(m: Live, msg: ClientGroupMessage): void {
    switch (msg.type) {
      case 'joinable':
        m.joinable = msg.who;
        m.conn.save?.({ slot: m.slot, userId: m.userId, name: m.name, joinable: m.joinable });
        return;
      case 'follow':
        return this.startFollow(m, msg.slot);
      case 'unfollow': {
        const leader = this.follows.unfollow(m.slot);
        if (leader !== undefined) this.tell(leader, { type: 'unfollowedBy', slot: m.slot });
        return;
      }
      case 'who':
        return this.who(m, msg.q);
      case 'time':
        this.tell(m.slot, { type: 'time', c: msg.c, s: this.now() });
        return;
      case 'friends': {
        // Ses propres amis : il est seul à en décider, et ils ne servent qu'à lui (ordre de la liste, qui peut le rejoindre).
        const ids = msg.ids.filter((id) => id !== m.userId).slice(0, MAX_FRIENDS);
        this.friendsOf.set(m.userId, new Set(ids));
        this.friendStore?.save(m.userId, ids);
        return;
      }
      case 'groupCreate':
        return this.afterJoin(m, this.groups.create({ slot: m.slot, name: m.name }, msg.workout, msg.courseId, msg.startInS, this.now(), { ftpW: msg.ftpW, massKg: msg.massKg }), undefined);
      case 'groupJoin':
        return this.afterJoin(m, this.groups.join({ slot: m.slot, name: m.name }, msg.id), msg.id);
      case 'groupLeave':
        return this.leaveGroup(m.slot);
      case 'groupRoute': {
        // Le créateur du groupe choisit la route : tous les membres, lui compris, l'appliquent à son retour.
        const id = this.groups.route(m.slot, msg.leg, msg.index);
        if (id === undefined) return;
        for (const member of this.groups.members(id)) this.tell(member.slot, { type: 'groupRoute', leg: msg.leg, index: msg.index });
        return;
      }
      case 'refuse':
        // Seul le coureur suivi peut renvoyer son suiveur.
        if (this.follows.leader(msg.slot) !== m.slot) return;
        this.follows.unfollow(msg.slot);
        this.tell(msg.slot, { type: 'followEnd', reason: 'refused' });
        this.tell(m.slot, { type: 'unfollowedBy', slot: msg.slot });
        return;
    }
  }

  /** Le coureur `f` veut rejoindre et suivre `targetSlot` : accepté s'il roule et si son réglage le permet. */
  private startFollow(f: Live, targetSlot: number): void {
    const target = this.members.get(targetSlot);
    const state = target?.body ? this.codec.decodeBody(target.body) : undefined;
    const fresh = target !== undefined && this.now() - target.at < STATE_TTL_MS;
    if (!target || target === f || !state || !state.riding || !fresh) return this.refuseFollow(f, 'unavailable');
    if (target.joinable === 'none' || (target.joinable === 'friends' && !this.areFriends(f.userId, target.userId))) {
      return this.refuseFollow(f, 'denied');
    }
    const before = this.follows.follow(f.slot, target.slot);
    if (before !== undefined && before !== target.slot) this.tell(before, { type: 'unfollowedBy', slot: f.slot });
    this.tell(f.slot, { type: 'followStart', slot: target.slot, name: target.name, pos: state.pos });
    if (before !== target.slot) this.tell(target.slot, { type: 'followedBy', slot: f.slot, name: f.name });
  }

  /** Qui est en ligne et quels groupes existent : les coureurs en sortie d'abord, filtrés par le nom, sans soi ni ceux qui se cachent. */
  private who(m: Live, query: string): void {
    const t = this.now();
    if (m.lastWhoAt !== undefined && t - m.lastWhoAt < MIN_WHO_INTERVAL_MS) return;
    m.lastWhoAt = t;
    const q = fold(query.trim());
    const mine = this.friendsOf.get(m.userId);
    const found: OnlineRider[] = [];
    for (const o of this.members.values()) {
      if (o === m || o.joinable === 'none' || (q && !fold(o.name).includes(q))) continue;
      const state = o.body && t - o.at < STATE_TTL_MS ? this.codec.decodeBody(o.body) : undefined;
      const open = o.joinable === 'all' || (o.joinable === 'friends' && this.areFriends(m.userId, o.userId));
      found.push({ slot: o.slot, name: o.name, riding: !!state?.riding, uid: o.userId, friend: mine?.has(o.userId) ?? false, open });
    }
    // Mes amis d'abord, puis ceux qui roulent, puis par nom.
    found.sort((a, b) => Number(b.friend) - Number(a.friend) || Number(b.riding) - Number(a.riding) || a.name.localeCompare(b.name, 'fr'));
    this.expireGroups();
    this.tell(m.slot, { type: 'who', riders: found.slice(0, WHO_MAX), groups: this.groups.summaries(), total: found.length });
  }

  /** Ce qui suit une création ou une arrivée dans un groupe : l'état au nouveau venu, la liste des membres à tous les autres. */
  private afterJoin(m: Live, joined: ReturnType<Groups['join']>, requestedId: string | undefined): void {
    if (!joined.ok) {
      this.tell(m.slot, { type: 'groupClosed', id: requestedId ?? 'none', reason: joined.reason });
      return;
    }
    const { group, left } = joined;
    if (left !== undefined) this.announceMembers(left);
    this.tell(m.slot, { type: 'groupState', group });
    this.announceMembers(group.id, m.slot);
  }

  private announceMembers(id: string, except?: number): void {
    const members = this.groups.members(id);
    const leader = this.groups.leader(id);
    if (leader === undefined) return;
    for (const g of members) if (g.slot !== except) this.tell(g.slot, { type: 'groupMembers', id, leader, members });
  }

  private leaveGroup(slot: number): void {
    const left = this.groups.leave(slot);
    if (left?.members) this.announceMembers(left.id);
  }

  /** Les groupes dont la séance est finie depuis longtemps se ferment ; leurs membres l'apprennent. */
  private expireGroups(): void {
    for (const g of this.groups.expire(this.now())) for (const slot of g.members) this.tell(slot, { type: 'groupClosed', id: g.id, reason: 'over' });
  }

  private refuseFollow(f: Live, reason: FollowEndReason): void {
    const before = this.follows.unfollow(f.slot);
    if (before !== undefined) this.tell(before, { type: 'unfollowedBy', slot: f.slot });
    this.tell(f.slot, { type: 'followEnd', reason });
  }

  private tell(slot: number, msg: ServerGroupMessage): void {
    this.members.get(slot)?.conn.send(JSON.stringify(msg));
  }

  /**
   * Envoie les instantanés. Petite salle : le même à tous, leur propre état compris. Grande salle : à chacun ses voisins
   * les plus proches, lui exclu (voir `INTEREST_K`).
   */
  tick(): void {
    this.expireGroups();
    const t = this.now();
    const fresh = [...this.members.values()].filter((m) => m.body && t - m.at < STATE_TTL_MS);
    if (fresh.length === 0) return;
    if (fresh.length <= this.interestK + 1) return this.tickAll(fresh);
    this.tickInterest(fresh);
  }

  private tickAll(fresh: Live[]): void {
    for (let i = 0; i < fresh.length; i += SNAPSHOT_MAX) this.broadcast(this.encode(fresh.slice(i, i + SNAPSHOT_MAX)));
  }

  private encode(part: readonly Live[]): ArrayBuffer {
    const buf = new Uint8Array(2 + part.length * ENTRY_BYTES);
    const view = new DataView(buf.buffer);
    buf[0] = MSG_SNAPSHOT;
    buf[1] = part.length;
    part.forEach((m, k) => {
      view.setUint16(2 + k * ENTRY_BYTES, m.slot, true);
      buf.set(m.body!, 4 + k * ENTRY_BYTES);
    });
    return buf.buffer;
  }

  /**
   * Index en cases de `CELL_M` ; pour chaque destinataire, on élargit les anneaux de cases jusqu'à avoir `interestK`
   * voisins sûrs (tout point à moins de `r × CELL_M` tient dans les `r` anneaux autour de sa case), dans la limite de
   * `rangeM`, et on garde les `interestK` plus proches.
   */
  private tickInterest(fresh: Live[]): void {
    const grid = new Map<number, Live[]>();
    const key = (cx: number, cz: number) => (cx & 0xffff) * 0x10000 + (cz & 0xffff);
    for (const m of fresh) {
      const k = key(Math.floor(m.x / CELL_M), Math.floor(m.z / CELL_M));
      const cell = grid.get(k);
      if (cell) cell.push(m);
      else grid.set(k, [m]);
    }
    const K = this.interestK;
    const maxRing = Math.ceil(this.rangeM / CELL_M);
    const range2 = this.rangeM * this.rangeM;
    for (const r of fresh) {
      const cx = Math.floor(r.x / CELL_M);
      const cz = Math.floor(r.z / CELL_M);
      const best: Near[] = []; // trié par distance croissante, au plus K
      const consider = (list: Live[] | undefined) => {
        if (!list) return;
        for (const m of list) {
          if (m === r) continue;
          const d2 = (m.x - r.x) ** 2 + (m.z - r.z) ** 2;
          if (d2 > range2 || (best.length >= K && d2 >= best[K - 1]!.d2)) continue;
          let i = Math.min(best.length, K - 1);
          if (best.length < K) best.push({ m, d2 });
          else best[K - 1] = { m, d2 };
          while (i > 0 && best[i - 1]!.d2 > d2) {
            best[i] = best[i - 1]!;
            i--;
          }
          best[i] = { m, d2 };
        }
      };
      for (let ring = 0; ring <= maxRing; ring++) {
        if (ring === 0) consider(grid.get(key(cx, cz)));
        else {
          for (let dx = -ring; dx <= ring; dx++) {
            consider(grid.get(key(cx + dx, cz - ring)));
            consider(grid.get(key(cx + dx, cz + ring)));
          }
          for (let dz = -ring + 1; dz <= ring - 1; dz++) {
            consider(grid.get(key(cx - ring, cz + dz)));
            consider(grid.get(key(cx + ring, cz + dz)));
          }
        }
        // Tous les points à moins de `ring × CELL_M` sont déjà vus : si K voisins sont plus proches, les suivants ne comptent pas.
        if (best.length >= K && best[K - 1]!.d2 <= (ring * CELL_M) ** 2) break;
      }
      if (best.length === 0) continue;
      try {
        r.conn.send(this.encode(best.map((n) => n.m)));
      } catch {
        // Connexion déjà fermée : son départ arrivera par l'événement de fermeture.
      }
    }
  }

  private broadcast(data: string | ArrayBuffer, except?: number): void {
    for (const m of this.members.values()) {
      if (m.slot === except) continue;
      try {
        m.conn.send(data);
      } catch {
        // Connexion déjà fermée : son départ arrivera par l'événement de fermeture.
      }
    }
  }

  private freeSlot(): number {
    for (let i = 0; i < 0xfffe; i++) {
      const s = ((this.nextSlot - 1 + i) % 0xfffe) + 1;
      if (!this.members.has(s)) {
        this.nextSlot = s + 1;
        return s;
      }
    }
    throw new Error('salle pleine');
  }
}
