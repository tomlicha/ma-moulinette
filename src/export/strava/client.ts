import { CSRF_HEADER, OWNER_HEADER, PREFIX } from './relay';

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athlete?: string;
  /** Le relais exige une clé que l'appareil n'a pas (ou plus). */
  locked?: boolean;
}

const KEY_STORAGE = 'mamoulinette.ownerKey';

export function getOwnerKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setOwnerKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* stockage indisponible : la clé sera redemandée */
  }
}

const authHeaders = (): Record<string, string> => {
  // Une clé collée avec un saut de ligne ou un caractère invisible rend l'en-tête invalide et fait échouer fetch lui-même.
  const key = getOwnerKey().replace(/[^\x21-\x7e]/g, '');
  return key ? { [OWNER_HEADER]: key } : {};
};

/** Adresse Strava à ouvrir dans la fenêtre de connexion (le relais y joint un état signé). */
export async function getLoginUrl(f: Fetch = fetch): Promise<string> {
  const res = await f(`${PREFIX}login`, { method: 'POST', headers: { [CSRF_HEADER]: '1', ...authHeaders() } });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error === 'locked' ? 'clé d’accès refusée' : `connexion impossible (HTTP ${res.status})`);
  return body.url;
}

export type SendResult =
  | { ok: true; activityUrl?: string; processing?: boolean }
  | { ok: false; reason: 'not_configured' | 'not_connected' | 'locked' | 'rejected' | 'error'; message: string };

type Fetch = typeof fetch;

export async function getStatus(f: Fetch = fetch): Promise<StravaStatus> {
  const res = await f(`${PREFIX}status`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`relais Strava indisponible (HTTP ${res.status})`);
  return (await res.json()) as StravaStatus;
}

/** Envoie le FIT au relais local, qui le dépose chez Strava. Ne lève jamais : l'échec est dans le résultat. */
export async function sendToStrava(
  fit: Uint8Array,
  meta: { name: string; externalId: string },
  f: Fetch = fetch,
): Promise<SendResult> {
  let res: Response;
  try {
    const q = new URLSearchParams(meta);
    res = await f(`${PREFIX}upload?${q}`, { method: 'POST', headers: { [CSRF_HEADER]: '1', ...authHeaders() }, body: fit as BodyInit });
  } catch (e) {
    return { ok: false, reason: 'error', message: `relais injoignable : ${e instanceof Error ? e.message : e}` };
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    activityUrl?: string;
    activityId?: string;
  };
  if (res.status === 503) return { ok: false, reason: 'not_configured', message: 'Strava non configuré (voir .env.example)' };
  if (res.status === 403 && body.error === 'locked') return { ok: false, reason: 'locked', message: 'clé d’accès refusée' };
  if (res.status === 401) return { ok: false, reason: 'not_connected', message: 'connexion Strava nécessaire' };
  if (!res.ok) return { ok: false, reason: 'error', message: body.message ?? body.error ?? `HTTP ${res.status}` };
  if (body.error) return { ok: false, reason: 'rejected', message: body.error };
  return { ok: true, activityUrl: body.activityUrl, processing: !body.activityId };
}

/** Attend la fin de la connexion dans la fenêtre ouverte par l'appelant (geste utilisateur synchrone). */
export function waitForLogin(win: Window, timeoutMs = 5 * 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearInterval(timer);
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(ok);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data === 'strava-connected') done(true);
    };
    window.addEventListener('message', onMessage);
    const timer = setInterval(() => win.closed && done(false), 500);
    const timeout = setTimeout(() => done(false), timeoutMs);
  });
}
