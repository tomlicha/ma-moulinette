/**
 * Données du coureur gardées avec son compte (`POST /api/sync`) : réglages, séances, « Mes blocs ».
 * Un seul aller-retour fait tout : la page envoie ses modifications et la dernière révision reçue, le serveur garde
 * chaque modification plus récente que la sienne et rend ce qui a changé depuis. Protocole : src/infra/sync/protocol.ts.
 *
 * Révisions : chaque écriture reçoit la révision suivante du compte (1, 2, 3…). Une page qui a reçu jusqu'à la
 * révision N n'a donc qu'à demander « depuis N » pour apprendre ce que ses autres appareils ont fait.
 */
import { checkItem, keyOf, SYNC_LIMITS, SYNC_PATH, type SyncItem, type SyncResponse } from '../infra/sync/protocol';
import type { User } from './accounts';

export interface SyncRow extends SyncItem {
  rev: number;
}

export interface SyncStore {
  /** Écrit l'élément s'il est nouveau ou plus récent (`updatedAt`) que celui du serveur, avec la révision suivante. */
  put(userId: string, item: SyncItem): Promise<void>;
  /** Éléments de révision supérieure à `since`, par révision croissante, `limit` au plus. */
  changes(userId: string, since: number, limit: number): Promise<SyncRow[]>;
  get(userId: string, kind: string, id: string): Promise<SyncRow | undefined>;
  /** Dernière révision du compte (0 s'il n'a rien). */
  maxRev(userId: string): Promise<number>;
  /** Éléments non supprimés du compte. */
  countLive(userId: string): Promise<number>;
}

interface Accounts {
  userOf(req: Request): Promise<User | undefined>;
  mutating(req: Request): boolean;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const strip = ({ kind, id, body, updatedAt }: SyncRow): SyncItem => ({ kind, id, body, updatedAt });

export function createSync(accounts: Accounts, store: SyncStore) {
  return async function handle(req: Request): Promise<Response | undefined> {
    if (new URL(req.url).pathname !== SYNC_PATH) return undefined;
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!accounts.mutating(req)) return json({ error: 'forbidden' }, 403);
    const user = await accounts.userOf(req);
    if (!user) return json({ error: 'not_signed_in' }, 401);

    const text = await req.text();
    if (text.length > SYNC_LIMITS.requestChars) return json({ error: 'too_large' }, 413);
    let parsed: { since?: unknown; changes?: unknown };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
    const changes = parsed?.changes ?? [];
    if (typeof parsed?.since !== 'number' || !Number.isSafeInteger(parsed.since) || parsed.since < 0) return json({ error: 'invalid_since' }, 400);
    let since: number = parsed.since;
    if (!Array.isArray(changes) || changes.length > SYNC_LIMITS.changesPerRequest) return json({ error: 'invalid_changes' }, 400);

    // Révision inconnue du serveur (base remise à zéro, autre base) : la page reçoit tout, la fusion fait le reste.
    if (since > (await store.maxRev(user.id))) since = 0;

    const rejected: string[] = [];
    const sent: SyncItem[] = [];
    let live: number | undefined;
    for (const raw of changes as unknown[]) {
      const item = checkItem(raw);
      if (!item) {
        const r = raw as { kind?: unknown; id?: unknown } | null;
        if (typeof r?.kind === 'string' && typeof r.id === 'string') rejected.push(`${r.kind}/${r.id}`);
        continue;
      }
      if (item.body !== null) {
        live ??= await store.countLive(user.id);
        if (live >= SYNC_LIMITS.itemsPerUser) {
          const existing = await store.get(user.id, item.kind, item.id);
          if (!existing || existing.body === null) {
            rejected.push(keyOf(item));
            continue;
          }
        }
      }
      await store.put(user.id, item);
      sent.push(item);
    }

    const page = await store.changes(user.id, since, SYNC_LIMITS.itemsPerPage + 1);
    const more = page.length > SYNC_LIMITS.itemsPerPage;
    if (more) page.length = SYNC_LIMITS.itemsPerPage;
    const items = page.map(strip);
    // L'état final de chaque élément envoyé, même hors de cette page : la page sait ainsi si sa version a gagné.
    const inPage = new Set(items.map(keyOf));
    for (const s of sent) {
      if (inPage.has(keyOf(s))) continue;
      const row = await store.get(user.id, s.kind, s.id);
      if (row) items.push(strip(row));
    }
    const res: SyncResponse = { rev: page.at(-1)?.rev ?? since, more, items, rejected };
    return json(res);
  };
}
