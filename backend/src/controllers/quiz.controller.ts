import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
  submitQuizSchema,
  type BadgeType,
  type LearnerQuizHistory,
  type LearnerQuizIntro,
  type QuizResult,
  type StartedQuiz,
} from '@gireapp/shared';
import { prisma } from '../services/prisma';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';
import { issueQuizTicket, verifyQuizTicket } from '../utils/quiz-ticket';
import { coursesOpenTo, type CourseViewer } from '../utils/course-access';
import { badgeForScore, gradeAttempt, pointsForAttempt } from '../services/quiz-grading';

const MS_PER_SECOND = 1000;
const UNIQUE_VIOLATION = 'P2002';

/**
 * A quiz a viewer may see: published, with at least one question, in a
 * published, undeleted course the viewer can open. A draft, an empty quiz or
 * another track's quiz is indistinguishable from one that does not exist.
 */
function visibleQuiz(quizId: string, viewer: CourseViewer): Prisma.QuizWhereInput {
  return {
    id: quizId,
    published: true,
    questions: { some: {} },
    course: { published: true, deletedAt: null, AND: [coursesOpenTo(viewer)] },
  };
}

const ORDERED_QUESTIONS = {
  orderBy: { order: 'asc' },
  select: {
    id: true,
    text: true,
    explanation: true,
    points: true,
    choices: { orderBy: { order: 'asc' }, select: { id: true, text: true, isCorrect: true } },
  },
} satisfies Prisma.Quiz$questionsArgs;

export function historyFrom(
  attempts: { score: number }[],
  passingScore: number
): LearnerQuizHistory {
  const bestScore = attempts.length === 0 ? null : Math.max(...attempts.map((a) => a.score));
  return {
    attemptCount: attempts.length,
    bestScore,
    passed: bestScore !== null && bestScore >= passingScore,
  };
}

function isEnrolled(userId: string, courseId: string) {
  return prisma.enrolment.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { id: true },
  });
}

function fail(res: Response, req: Request, message: string, error: unknown): void {
  logger.error(message, {
    errorMessage: (error as Error).message,
    userId: (req as AuthenticatedRequest).user?.userId,
  });
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
}

// ── GET /api/quizzes/:quizId ──

export const getQuizIntro = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quizId } = req.params as { quizId: string };
    const viewer = (req as AuthenticatedRequest).user;
    const userId = viewer.userId;

    const quiz = await prisma.quiz.findFirst({
      where: visibleQuiz(quizId, viewer),
      select: {
        id: true,
        title: true,
        description: true,
        difficulty: true,
        timeLimitMin: true,
        passingScore: true,
        course: { select: { id: true, title: true } },
        questions: { select: { points: true } },
        attempts: { where: { userId }, select: { score: true } },
      },
    });

    if (!quiz) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    const data: LearnerQuizIntro = {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      difficulty: quiz.difficulty,
      timeLimitMin: quiz.timeLimitMin,
      passingScore: quiz.passingScore,
      questionCount: quiz.questions.length,
      totalPoints: quiz.questions.reduce((sum, question) => sum + question.points, 0),
      course: quiz.course,
      isEnrolled: Boolean(await isEnrolled(userId, quiz.course.id)),
      history: historyFrom(quiz.attempts, quiz.passingScore),
    };

    res.status(200).json({ success: true, data });
  } catch (error) {
    fail(res, req, 'Get quiz intro error', error);
  }
};

// ── POST /api/quizzes/:quizId/start ──

export const startQuiz = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quizId } = req.params as { quizId: string };
    const viewer = (req as AuthenticatedRequest).user;
    const userId = viewer.userId;

    const quiz = await prisma.quiz.findFirst({
      where: visibleQuiz(quizId, viewer),
      select: { id: true, courseId: true, timeLimitMin: true, questions: ORDERED_QUESTIONS },
    });

    if (!quiz) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    if (!(await isEnrolled(userId, quiz.courseId))) {
      res.status(403).json({ error: 'Enrol in this course to take its quizzes.' });
      return;
    }

    const { ticket, expiresAt } = issueQuizTicket(quiz.id, userId, quiz.timeLimitMin);

    // `isCorrect` and `explanation` are stripped here: a learner sees the
    // answers only once they have submitted.
    const data: StartedQuiz = {
      ticket,
      expiresAt: expiresAt.toISOString(),
      questions: quiz.questions.map((question) => ({
        id: question.id,
        text: question.text,
        points: question.points,
        choices: question.choices.map((choice) => ({ id: choice.id, text: choice.text })),
      })),
    };

    res.status(200).json({ success: true, data });
  } catch (error) {
    fail(res, req, 'Start quiz error', error);
  }
};

// ── POST /api/quizzes/:quizId/submit ──

/**
 * Records the attempt and pays out its points and badge in one transaction.
 *
 * The learner's own row is locked first. The payout depends on earlier
 * attempts at the same quiz, so two submissions racing each other could both
 * read "no prior attempts" and each pay the full amount; the lock makes the
 * second wait and read the first.
 */
