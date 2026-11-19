/**
 * Connexion du joueur à la salle temps réel : envoie son état, reçoit celui des autres et les rend affichables
 * (piste reconstruite, course lissée). Sans DOM ni Three.js : la vue 3D et le HUD lisent `riders()`.
 */
import type { RoadNetwork } from '../../domain/course/network';
import { RemoteTrack } from '../../domain/course/remote-track';
import type { JourneyPoint, NetPosition } from '../../domain/course/track';
import { Interpolator } from './interpolation';
import { networkSignature, PROTOCOL_VERSION, StateCodec } from './protocol';
import { CLOSE_NAME_PENDING, CLOSE_OUTDATED, CLOSE_REPLACED, CLOSE_SIGNED_OUT } from '../../server/room';

export const WORLD_PATH = '/api/world/ws';
/** Cadence d'envoi pendant la sortie, en ms. */
export const SEND_EVERY_MS = 250;
/** Hors sortie, un état « arrêté » de temps en temps suffit à rester visible, en ms. */
export const IDLE_SEND_EVERY_MS = 2000;
/** Un coureur absent des instantanés depuis ce temps disparaît, en ms. */
const FORGET_MS = 5000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

export type WorldStatus =
  | 'offline' // pas encore connecté, ou déconnecté volontairement
  | 'connecting'
  | 'online'
  | 'retrying' // connexion perdue, nouvel essai programmé
  | 'replaced' // le même compte s'est connecté ailleurs
  | 'outdated' // l'application n'a pas la même version que le serveur : recharger la page
  | 'signed-out' // pas de session valide : se connecter avec Strava
  | 'name-pending'; // le coureur doit d'abord valider le nom montré aux autres

export interface LocalState {
  pos: NetPosition;
  speedMs: number;
  powerW: number;
  cadenceRpm: number;
  riding: boolean;
}

export interface RemoteRiderView {
  slot: number;
  name: string;
  /** Distance sur sa piste : sert à l'animation, sans rapport avec la distance du joueur local. */
  d: number;
  point: JourneyPoint;
  gradePct: number;
  speedMs: number;
  cadenceRpm: number;
  powerW: number;
  riding: boolean;
}

interface Remote {
  slot: number;
  name: string;
  track: RemoteTrack;
  interp: Interpolator;
  powerW: number;
  riding: boolean;
  seenAt: number;
}

type SocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  binaryType: BinaryType;
  onopen: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
};

