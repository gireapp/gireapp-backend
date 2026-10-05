import { describe, it, expect } from 'vitest';
import { POINTS } from '@gireapp/shared';
import { badgeForScore, gradeAttempt, pointsForAttempt } from '../quiz-grading';

const questions = [
  {
    id: 'q1',
    points: 1,
    choices: [
      { id: 'q1-right', isCorrect: true },
      { id: 'q1-wrong', isCorrect: false },
    ],
  },
  {
    id: 'q2',
    points: 4,
    choices: [
      { id: 'q2-right', isCorrect: true },
      { id: 'q2-wrong', isCorrect: false },
    ],
  },
];

describe('gradeAttempt', () => {
  it('weights the score by each question’s points', () => {
    // Only the 4-point question right: 4 of 5 points.
    const grade = gradeAttempt(questions, { q1: 'q1-wrong', q2: 'q2-right' });

    expect(grade).toMatchObject({ score: 80, totalRight: 1, totalWrong: 1 });
  });

  it('marks an unanswered question wrong, not missing', () => {
    const grade = gradeAttempt(questions, { q2: 'q2-right' });

    expect(grade.outcomes[0]).toEqual({
      questionId: 'q1',
      chosenChoiceId: null,
      correctChoiceId: 'q1-right',
      isCorrect: false,
    });
  });

  it('gives no credit for naming another question’s correct choice', () => {
    // A tampered submission pairing q1 with q2's right answer.
    const grade = gradeAttempt(questions, { q1: 'q2-right', q2: 'q2-right' });

    expect(grade.totalRight).toBe(1);
    expect(grade.score).toBe(80);
  });

  it('ignores answers for questions that are not in the quiz', () => {
    const grade = gradeAttempt(questions, { q1: 'q1-right', q2: 'q2-right', q999: 'x' });

    expect(grade).toMatchObject({ score: 100, totalRight: 2, totalWrong: 0 });
  });

  it('scores an empty quiz as zero rather than dividing by zero', () => {
    expect(gradeAttempt([], {}).score).toBe(0);
  });
});

describe('pointsForAttempt', () => {
  it('pays the full pass amount for passing first time', () => {
    expect(pointsForAttempt({ passed: true, priorAttempts: 0, priorPoints: 0 })).toBe(POINTS.QUIZ_PASS);
  });

  it('pays the trying amount for failing first time', () => {
    expect(pointsForAttempt({ passed: false, priorAttempts: 0, priorPoints: 0 })).toBe(POINTS.QUIZ_FAIL);
  });

  it('pays nothing for failing a retake', () => {
    expect(
      pointsForAttempt({ passed: false, priorAttempts: 1, priorPoints: POINTS.QUIZ_FAIL })
    ).toBe(0);
  });

  it('tops a later pass up to the cap, so failing first never pays more', () => {
    const later = pointsForAttempt({
      passed: true,
      priorAttempts: 2,
      priorPoints: POINTS.QUIZ_FAIL,
    });

    expect(POINTS.QUIZ_FAIL + later).toBe(POINTS.QUIZ_PASS);
  });

  it('pays nothing for passing a quiz already passed — retakes cannot farm points', () => {
    expect(
      pointsForAttempt({ passed: true, priorAttempts: 1, priorPoints: POINTS.QUIZ_PASS })
    ).toBe(0);
  });

  it('caps the total a quiz can ever pay, whatever the sequence', () => {
    const sequence = [false, false, true, true, false, true];
    let priorPoints = 0;
    sequence.forEach((passed, priorAttempts) => {
      priorPoints += pointsForAttempt({ passed, priorAttempts, priorPoints });
    });

    expect(priorPoints).toBe(POINTS.QUIZ_PASS);
  });
});

describe('badgeForScore', () => {
  it.each([
    [50, 'BRONZE'],
    [70, 'SILVER'],
    [90, 'GOLD'],
    [95, 'CURRENT_MASTER'],
    [100, 'CURRENT_MASTER'],
  ])('awards the highest tier a passing %i reaches: %s', (score, tier) => {
    expect(badgeForScore(score, true)).toBe(tier);
  });

  it('awards nothing below the lowest threshold', () => {
    expect(badgeForScore(49, true)).toBeNull();
  });

  it('awards nothing for a failed attempt, even above a threshold', () => {
    expect(badgeForScore(65, false)).toBeNull();
  });
});
