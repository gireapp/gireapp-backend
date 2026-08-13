import { describe, it, expect } from 'vitest';
import { POINTS } from '@gireapp/shared';
import { sumAttemptPoints } from '../dashboard.controller';

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
