import { CSRF_HEADER } from '../../shared/protocol/csrf';
import type { MappedFinalSurgeWorkout } from '../integrations/final-surge/types';

const ROOT = '/api/integrations/final-surge/';
const headers = { 'content-type': 'application/json', [CSRF_HEADER]: '1' };
async function request<T>(route: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const response = await fetch(ROOT + route, {
    method, credentials: 'same-origin',
    ...(method === 'POST' ? { headers, body: JSON.stringify(body ?? {}) } : {}),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}
export const finalSurgeStatus = () => request<{ connected: boolean }>('status', 'GET');
export const connectFinalSurge = (email: string, password: string) => request<{ connected: true }>('connect', 'POST', { email, password });
export const disconnectFinalSurge = () => request<{ connected: false }>('disconnect', 'POST');
export const importFinalSurgeWorkouts = (startDate: string, endDate: string) =>
  request<{ workouts: MappedFinalSurgeWorkout[]; errors: string[] }>('workouts', 'POST', { startDate, endDate });
