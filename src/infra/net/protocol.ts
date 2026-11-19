/**
 * Protocole temps réel, messages binaires (petit-boutiste). Les messages fréquents (positions) sont binaires ; les rares
 * (arrivées, départs, noms) passeront en JSON.
 *
 * Client → serveur, `STATE` (19 octets), 4 fois par seconde :
 *   0 u8  type          1 u8  drapeaux     2 u16 route        4 u16 route suivante (0xFFFF : aucune)
 *   6 u32 abscisse (cm)  10 u32 instant (ms, horloge de l'émetteur)
 *   14 u16 vitesse (cm/s) 16 u16 puissance (W) 18 u8 cadence (tr/min)
 *
 * Serveur → client, `SNAPSHOT` : 0 u8 type, 1 u8 nombre, puis pour chaque coureur u16 numéro dans la salle et les
 * 18 octets d'état qui suivent le type de `STATE` (20 octets par coureur).
 *
 * Les routes sont désignées par leur rang dans le réseau : les deux bouts doivent avoir le même réseau, ce que vérifie
 * `networkSignature` à la connexion. Pas de fréquence cardiaque : c'est une donnée de santé, elle ne quitte pas l'appareil.
 */
import type { RoadNetwork } from '../../domain/course/network';
import type { NetPosition } from '../../domain/course/track';

export const PROTOCOL_VERSION = 1;

/**
 * Gestion d'intérêt : au-delà de `INTEREST_K + 1` coureurs, la salle n'envoie à chacun que ses `INTEREST_K` plus proches
 * voisins, dans un rayon de `INTEREST_RANGE_M`. Le trafic d'un client ne grandit plus avec la salle (voir docs/design/salle.md).
 * Le rayon est celui de l'encart des coureurs proches : tout ce qu'il peut montrer arrive.
 */
export const INTEREST_K = 32;
export const INTEREST_RANGE_M = 1500;

export const MSG_STATE = 0x01;
export const MSG_SNAPSHOT = 0x81;

export const STATE_BYTES = 19;
const BODY_BYTES = STATE_BYTES - 1;
const SNAPSHOT_ENTRY_BYTES = 2 + BODY_BYTES;
/** Au plus 255 coureurs par instantané (le nombre tient sur un octet). */
export const SNAPSHOT_MAX = 255;

const NO_EDGE = 0xffff;
const F_FORWARD = 1;
const F_NEXT = 2;
const F_NEXT_FORWARD = 4;
const F_RIDING = 8;

export interface RiderState {
  pos: NetPosition;
  /** Instant d'émission, horloge de l'émetteur, en ms (ramené sur 32 bits). */
  tMs: number;
  speedMs: number;
  powerW: number;
  cadenceRpm: number;
  /** Faux quand la sortie est arrêtée : le coureur reste affiché, immobile. */
  riding: boolean;
}

export interface SnapshotEntry {
  /** Numéro du coureur dans la salle, attribué par le serveur. */
  slot: number;
  state: RiderState;
}