async function recordAttempt(args: {
  userId: string;
  quizId: string;
  courseId: string;
  startedAt: Date;
  answers: Record<string, string>;
  score: number;
  totalRight: number;
  totalWrong: number;
  passed: boolean;
  timeTakenSec: number;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM users WHERE id = ${args.userId} FOR UPDATE`;

    const prior = await tx.quizAttempt.aggregate({
      where: { userId: args.userId, quizId: args.quizId },
      _count: true,
      _sum: { pointsEarned: true },
    });

    const pointsEarned = pointsForAttempt({
      passed: args.passed,
      priorAttempts: prior._count,
      priorPoints: prior._sum.pointsEarned ?? 0,
    });

    const attempt = await tx.quizAttempt.create({
      data: {
        userId: args.userId,
        quizId: args.quizId,
        score: args.score,
        totalRight: args.totalRight,
        totalWrong: args.totalWrong,
        answers: args.answers,
        startedAt: args.startedAt,
        timeTakenSec: args.timeTakenSec,
        pointsEarned,
      },
      select: { id: true },
    });

    if (pointsEarned > 0) {
      await tx.user.update({
        where: { id: args.userId },
        data: { points: { increment: pointsEarned } },
      });
    }

    let badgeEarned: BadgeType | null = null;
    const tier = badgeForScore(args.score, args.passed);
    if (tier) {
      const held = await tx.userBadge.findUnique({
        where: {
          userId_badgeType_courseId: { userId: args.userId, badgeType: tier, courseId: args.courseId },
        },
        select: { id: true },
      });
      if (!held) {
        await tx.userBadge.create({
          data: { userId: args.userId, badgeType: tier, courseId: args.courseId },
        });
        badgeEarned = tier;
      }
    }

    return { attemptId: attempt.id, pointsEarned, badgeEarned };
  });
}

export const submitQuiz = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quizId } = req.params as { quizId: string };
    const viewer = (req as AuthenticatedRequest).user;
    const userId = viewer.userId;

    const body = submitQuizSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ error: 'Validation failed.', errors: body.error.flatten().fieldErrors });
      return;
    }

    const check = verifyQuizTicket(body.data.ticket);
    if (check.status === 'expired') {
      res.status(410).json({ error: 'Time ran out before these answers arrived.' });
      return;
    }
    // A ticket minted for another quiz or another learner is as good as none.
    if (check.status === 'invalid' || check.ticket.quizId !== quizId || check.ticket.userId !== userId) {
      res.status(400).json({ error: 'This quiz session is not valid. Start the quiz again.' });
      return;
    }

    const quiz = await prisma.quiz.findFirst({
      where: { id: quizId, course: { deletedAt: null } },
      select: { courseId: true, passingScore: true, questions: ORDERED_QUESTIONS },
    });

    if (!quiz) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    if (!(await isEnrolled(userId, quiz.courseId))) {
      res.status(403).json({ error: 'Enrol in this course to take its quizzes.' });
      return;
    }

    const grade = gradeAttempt(quiz.questions, body.data.answers);
    const passed = grade.score >= quiz.passingScore;
    const timeTakenSec = Math.round(
      (Date.now() - check.ticket.startedAt.getTime()) / MS_PER_SECOND
    );

    const recorded = await recordAttempt({
      userId,
      quizId,
      courseId: quiz.courseId,
      startedAt: check.ticket.startedAt,
      answers: body.data.answers,
      score: grade.score,
      totalRight: grade.totalRight,
      totalWrong: grade.totalWrong,
      passed,
      timeTakenSec,
    });

    const outcomeById = new Map(grade.outcomes.map((outcome) => [outcome.questionId, outcome]));

    const data: QuizResult = {
      attemptId: recorded.attemptId,
      score: grade.score,
      passingScore: quiz.passingScore,
      passed,
      totalRight: grade.totalRight,
      totalWrong: grade.totalWrong,
      pointsEarned: recorded.pointsEarned,
      badgeEarned: recorded.badgeEarned,
      timeTakenSec,
      review: quiz.questions.map((question) => {
        const outcome = outcomeById.get(question.id);
        return {
          questionId: question.id,
          text: question.text,
          points: question.points,
          choices: question.choices.map((choice) => ({ id: choice.id, text: choice.text })),
          chosenChoiceId: outcome?.chosenChoiceId ?? null,
          correctChoiceId: outcome?.correctChoiceId ?? '',
          isCorrect: outcome?.isCorrect ?? false,
          explanation: question.explanation,
        };
      }),
    };

    logger.info('Quiz submitted', {
      userId,
      quizId,
      score: grade.score,
      passed,
      pointsEarned: recorded.pointsEarned,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    // The ticket's start time is part of a unique key, so a second submission
    // of the same ticket (a double-clicked Submit) lands here.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
      res.status(409).json({ error: 'These answers have already been submitted.' });
      return;
    }
    fail(res, req, 'Submit quiz error', error);
  }
};
