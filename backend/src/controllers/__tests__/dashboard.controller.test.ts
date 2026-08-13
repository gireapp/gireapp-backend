import { describe, it, expect } from 'vitest';
import { POINTS } from '@gireapp/shared';
import { sumAttemptPoints, rankPercentileFrom } from '../dashboard.controller';

function attempt(score: number, passingScore = 70) {
  return { score, quiz: { passingScore } };
}

describe('sumAttemptPoints', () => {
  it('is zero for a learner with no attempts in the window', () => {
    expect(sumAttemptPoints([])).toBe(0);
  });

  it('awards the pass rate for a score on the passing mark', () => {
    expect(sumAttemptPoints([attempt(70)])).toBe(POINTS.QUIZ_PASS);
  });

  it('awards the fail rate one point below the passing mark', () => {
    expect(sumAttemptPoints([attempt(69)])).toBe(POINTS.QUIZ_FAIL);
  });

  it('respects each quiz’s own passing score', () => {
    // 60 passes a quiz that needs 50 and fails one that needs 80.
    expect(sumAttemptPoints([attempt(60, 50), attempt(60, 80)])).toBe(
      POINTS.QUIZ_PASS + POINTS.QUIZ_FAIL
    );
  });

  it('totals a mixed run of attempts', () => {
    const attempts = [attempt(90), attempt(40), attempt(75), attempt(10)];

    expect(sumAttemptPoints(attempts)).toBe(POINTS.QUIZ_PASS * 2 + POINTS.QUIZ_FAIL * 2);
  });
});

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
