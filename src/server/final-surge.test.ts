import { describe, expect, it } from 'vitest';
import { createFinalSurge } from './final-surge.ts';
import { CSRF_HEADER } from '../shared/protocol/csrf.ts';

const secret = 'a-test-encryption-secret-that-is-long-enough';
function setup(fetchImpl: typeof fetch = (async () => Response.json({ success: true, data: { token: 'session-token', user_key: 'athlete-key' } })) as typeof fetch) {
  let stored: string | undefined;
  const store = {
    async load() { return stored; },
    async save(_userId: string, value: string) { stored = value; },
    async remove() { stored = undefined; },
  };
  const accounts = {
    async userOf() { return { id: 'user-1', displayName: 'Rider', nameConfirmed: true }; },
    mutating(req: Request) { return req.method === 'POST' && req.headers.has(CSRF_HEADER); },
  };
  return { handler: createFinalSurge(accounts, store, secret, fetchImpl), get stored() { return stored; } };
}
const post = (path: string, body: unknown) => new Request(`https://moulinette.test/api/integrations/final-surge/${path}`, {
  method: 'POST', headers: { [CSRF_HEADER]: '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('Final Surge integration routes', () => {
  it('validates credentials remotely and stores only authenticated ciphertext', async () => {
    const app = setup();
    const response = await app.handler(post('connect', { email: 'athlete@example.com', password: 'very-secret-password' }));
    expect(response?.status).toBe(200);
    expect(app.stored).toBeTruthy();
    expect(app.stored).not.toContain('very-secret-password');
    expect(app.stored).not.toContain('athlete@example.com');
    const status = await app.handler(new Request('https://moulinette.test/api/integrations/final-surge/status'));
    expect(await status?.json()).toEqual({ connected: true });
  });

  it('rejects mutations without the anti-CSRF header', async () => {
    const app = setup();
    const request = new Request('https://moulinette.test/api/integrations/final-surge/connect', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co', password: 'x' }),
    });
    expect((await app.handler(request))?.status).toBe(403);
  });

  it('removes encrypted credentials on disconnect', async () => {
    const app = setup();
    await app.handler(post('connect', { email: 'athlete@example.com', password: 'secret' }));
    const response = await app.handler(post('disconnect', {}));
    expect(response?.status).toBe(200);
    expect(app.stored).toBeUndefined();
  });

  it('rejects invalid dates before contacting Final Surge', async () => {
    let calls = 0;
    const app = setup((async () => { calls++; return Response.json({}); }) as typeof fetch);
    const response = await app.handler(post('workouts', { startDate: '2026-02-30', endDate: '2026-03-01' }));
    expect(response?.status).toBe(400);
    expect(calls).toBe(0);
  });
});
