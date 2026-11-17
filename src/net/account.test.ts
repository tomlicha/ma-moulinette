import { describe, expect, it, vi } from 'vitest';
import { nativeStravaLogin } from './account';

describe('nativeStravaLogin', () => {
  const T = 'a'.repeat(64);
  it('ouvre la connexion dans la session système, puis échange le ticket contre une session', async () => {
    const auth = vi.fn(async () => ({ url: `moulinette://auth?ticket=${T}` }));
    const f = vi.fn(async () => new Response(JSON.stringify({ user: { id: 'u' } }), { status: 200 }));
    expect(await nativeStravaLogin(auth, 'https://app.example', f as unknown as typeof fetch)).toBe(true);
    expect(auth).toHaveBeenCalledWith({ url: 'https://app.example/api/auth/login?native=1', callbackScheme: 'moulinette' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/redeem');
    expect(JSON.parse(init.body as string)).toEqual({ ticket: T });
    expect((init.headers as Record<string, string>)['x-zwift2']).toBe('1');
  });

  it('annulée ou refusée : rien n’est échangé', async () => {
    const f = vi.fn();
    expect(await nativeStravaLogin(async () => Promise.reject(new Error('cancelled')), 'https://a', f as never)).toBe(false);
    expect(await nativeStravaLogin(async () => ({ url: 'moulinette://auth?error=denied' }), 'https://a', f as never)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
