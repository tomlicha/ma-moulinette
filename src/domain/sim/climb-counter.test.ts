import { describe, expect, it } from 'vitest';
import { ClimbCounter } from './climb-counter';

describe('ClimbCounter', () => {
  it('ne cumule que les montées', () => {
    const c = new ClimbCounter();
    for (const a of [100, 105, 103, 110, 90]) c.add(a);
    expect(c.total).toBe(12);
    c.reset();
    c.add(50);
    expect(c.total).toBe(0);
  });
});
