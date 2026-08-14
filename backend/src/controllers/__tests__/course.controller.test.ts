import { describe, it, expect } from 'vitest';
import { calculateProgress } from '../course.controller';

describe('calculateProgress', () => {
  it('is zero for a course with no lessons, rather than dividing by zero', () => {
    expect(calculateProgress(0, 0)).toBe(0);
    expect(Number.isNaN(calculateProgress(3, 0))).toBe(false);
  });

  it('is zero before the first lesson is finished', () => {
    expect(calculateProgress(0, 12)).toBe(0);
  });

  it('reports a part-finished course as a fraction', () => {
    expect(calculateProgress(3, 12)).toBe(0.25);
    expect(calculateProgress(6, 12)).toBe(0.5);
  });

  it('reaches exactly 1 when every lesson is finished', () => {
    expect(calculateProgress(12, 12)).toBe(1);
  });

  it('clamps at 1 if stale progress rows outnumber current lessons', () => {
    // A lesson removed from the course would otherwise push this above 100%.
    expect(calculateProgress(14, 12)).toBe(1);
  });
});
