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
import type { RoadNetwork } from '../sim/network';
import { INTEREST_K, INTEREST_RANGE_M, MSG_SNAPSHOT, SNAPSHOT_MAX, StateCodec, STATE_BYTES } from '../net/protocol';

/** Cadence des instantanés, en ms. */
export const TICK_MS = 250;
/** Un état plus vieux n'est plus relayé, en ms : le coureur ne donne plus de nouvelles. */
export const STATE_TTL_MS = 10_000;
/** Écart minimal entre deux états acceptés d'un même coureur, en ms : au-delà de 10 Hz, le surplus est ignoré. */
const MIN_INTERVAL_MS = 90;
/** Vitesse au-delà de laquelle un état est rejeté, en m/s (126 km/h : une descente de col, pas plus). */
export const MAX_SPEED_MS = 35;
/** Code de fermeture quand le même compte se connecte ailleurs. */
export const CLOSE_REPLACED = 4000;
/** Code de fermeture quand le client n'a pas la même version du protocole ou du réseau. */
export const CLOSE_OUTDATED = 4001;
/** Code de fermeture quand le coureur n'a pas encore validé le nom montré aux autres. */
export const CLOSE_NAME_PENDING = 4002;
/** Code de fermeture sans session valide : il faut se connecter. */
export const CLOSE_SIGNED_OUT = 4003;

const ENTRY_BYTES = 2 + STATE_BYTES - 1;
/** Côté d'une case de l'index spatial, en m : de quoi trouver les voisins sans parcourir toute la salle. */
const CELL_M = 150;

export interface RoomOptions {
  /** Voisins envoyés à chacun au-delà de `interestK + 1` coureurs. `Infinity` : tout le monde voit tout le monde. */
  interestK?: number;
  /** Rayon de voisinage, en m. */
  rangeM?: number;
}

export interface Connection {
  send(data: string | ArrayBuffer): void;
  close(code: number, reason: string): void;
}

export interface Member {
  slot: number;
  userId: string;
  name: string;
}

interface Live extends Member {
  conn: Connection;
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

  constructor(
    private readonly network: RoadNetwork,
    private readonly now: () => number = () => Date.now(),
    opts: RoomOptions = {},
  ) {
    this.codec = new StateCodec(network);
    this.interestK = opts.interestK ?? INTEREST_K;
    this.rangeM = opts.rangeM ?? INTEREST_RANGE_M;
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
    this.members.set(slot, { slot, userId: user.id, name: user.name, conn, at: 0, x: 0, z: 0 });
    const members = [...this.members.values()].map(({ slot, name }) => ({ slot, name }));
    conn.send(JSON.stringify({ type: 'welcome', slot, members }));
    this.broadcast(JSON.stringify({ type: 'join', slot, name: user.name }), slot);
    return slot;
  }

  /** Reprend un coureur déjà connecté, sans rien annoncer : réveil du Durable Object après une mise en veille. */
  restore(member: Member, conn: Connection): void {
    this.members.set(member.slot, { ...member, conn, at: 0, x: 0, z: 0 });
    this.nextSlot = Math.max(this.nextSlot, member.slot + 1);
  }

  leave(slot: number): void {
    if (this.members.delete(slot)) this.broadcast(JSON.stringify({ type: 'leave', slot }));
  }

  /** Message reçu d'un coureur. Seuls les états binaires sont attendus ; le reste est ignoré. */
  receive(slot: number, data: string | ArrayBuffer): void {
    const m = this.members.get(slot);
    if (!m || typeof data === 'string') return;
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

  /**
   * Envoie les instantanés. Petite salle : le même à tous, leur propre état compris. Grande salle : à chacun ses voisins
   * les plus proches, lui exclu (voir `INTEREST_K`).
   */
  tick(): void {
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
