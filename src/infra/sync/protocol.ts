/**
 * Synchronisation des données du coureur avec son compte : ce que la page et le serveur échangent sur `/api/sync`.
 * Commun aux deux côtés : la page n'envoie que ce que le serveur acceptera, et relit avec les mêmes règles ce qu'il rend.
 *
 * Chaque donnée est un élément (`SyncItem`) : un réglage (FTP, masse), une séance ou un bloc de « Mes blocs ».
 * Règle de fusion : **la modification la plus récente gagne**, élément par élément (`updatedAt`, horloge de l'appareil
 * qui l'a faite). Une suppression est un élément sans contenu (`body: null`), gardée pour que les autres appareils
 * l'apprennent. Spécification : docs/design/compte.md, section « Données synchronisées ».
 */
import { FTP_LIMITS, MASS_LIMITS } from '../../domain/sim/rider-limits';

export const SYNC_PATH = '/api/sync';

export const SYNC_KINDS = ['setting', 'workout', 'block'] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

export const SYNC_SETTINGS = { ftp: FTP_LIMITS, mass: MASS_LIMITS } as const;
export type SyncSetting = keyof typeof SYNC_SETTINGS;

export const SYNC_TEXT_SETTINGS = ['whatsnew-announced', 'whatsnew-read'] as const;
export type SyncTextSetting = (typeof SYNC_TEXT_SETTINGS)[number];

export interface SyncItem {
  kind: SyncKind;
  id: string;
  body: unknown;
  updatedAt: number;
}

export interface SyncRequest {
  since: number;
  changes: SyncItem[];
}

export interface SyncResponse {
  rev: number;
  more: boolean;
  items: SyncItem[];
  rejected: string[];
}

export const SYNC_LIMITS = {
  changesPerRequest: 100,
  itemsPerPage: 200,
  bodyChars: 32_000,
  itemsPerUser: 1000,
  requestChars: 4_000_000,
} as const;

export const keyOf = (i: Pick<SyncItem, 'kind' | 'id'>) => `${i.kind}/${i.id}`;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;
const isBlocks = (v: unknown, min: number) =>
  Array.isArray(v) && v.length >= min && v.length <= 500 && v.every((b) => isObject(b) && typeof b.type === 'string');

function isWorkoutSource(value: unknown): boolean {
  return isObject(value) &&
    value.provider === 'final-surge' &&
    isText(value.externalId, 128, 1) &&
    (value.scheduledAt === undefined || (isText(value.scheduledAt, 32, 1) && /^\d{4}-\d{2}-\d{2}/.test(value.scheduledAt)));
}

function isBody(kind: SyncKind, id: string, body: unknown): boolean {
  switch (kind) {
    case 'setting': {
      if ((SYNC_TEXT_SETTINGS as readonly string[]).includes(id)) return typeof body === 'string' && ID.test(body);
      if (!Object.hasOwn(SYNC_SETTINGS, id)) return false;
      const limits = SYNC_SETTINGS[id as SyncSetting];
      return typeof body === 'number' && body >= limits.min && body <= limits.max;
    }
    case 'workout':
      return isObject(body) && isText(body.name, 200, 1) &&
        (body.description === undefined || isText(body.description, 4000)) &&
        isBlocks(body.blocks, 0) &&
        (body.source === undefined || isWorkoutSource(body.source));
    case 'block':
      return isObject(body) && isText(body.name, 200, 1) && isBlocks(body.blocks, 1);
  }
}

/** L'élément tel qu'il doit être échangé, ou `undefined` s'il est invalide. */
export function checkItem(raw: unknown): SyncItem | undefined {
  if (!isObject(raw)) return undefined;
  const { kind, id, body, updatedAt } = raw;
  if (typeof kind !== 'string' || !(SYNC_KINDS as readonly string[]).includes(kind)) return undefined;
  if (typeof id !== 'string' || !ID.test(id)) return undefined;
  if (typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt) || updatedAt < 0) return undefined;
  if (body !== null) {
    if (!isBody(kind as SyncKind, id, body)) return undefined;
    if (JSON.stringify(body).length > SYNC_LIMITS.bodyChars) return undefined;
  }
  return { kind: kind as SyncKind, id, body, updatedAt };
}
