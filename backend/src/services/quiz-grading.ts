import { BADGE_THRESHOLDS, POINTS, type BadgeType } from '@gireapp/shared';

const PERCENT = 100;

export type GradableQuestion = {
  id: string;
  points: number;
  choices: { id: string; isCorrect: boolean }[];
};

export type QuestionOutcome = {
  questionId: string;
  chosenChoiceId: string | null;
  correctChoiceId: string;
  isCorrect: boolean;
};

export type Grade = {
  /** Whole percent of available points earned. */
  score: number;
  totalRight: number;
  totalWrong: number;
  outcomes: QuestionOutcome[];
};

/**
 * Scores an attempt, weighting each question by its points.
 *
 * An unanswered question, or an answer naming a choice that does not belong
 * to that question, is simply wrong — the only way to earn credit is to pick
 * that question's correct choice, so a tampered submission gains nothing.
 * Answers for question ids not in the quiz are ignored.
 */
export function gradeAttempt(
  questions: GradableQuestion[],
  answers: Record<string, string>
): Grade {
  let earned = 0;
  let available = 0;

  const outcomes = questions.map((question) => {
    const correct = question.choices.find((choice) => choice.isCorrect);
    const chosenChoiceId = answers[question.id] ?? null;
    const isCorrect = correct !== undefined && chosenChoiceId === correct.id;

    available += question.points;
    if (isCorrect) earned += question.points;

    return {
      questionId: question.id,
      chosenChoiceId,
      correctChoiceId: correct?.id ?? '',
      isCorrect,
    };
  });

  const totalRight = outcomes.filter((outcome) => outcome.isCorrect).length;

  return {
    score: available === 0 ? 0 : Math.round((earned / available) * PERCENT),
    totalRight,
    totalWrong: outcomes.length - totalRight,
    outcomes,
  };
}

/**
 * Points this attempt pays out. A quiz pays at most `POINTS.QUIZ_PASS` in
 * total, however many times it is taken:
 *
 * - first attempt, passed  → QUIZ_PASS
 * - first attempt, failed  → QUIZ_FAIL, for trying
 * - a later pass           → whatever is left of QUIZ_PASS
 * - anything else          → nothing
 *
 * Without the cap, retaking a one-question quiz on a loop would mint points
 * and make the leaderboard meaningless. With it, failing first never pays more
 * than passing first.
 */
export function pointsForAttempt({
  passed,
  priorAttempts,
  priorPoints,
}: {
  passed: boolean;
  priorAttempts: number;
  priorPoints: number;
}): number {
  if (passed) return Math.max(0, POINTS.QUIZ_PASS - priorPoints);
  return priorAttempts === 0 ? POINTS.QUIZ_FAIL : 0;
}

const TIERS_HIGHEST_FIRST = (Object.keys(BADGE_THRESHOLDS) as BadgeType[]).sort(
  (a, b) => BADGE_THRESHOLDS[b].minScore - BADGE_THRESHOLDS[a].minScore
);

/**
 * The highest badge tier a score reaches. Only a passing attempt earns one: a
 * score of 55 clears Bronze's threshold but fails a quiz that needs 70, and a
 * badge for failing would mean nothing.
 */
export function badgeForScore(score: number, passed: boolean): BadgeType | null {
  if (!passed) return null;
  return TIERS_HIGHEST_FIRST.find((tier) => score >= BADGE_THRESHOLDS[tier].minScore) ?? null;
}
