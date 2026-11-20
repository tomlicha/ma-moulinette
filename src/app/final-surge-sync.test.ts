import { describe, expect, it, vi } from 'vitest';
import { finalSurgeSyncWindow, synchronizeFinalSurge } from './final-surge-sync';

describe('Final Surge automatic synchronization', () => {
  it('uses a rolling 14-calendar-day window including today', () => {
    expect(finalSurgeSyncWindow(new Date(2026, 10, 20, 16))).toEqual({
      startDate: '2026-11-20',
      endDate: '2026-12-03',
    });
  });

  it('fetches and imports the same window, returning counts and warnings', async () => {
    const fetchWorkouts = vi.fn(async (startDate: string, endDate: string) => ({
      workouts: [] as never[],
      errors: ['Une séance a été ignorée.'],
      startDate,
      endDate,
    }));
    const importWorkouts = vi.fn(() => ({ created: 2, updated: 1, unchanged: 4, skipped: 1 }));
    const result = await synchronizeFinalSurge({
      fetchWorkouts,
      importWorkouts,
      now: new Date(2026, 10, 20, 16),
    });
    expect(fetchWorkouts).toHaveBeenCalledWith('2026-11-20', '2026-12-03');
    expect(importWorkouts).toHaveBeenCalledWith([]);
    expect(result).toEqual({
      startDate: '2026-11-20', endDate: '2026-12-03',
      created: 2, updated: 1, unchanged: 4, skipped: 1,
      errors: ['Une séance a été ignorée.'],
    });
  });
});
