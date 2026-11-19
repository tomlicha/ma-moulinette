import { describe, expect, it } from 'vitest';
import { GradeSlew } from './grade-throttle';

describe('GradeSlew', () => {
  it('suit la première valeur telle quelle', () => {
    expect(new GradeSlew().next(8, 0)).toBe(8);
  });
  it('limite une baisse brusque de pente', () => {
    const s = new GradeSlew(1.5);
    s.next(8, 0);
    expect(s.next(2, 1000)).toBeCloseTo(6.5);
    expect(s.next(2, 2000)).toBeCloseTo(5);
  });
  it('rejoint la cible quand l’écart est petit', () => {
    const s = new GradeSlew(1.5);
    s.next(5, 0);
    expect(s.next(5.5, 1000)).toBeCloseTo(5.5);
  });
});
