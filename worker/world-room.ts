/**
 * Salle temps réel en Durable Object : un objet par monde, qui branche les WebSocket sur `Room` (src/server/room.ts).
 * API d'hibernation : quand plus personne ne roule, l'objet peut être mis en veille sans couper les connexions ;
 * chaque WebSocket garde son coureur en pièce jointe, pour reconstruire la salle au réveil.
 * Le Worker (`worker/app.ts`) a déjà vérifié la session et la version : il passe le coureur dans les en-têtes.
 */
import { COL_DES_ERABLES } from '../src/domain/course/courses/col-des-erables.ts';
import type { GroupSnapshot, GroupStore } from '../src/server/groups.ts';
import { Room, TICK_MS, type Connection, type FriendListStore, type Member } from '../src/server/room.ts';

/** Ce que ce module utilise des WebSocket de Cloudflare : de quoi le tester sans leurs types. */
export interface CfWebSocket {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

/** Le stockage du Durable Object, pour ce que ce module en utilise. */
export interface DurableObjectStorageLike {
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface DurableObjectStateLike {
  acceptWebSocket(ws: CfWebSocket): void;
  getWebSockets(): CfWebSocket[];
  storage: DurableObjectStorageLike;
  /** Rien d'autre ne s'exécute dans l'objet tant que ceci n'est pas fini : de quoi relire le stockage avant le premier message. */
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

/** Clés du stockage : un groupe par clé, le prochain numéro de groupe, et la liste d'amis de chaque coureur connecté. */
export const GROUP_PREFIX = 'group:';
export const GROUP_NEXT_KEY = 'groups:next';
export const FRIENDS_PREFIX = 'friends:';

declare const WebSocketPair: { new (): { 0: CfWebSocket; 1: CfWebSocket } };

const connectionOf = (ws: CfWebSocket): Connection => ({
  send: (data) => ws.send(data),
  close: (code, reason) => ws.close(code, reason),
  save: (member) => ws.serializeAttachment(member),
});

export class WorldRoom {
  private readonly room: Room;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly ctx: DurableObjectStateLike) {
    // Les groupes sont rangés à chaque changement : sans cela, un redémarrage de l'objet les oublierait alors que les coureurs
    // restent connectés. Les écritures ne sont pas attendues (le stockage les regroupe) ; une écriture ratée n'arrête personne.
    const ignore = () => undefined;
    const store: GroupStore = {
      save: (g, next) => {
        void ctx.storage.put(GROUP_PREFIX + g.id, g).catch(ignore);
        void ctx.storage.put(GROUP_NEXT_KEY, next).catch(ignore);
      },
      remove: (id, next) => {
        void ctx.storage.delete(GROUP_PREFIX + id).catch(ignore);
        void ctx.storage.put(GROUP_NEXT_KEY, next).catch(ignore);
      },
    };
    // La liste d'amis de chaque coureur connecté, envoyée par sa page : rangée de même, pour qu'un redémarrage ne la perde pas
    // (une liste peut dépasser ce que la pièce jointe d'une connexion peut porter).
    const friendStore: FriendListStore = {
      save: (userId, ids) => void ctx.storage.put(FRIENDS_PREFIX + userId, ids).catch(ignore),
      remove: (userId) => void ctx.storage.delete(FRIENDS_PREFIX + userId).catch(ignore),
    };
    this.room = new Room(COL_DES_ERABLES, undefined, { groupStore: store, friendStore });
    for (const ws of ctx.getWebSockets()) {
      const m = ws.deserializeAttachment() as Member | null;
      if (m) this.room.restore(m, connectionOf(ws));
    }
    // Les groupes, relus avant tout message : l'objet est bloqué jusque-là.
    void ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.list<GroupSnapshot>({ prefix: GROUP_PREFIX });
      const next = (await ctx.storage.get<number>(GROUP_NEXT_KEY)) ?? 1;
      this.room.restoreGroups([...stored.values()], next);
      const friends = await ctx.storage.list<string[]>({ prefix: FRIENDS_PREFIX });
      this.room.restoreFriends([...friends].map(([key, ids]) => [key.slice(FRIENDS_PREFIX.length), ids] as const));
    });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('websocket attendu', { status: 426 });
    const userId = req.headers.get('x-mm-user-id');
    const name = decodeURIComponent(req.headers.get('x-mm-user-name') ?? '');
    if (!userId || !name) return new Response('coureur inconnu', { status: 400 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const slot = this.room.join({ id: userId, name }, connectionOf(server));
    server.serializeAttachment({ slot, userId, name } satisfies Member);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  webSocketMessage(ws: CfWebSocket, message: string | ArrayBuffer): void {
    const m = ws.deserializeAttachment() as Member | null;
    if (!m) return;
    this.room.receive(m.slot, message);
    this.ensureTicking();
  }

  webSocketClose(ws: CfWebSocket, code: number, reason: string): void {
    this.drop(ws);
    try {
      ws.close(code, reason);
    } catch {
      // déjà fermée
    }
  }

  webSocketError(ws: CfWebSocket): void {
    this.drop(ws);
  }

  private drop(ws: CfWebSocket) {
    const m = ws.deserializeAttachment() as Member | null;
    if (m) this.room.leave(m.slot);
  }

  /** Instantanés tant que quelqu'un roule ; sans minuterie en cours, l'objet peut se mettre en veille. */
  private ensureTicking() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.room.tick();
      if (!this.room.active) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    }, TICK_MS);
  }
}