export interface WorldClientOptions {
  /** Adresse de la salle ; par défaut, celle du site courant. */
  url?: string;
  createSocket?: (url: string) => SocketLike;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export class WorldClient {
  onStatus?: (s: WorldStatus) => void;
  /** Arrivées et départs, pour le journal ou une notification. */
  onRoster?: (event: 'join' | 'leave', name: string) => void;

  private readonly codec: StateCodec;
  private readonly remotes = new Map<number, Remote>();
  private readonly names = new Map<number, string>();
  private socket: SocketLike | undefined;
  private selfSlot: number | undefined;
  private status_: WorldStatus = 'offline';
  private attempt = 0;
  private retryTimer: unknown;
  private wanted = false;
  private lastSent = -Infinity;
  private readonly now: () => number;

  constructor(
    readonly network: RoadNetwork,
    private readonly opts: WorldClientOptions = {},
  ) {
    this.codec = new StateCodec(network);
    this.now = opts.now ?? (() => performance.now());
  }

  get status(): WorldStatus {
    return this.status_;
  }

  /** Nombre de coureurs dans la salle, le joueur compris (0 hors connexion). */
  get population(): number {
    return this.status_ === 'online' ? this.names.size : 0;
  }

  /** Se connecte, et se reconnecte tout seul jusqu'à `disconnect()`. */
  connect(): void {
    this.wanted = true;
    if (!this.socket) this.open();
  }

  disconnect(): void {
    this.wanted = false;
    this.clearRetry();
    this.socket?.close(1000, 'fin');
    this.socket = undefined;
    this.reset();
    this.setStatus('offline');
  }

  /**
   * État du joueur local, à appeler à chaque pas de la sortie : l'envoi se limite tout seul à `SEND_EVERY_MS`
   * (`IDLE_SEND_EVERY_MS` à l'arrêt). `force` envoie tout de suite (arrêt de la sortie).
   */
  update(state: LocalState, force = false): void {
    if (this.status_ !== 'online' || !this.socket) return;
    const t = this.now();
    const every = state.riding ? SEND_EVERY_MS : IDLE_SEND_EVERY_MS;
    if (!force && t - this.lastSent < every) return;
    this.lastSent = t;
    this.socket.send(this.codec.encodeState({ ...state, tMs: Math.round(t) }));
  }

  /** Les autres coureurs, à l'instant local `nowMs`, prêts à dessiner. */
  riders(nowMs = this.now()): RemoteRiderView[] {
    const out: RemoteRiderView[] = [];
    for (const r of this.remotes.values()) {
      if (nowMs - r.seenAt > FORGET_MS) {
        this.remotes.delete(r.slot);
        continue;
      }
      const s = r.interp.at(nowMs);
      if (!s || r.track.empty) continue;
      out.push({
        slot: r.slot,
        name: r.name,
        d: s.d,
        point: r.track.pointAt(s.d),
        gradePct: r.track.gradeAt(s.d),
        speedMs: s.stale ? 0 : s.speedMs,
        cadenceRpm: s.stale ? 0 : s.cadenceRpm,
        powerW: r.powerW,
        riding: r.riding && !s.stale,
      });
    }
    return out;
  }

  private open() {
    this.clearRetry();
    this.setStatus(this.attempt ? 'retrying' : 'connecting');
    const q = new URLSearchParams({ v: String(PROTOCOL_VERSION), sig: String(networkSignature(this.network)) });
    const base = this.opts.url ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${WORLD_PATH}`;
    const socket = (this.opts.createSocket ?? ((u) => new WebSocket(u) as SocketLike))(
      `${base}${base.includes('?') ? '&' : '?'}${q}`,
    );
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.onmessage = (ev) => this.onMessage(ev.data as string | ArrayBuffer);
    socket.onclose = (ev) => this.onClose(socket, ev.code);
    socket.onerror = () => {}; // suivi d'une fermeture, traitée là
  }

  private onMessage(data: string | ArrayBuffer) {
    if (typeof data === 'string') return this.onText(data);
    const entries = this.codec.decodeSnapshot(data);
    if (!entries) return;
    const t = this.now();
    for (const { slot, state } of entries) {
      if (slot === this.selfSlot) continue;
      let r = this.remotes.get(slot);
      if (!r) {
        r = {
          slot,
          name: this.names.get(slot) ?? 'Coureur',
          track: new RemoteTrack(this.network),
          interp: new Interpolator(),
          powerW: 0,
          riding: false,
          seenAt: t,
        };
        this.remotes.set(slot, r);
      }
      const obs = r.track.observe(state.pos);
      if (!obs) continue;
      if (obs.reset) r.interp.reset();
      r.interp.push(t, { t: state.tMs, d: obs.d, speedMs: state.riding ? state.speedMs : 0, cadenceRpm: state.cadenceRpm });
      r.powerW = state.powerW;
      r.riding = state.riding;
      r.seenAt = t;
    }
  }

  private onText(text: string) {
    let msg: { type?: string; slot?: number; name?: string; members?: { slot: number; name: string }[] };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === 'welcome' && typeof msg.slot === 'number') {
      this.reset();
      this.selfSlot = msg.slot;
      for (const m of msg.members ?? []) this.names.set(m.slot, m.name);
      this.attempt = 0;
      this.lastSent = -Infinity;
      this.setStatus('online');
    } else if (msg.type === 'join' && typeof msg.slot === 'number' && typeof msg.name === 'string') {
      this.names.set(msg.slot, msg.name);
      const r = this.remotes.get(msg.slot);
      if (r) r.name = msg.name;
      this.onRoster?.('join', msg.name);
    } else if (msg.type === 'leave' && typeof msg.slot === 'number') {
      const name = this.names.get(msg.slot);
      this.names.delete(msg.slot);
      this.remotes.delete(msg.slot);
      if (name) this.onRoster?.('leave', name);
    }
  }

  private onClose(socket: SocketLike, code: number) {
    if (socket !== this.socket) return; // ancienne connexion
    this.socket = undefined;
    this.reset();
    if (code === CLOSE_OUTDATED) return this.setStatus('outdated');
    if (code === CLOSE_REPLACED) return this.setStatus('replaced');
    if (code === CLOSE_SIGNED_OUT) return this.setStatus('signed-out');
    if (code === CLOSE_NAME_PENDING) return this.setStatus('name-pending');
    if (!this.wanted) return this.setStatus('offline');
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt++;
    this.setStatus('retrying');
    this.retryTimer = (this.opts.setTimer ?? setTimeout)(() => this.open(), delay);
  }

  private reset() {
    this.remotes.clear();
    this.names.clear();
    this.selfSlot = undefined;
  }

  private clearRetry() {
    if (this.retryTimer !== undefined) (this.opts.clearTimer ?? ((t) => clearTimeout(t as number)))(this.retryTimer);
    this.retryTimer = undefined;
  }

  private setStatus(s: WorldStatus) {
    if (s === this.status_) return;
    this.status_ = s;
    this.onStatus?.(s);
  }
}