/** Empreinte du réseau (FNV-1a 32 bits des routes et de leurs longueurs au mètre) : deux clients qui l'ont égale se comprennent. */
export function networkSignature(network: RoadNetwork): number {
  let h = 0x811c9dc5;
  for (const e of network.edges.values()) {
    for (const c of `${e.id}:${Math.round(e.lengthM)};`) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

const clampInt = (x: number, max: number) => Math.min(max, Math.max(0, Math.round(Number.isFinite(x) ? x : 0)));

/** Traduction entre identifiants de route et rangs sur deux octets, pour un réseau donné. */
export class StateCodec {
  private readonly ids: string[];
  private readonly index = new Map<string, number>();

  constructor(network: RoadNetwork) {
    this.ids = [...network.edges.keys()];
    if (this.ids.length >= NO_EDGE) throw new Error('réseau trop grand pour le protocole');
    this.ids.forEach((id, i) => this.index.set(id, i));
  }

  /** Message `STATE` du coureur local. */
  encodeState(s: RiderState): ArrayBuffer {
    const buf = new ArrayBuffer(STATE_BYTES);
    const v = new DataView(buf);
    v.setUint8(0, MSG_STATE);
    this.writeBody(v, 1, s);
    return buf;
  }

  /** Lit un message `STATE` ; `undefined` s'il est mal formé ou désigne une route inconnue. */
  decodeState(buf: ArrayBuffer): RiderState | undefined {
    if (buf.byteLength !== STATE_BYTES) return undefined;
    const v = new DataView(buf);
    if (v.getUint8(0) !== MSG_STATE) return undefined;
    return this.readBody(v, 1);
  }

  /** Instantané des coureurs d'une salle. Au-delà de `SNAPSHOT_MAX` coureurs, il faut plusieurs messages. */
  encodeSnapshot(entries: readonly SnapshotEntry[]): ArrayBuffer {
    if (entries.length > SNAPSHOT_MAX) throw new Error(`instantané limité à ${SNAPSHOT_MAX} coureurs`);
    const buf = new ArrayBuffer(2 + entries.length * SNAPSHOT_ENTRY_BYTES);
    const v = new DataView(buf);
    v.setUint8(0, MSG_SNAPSHOT);
    v.setUint8(1, entries.length);
    entries.forEach((e, i) => {
      const at = 2 + i * SNAPSHOT_ENTRY_BYTES;
      v.setUint16(at, e.slot, true);
      this.writeBody(v, at + 2, e.state);
    });
    return buf;
  }

  /** Lit un instantané ; les coureurs illisibles (route inconnue) sont ignorés, un message tronqué est rejeté. */
  decodeSnapshot(buf: ArrayBuffer): SnapshotEntry[] | undefined {
    if (buf.byteLength < 2) return undefined;
    const v = new DataView(buf);
    if (v.getUint8(0) !== MSG_SNAPSHOT) return undefined;
    const n = v.getUint8(1);
    if (buf.byteLength !== 2 + n * SNAPSHOT_ENTRY_BYTES) return undefined;
    const out: SnapshotEntry[] = [];
    for (let i = 0; i < n; i++) {
      const at = 2 + i * SNAPSHOT_ENTRY_BYTES;
      const state = this.readBody(v, at + 2);
      if (state) out.push({ slot: v.getUint16(at, true), state });
    }
    return out;
  }

  /** Recopie les 18 octets d'état d'un message `STATE`, sans le relire : ce que fait le serveur pour relayer. */
  static bodyOf(state: ArrayBuffer): Uint8Array {
    return new Uint8Array(state, 1, BODY_BYTES);
  }

  private writeBody(v: DataView, at: number, s: RiderState) {
    const edge = this.index.get(s.pos.edgeId);
    if (edge === undefined) throw new Error(`route inconnue : ${s.pos.edgeId}`);
    const next = s.pos.next ? this.index.get(s.pos.next.edgeId) : undefined;
    const flags =
      (s.pos.forward ? F_FORWARD : 0) |
      (next !== undefined ? F_NEXT : 0) |
      (next !== undefined && s.pos.next!.forward ? F_NEXT_FORWARD : 0) |
      (s.riding ? F_RIDING : 0);
    v.setUint8(at, flags);
    v.setUint16(at + 1, edge, true);
    v.setUint16(at + 3, next ?? NO_EDGE, true);
    v.setUint32(at + 5, clampInt(s.pos.s * 100, 0xffffffff), true);
    v.setUint32(at + 9, s.tMs >>> 0, true);
    v.setUint16(at + 13, clampInt(s.speedMs * 100, 0xffff), true);
    v.setUint16(at + 15, clampInt(s.powerW, 0xffff), true);
    v.setUint8(at + 17, clampInt(s.cadenceRpm, 0xff));
  }

  private readBody(v: DataView, at: number): RiderState | undefined {
    const flags = v.getUint8(at);
    const edgeId = this.ids[v.getUint16(at + 1, true)];
    if (edgeId === undefined) return undefined;
    const nextIndex = v.getUint16(at + 3, true);
    const nextId = flags & F_NEXT ? this.ids[nextIndex] : undefined;
    const pos: NetPosition = { edgeId, forward: !!(flags & F_FORWARD), s: v.getUint32(at + 5, true) / 100 };
    if (nextId !== undefined) pos.next = { edgeId: nextId, forward: !!(flags & F_NEXT_FORWARD) };
    return {
      pos,
      tMs: v.getUint32(at + 9, true),
      speedMs: v.getUint16(at + 13, true) / 100,
      powerW: v.getUint16(at + 15, true),
      cadenceRpm: v.getUint8(at + 17),
      riding: !!(flags & F_RIDING),
    };
  }
}
