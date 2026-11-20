import { describe, expect, it, vi } from 'vitest';
import { FinalSurgeAuthenticationError, FinalSurgeClient } from '../client.ts';

describe('FinalSurgeClient', () => {
  it('pads the date range then filters back to the inclusive dates', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [
      { WorkoutKey: 'before', WorkoutDay: '2026-11-19' },
      { WorkoutKey: 'inside-1', WorkoutDay: '2026-11-20' },
      { WorkoutKey: 'inside-2', WorkoutDay: '2026-11-21' },
      { WorkoutKey: 'after', WorkoutDay: '2026-11-22' },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = new FinalSurgeClient({ accessToken: 'token', userKey: 'user', fetch: fetchMock });
    const workouts = await client.listWorkouts({ startDate: '2026-11-20', endDate: '2026-11-21' });
    expect(workouts.map((item) => item.WorkoutKey)).toEqual(['inside-1', 'inside-2']);
    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/api/WorkoutList');
    expect(parsed.searchParams.get('startdate')).toBe('2026-11-19');
    expect(parsed.searchParams.get('enddate')).toBe('2026-11-22');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it('reads the Workout Builder endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { target_options: [] } }), { status: 200 }));
    const client = new FinalSurgeClient({ accessToken: 'token', userKey: 'user', fetch: fetchMock });
    await client.getStructuredWorkout('wk-1');
    const parsed = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(parsed.pathname).toBe('/api/WorkoutBuilderGet');
    expect(parsed.searchParams.get('workout_key')).toBe('wk-1');
  });

  it('surfaces expired sessions without trying password login', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const client = new FinalSurgeClient({ accessToken: 'expired', userKey: 'user', fetch: fetchMock });
    await expect(client.getStructuredWorkout('wk-1')).rejects.toBeInstanceOf(FinalSurgeAuthenticationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });


  it('rejects invalid and reversed date ranges before making a request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new FinalSurgeClient({ accessToken: 'token', userKey: 'user', fetch: fetchMock });
    await expect(client.listWorkouts({ startDate: '2026-02-30', endDate: '2026-03-01' })).rejects.toThrow('YYYY-MM-DD');
    await expect(client.listWorkouts({ startDate: '2026-03-02', endDate: '2026-03-01' })).rejects.toThrow('précéder');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing credentials at construction time', () => {
    expect(() => new FinalSurgeClient({ accessToken: ' ', userKey: 'user' })).toThrow('accessToken');
    expect(() => new FinalSurgeClient({ accessToken: 'token', userKey: ' ' })).toThrow('userKey');
  });

  it('surfaces non-401 HTTP errors with their status', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status: 503 }));
    const client = new FinalSurgeClient({ accessToken: 'token', userKey: 'user', fetch: fetchMock });
    await expect(client.listWorkouts({ startDate: '2026-11-20', endDate: '2026-11-20' }))
      .rejects.toMatchObject({ name: 'FinalSurgeHttpError', status: 503 });
  });

  it('rejects a successful HTTP response containing invalid JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>login</html>', { status: 200 }));
    const client = new FinalSurgeClient({ accessToken: 'token', userKey: 'user', fetch: fetchMock });
    await expect(client.getStructuredWorkout('wk-1')).rejects.toThrow('non JSON');
  });

  it('surfaces API-level failures even when HTTP status is 200', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ success: false, message: 'Invalid session' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const client = new FinalSurgeClient({ accessToken: 'token', userKey: 'user', fetch: fetchMock });
    await expect(client.getStructuredWorkout('wk-1')).rejects.toThrow('Invalid session');
  });

  it('rejects an empty workout key without making a request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new FinalSurgeClient({ accessToken: 'token', userKey: 'user', fetch: fetchMock });
    await expect(client.getStructuredWorkout(' ')).rejects.toThrow('workoutKey');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
