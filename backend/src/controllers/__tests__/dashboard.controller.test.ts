import { describe, it, expect } from 'vitest';
import { rankPercentileFrom } from '../dashboard.controller';

describe('rankPercentileFrom', () => {
  it.each([0, 1, 2, 3, 4])('withholds a rank for a cohort of %i peers', (peers) => {
    expect(rankPercentileFrom(0, peers)).toBeNull();
  });

  it('puts a clear leader inside the top slice, never at zero', () => {
    const percentile = rankPercentileFrom(0, 99);

    expect(percentile).toBe(1);
    expect(percentile).toBeGreaterThan(0);
  });

  it('puts the last-placed learner at 100%', () => {
    expect(rankPercentileFrom(99, 99)).toBe(100);
  });

  it('reports the top 10% for a learner with 9 of 99 peers ahead', () => {
    expect(rankPercentileFrom(9, 99)).toBe(10);
  });

  it('rounds up so a learner is never flattered by truncation', () => {
    // 2/11 = 18.18% — reported as 19%, not 18%.
    expect(rankPercentileFrom(1, 10)).toBe(19);
  });

  it('never exceeds 100%', () => {
    expect(rankPercentileFrom(50, 50)).toBeLessThanOrEqual(100);
  });
});
