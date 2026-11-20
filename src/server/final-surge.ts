import { FinalSurgeAuthenticationError, FinalSurgeClient, mapFinalSurgeWorkout, type FinalSurgeRecord } from '../infra/integrations/final-surge/index.ts';
import type { User } from './accounts.ts';

export interface FinalSurgeCredentials { email: string; password: string }
export interface FinalSurgeStore {
  load(userId: string): Promise<string | undefined>;
  save(userId: string, encrypted: string): Promise<void>;
  remove(userId: string): Promise<void>;
}
interface Accounts { userOf(req: Request): Promise<User | undefined>; mutating(req: Request): boolean }
interface LoginData { token: string; userKey: string }
const BASE = 'https://beta.finalsurge.com/api';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error('FINAL_SURGE_ENCRYPTION_KEY doit contenir au moins 32 caractères.');
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), enc.encode(value));
  return JSON.stringify({ iv: b64(iv), data: b64(new Uint8Array(encrypted)) });
}
async function unseal(value: string, secret: string): Promise<string> {
  const stored = JSON.parse(value) as { iv: string; data: string };
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(stored.iv) }, await encryptionKey(secret), unb64(stored.data));
  return new TextDecoder().decode(plain);
}
async function login(credentials: FinalSurgeCredentials, f: typeof fetch): Promise<LoginData> {
  const response = await f(`${BASE}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: '' },
    body: JSON.stringify({ email: credentials.email, password: credentials.password, deviceManufacturer: '', deviceModel: 'ma-moulinette', deviceOperatingSystem: 'web', deviceUniqueIdentifier: '' }),
  });
  if (!response.ok) throw new Error(`Connexion Final Surge refusée (HTTP ${response.status}).`);
  const payload = await response.json() as Record<string, unknown>;
  const data = (payload.data && typeof payload.data === 'object' ? payload.data : payload) as Record<string, unknown>;
  const token = data.token ?? data.accessToken ?? data.access_token;
  const userKey = data.user_key ?? data.key ?? data.userKey ?? data.userkey ?? data.UserKey;
  if (payload.success === false || typeof token !== 'string' || (typeof userKey !== 'string' && typeof userKey !== 'number')) throw new Error('Réponse de connexion Final Surge non reconnue.');
  return { token, userKey: String(userKey) };
}
function validDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function createFinalSurge(accounts: Accounts, store: FinalSurgeStore, secret?: string, f: typeof fetch = (...args) => fetch(...args)) {
  return async (req: Request): Promise<Response | undefined> => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/integrations/final-surge/')) return undefined;
    if (!accounts.mutating(req) && req.method !== 'GET') return json({ error: 'forbidden' }, 403);
    const user = await accounts.userOf(req);
    if (!user) return json({ error: 'not_signed_in' }, 401);
    if (!secret || secret.length < 32) return json({ error: 'integration_not_configured' }, 503);
    const route = url.pathname.slice('/api/integrations/final-surge/'.length);

    if (route === 'status' && req.method === 'GET') return json({ connected: !!(await store.load(user.id)) });
    if (route === 'connect' && req.method === 'POST') {
      const body = await req.json().catch(() => ({})) as Partial<FinalSurgeCredentials>;
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!email || email.length > 254 || !password || password.length > 1024) return json({ error: 'invalid_credentials' }, 400);
      try {
        await login({ email, password }, f);
        await store.save(user.id, await seal(JSON.stringify({ email, password }), secret));
        return json({ connected: true });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'final_surge_login_failed' }, 401);
      }
    }
    if (route === 'disconnect' && req.method === 'POST') {
      await store.remove(user.id);
      return json({ connected: false });
    }
    if (route === 'workouts' && req.method === 'POST') {
      const body = await req.json().catch(() => ({})) as { startDate?: unknown; endDate?: unknown };
      if (!validDate(body.startDate) || !validDate(body.endDate) || body.startDate > body.endDate) return json({ error: 'invalid_date_range' }, 400);
      const encrypted = await store.load(user.id);
      if (!encrypted) return json({ error: 'not_connected' }, 409);
      try {
        const credentials = JSON.parse(await unseal(encrypted, secret)) as FinalSurgeCredentials;
        const session = await login(credentials, f);
        const client = new FinalSurgeClient({ accessToken: session.token, userKey: session.userKey, fetch: f });
        const summaries = await client.listWorkouts({ startDate: body.startDate, endDate: body.endDate });
        const workouts: ReturnType<typeof mapFinalSurgeWorkout>[] = [];
        const errors: string[] = [];
        for (const summary of summaries) {
          const key = summary.WorkoutKey ?? summary.workoutKey ?? summary.workout_key ?? summary.WorkoutId ?? summary.Key ?? summary.key ?? summary.Id ?? summary.id;
          if ((typeof key !== 'string' && typeof key !== 'number') || !String(key).trim()) { errors.push('Une séance sans identifiant a été ignorée.'); continue; }
          const workoutKey = String(key);
          try {
            const builder = await client.getStructuredWorkout(workoutKey);
            const mapped = mapFinalSurgeWorkout(summary as FinalSurgeRecord, builder);
            if (mapped.workout.steps.length) workouts.push(mapped);
            else errors.push(`${mapped.workout.name} : aucune étape exploitable.`);
          } catch { errors.push('Une séance n’a pas pu être lue.'); }
        }
        return json({ workouts, errors });
      } catch (error) {
        if (error instanceof FinalSurgeAuthenticationError) return json({ error: 'final_surge_authentication_failed' }, 401);
        return json({ error: error instanceof Error ? error.message : 'final_surge_sync_failed' }, 502);
      }
    }
    return json({ error: 'not_found' }, 404);
  };
}
