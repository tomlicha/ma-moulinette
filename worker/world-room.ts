/**
 * Salle temps réel en Durable Object : un objet par monde, qui branche les WebSocket sur `Room` (src/server/room.ts).
 * API d'hibernation : quand plus personne ne roule, l'objet peut être mis en veille sans couper les connexions ;
 * chaque WebSocket garde son coureur en pièce jointe, pour reconstruire la salle au réveil.
 * Le Worker (`worker/app.ts`) a déjà vérifié la session et la version : il passe le coureur dans les en-têtes.
 */
import { COL_DES_ERABLES } from '../src/domain/course/courses/col-des-erables.ts';
import { Room, TICK_MS, type Connection, type Member } from '../src/server/room.ts';

/** Ce que ce module utilise des WebSocket de Cloudflare : de quoi le tester sans leurs types. */
export interface CfWebSocket {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface DurableObjectStateLike {
  acceptWebSocket(ws: CfWebSocket): void;
  getWebSockets(): CfWebSocket[];
}

declare const WebSocketPair: { new (): { 0: CfWebSocket; 1: CfWebSocket } };

const connectionOf = (ws: CfWebSocket): Connection => ({
  send: (data) => ws.send(data),
  close: (code, reason) => ws.close(code, reason),
});

export class WorldRoom {
  private readonly room = new Room(COL_DES_ERABLES);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly ctx: DurableObjectStateLike) {
    for (const ws of ctx.getWebSockets()) {
      const m = ws.deserializeAttachment() as Member | null;
      if (m) this.room.restore(m, connectionOf(ws));
    }
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
