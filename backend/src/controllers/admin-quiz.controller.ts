import { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import {
  issuesByPath,
  saveQuizSchema,
  type AdminQuiz,
  type AdminQuizQuestion,
  type AdminQuizSummary,
  type SaveQuizInput,
} from '@gireapp/shared';
import { prisma } from '../services/prisma';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

/*
 * Quiz text is deliberately NOT run through `detectThreatsInBody` or
 * `sanitizeObject`. The detector flags legitimate SQL questions ("What does
 * SELECT * FROM users return?") as injection, which would make an SQL course
 * unwritable; and `sanitizeString` HTML-escapes on the way in, so "Ohm's law"
 * would be stored as "Ohm&#x27;s law", shown to learners literally, and escaped
 * again on every re-save. Prisma binds every value as a parameter, so stored
 * text cannot inject SQL, and the UI renders it as text, so it cannot inject
 * markup. Store as typed, escape on output.
 */

type StaffUser = AuthenticatedRequest['user'];

const QUESTIONS_WITH_CHOICES = {
  orderBy: { order: 'asc' },
  select: {
    text: true,
    explanation: true,
    points: true,
    choices: { orderBy: { order: 'asc' }, select: { text: true, isCorrect: true } },
  },
} satisfies Prisma.Quiz$questionsArgs;

/**
 * Admins may manage any quiz; a tutor only quizzes in courses they authored —
 * the same rule as lesson media, so one tutor cannot rewrite another's quiz.
 */
function courseScope(user: StaffUser): Prisma.CourseWhereInput {
  return {
    deletedAt: null,
    ...(user.role === 'ADMIN' ? {} : { createdById: user.userId }),
  };
}

type StoredQuestion = {
  text: string;
  explanation: string | null;
  points: number;
  choices: { text: string; isCorrect: boolean }[];
};

/** The comparable form of a question: what a learner's attempt depends on. */
function normaliseQuestions(questions: StoredQuestion[] | SaveQuizInput['questions']) {
  return questions.map((question) => ({
    text: question.text,
    explanation: question.explanation ?? null,
    points: question.points,
    choices: question.choices.map((choice) => ({ text: choice.text, isCorrect: choice.isCorrect })),
  }));
}

export function questionsChanged(
  stored: StoredQuestion[],
  incoming: SaveQuizInput['questions']
): boolean {
  return JSON.stringify(normaliseQuestions(stored)) !== JSON.stringify(normaliseQuestions(incoming));
}

function questionCreates(questions: SaveQuizInput['questions']) {
  return questions.map((question, questionIndex) => ({
    text: question.text,
    explanation: question.explanation ?? null,
    points: question.points,
    order: questionIndex,
    choices: {
      create: question.choices.map((choice, choiceIndex) => ({
        text: choice.text,
        isCorrect: choice.isCorrect,
        order: choiceIndex,
      })),
    },
  }));
}

function quizFields(input: SaveQuizInput) {
  return {
    courseId: input.courseId,
    title: input.title,
    description: input.description || null,
    difficulty: input.difficulty ?? null,
    timeLimitMin: input.timeLimitMin,
    passingScore: input.passingScore,
    published: input.publish,
  };
}

type QuizWithQuestions = Prisma.QuizGetPayload<{
  include: { questions: typeof QUESTIONS_WITH_CHOICES; _count: { select: { attempts: true } } };
}>;

function toAdminQuiz(quiz: QuizWithQuestions): AdminQuiz {
  return {
    id: quiz.id,
    courseId: quiz.courseId,
    title: quiz.title,
    description: quiz.description,
    difficulty: quiz.difficulty,
    timeLimitMin: quiz.timeLimitMin,
    passingScore: quiz.passingScore,
    published: quiz.published,
    questions: quiz.questions satisfies AdminQuizQuestion[],
    attemptCount: quiz._count.attempts,
    updatedAt: quiz.updatedAt.toISOString(),
  };
}

function findQuizInScope(quizId: string, user: StaffUser) {
  return prisma.quiz.findFirst({
    where: { id: quizId, course: courseScope(user) },
    include: { questions: QUESTIONS_WITH_CHOICES, _count: { select: { attempts: true } } },
  });
}

function courseInScope(courseId: string, user: StaffUser) {
  return prisma.course.findFirst({
    where: { id: courseId, ...courseScope(user) },
    select: { id: true },
  });
}

function parseSaveRequest(req: Request, res: Response): SaveQuizInput | null {
  const result = saveQuizSchema.safeParse(req.body);
  if (result.success) return result.data;

  res.status(422).json({ error: 'Validation failed.', errors: issuesByPath(result.error) });
  return null;
}

function rejectUnknownCourse(res: Response): void {
  res.status(422).json({
    error: 'Validation failed.',
    errors: { courseId: ['Choose a subject you can add quizzes to'] },
  });
}

function logAndFail(res: Response, req: Request, message: string, error: unknown): void {
  logger.error(message, {
    errorMessage: (error as Error).message,
    userId: (req as AuthenticatedRequest).user?.userId,
  });
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
}

// ── Handlers ──

export const listQuizzes = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const quizzes = await prisma.quiz.findMany({
      where: { course: courseScope(user) },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        published: true,
        difficulty: true,
        updatedAt: true,
        course: { select: { id: true, title: true, academicLevel: true } },
        _count: { select: { questions: true, attempts: true } },
      },
    });

    const data: AdminQuizSummary[] = quizzes.map(({ _count, updatedAt, ...quiz }) => ({
      ...quiz,
      questionCount: _count.questions,
      attemptCount: _count.attempts,
      updatedAt: updatedAt.toISOString(),
    }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    logAndFail(res, req, 'List quizzes error', error);
  }
};

export const getQuiz = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quizId } = req.params as { quizId: string };
    const quiz = await findQuizInScope(quizId, (req as AuthenticatedRequest).user);

    // 404 for "not yours" as well as "does not exist", so a tutor cannot
    // probe for quiz ids in other people's courses.
    if (!quiz) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    res.status(200).json({ success: true, data: toAdminQuiz(quiz) });
  } catch (error) {
    logAndFail(res, req, 'Get quiz error', error);
  }
};

export const createQuiz = async (req: Request, res: Response): Promise<void> => {
  try {
    const input = parseSaveRequest(req, res);
    if (!input) return;

    const user = (req as AuthenticatedRequest).user;
    if (!(await courseInScope(input.courseId, user))) {
      rejectUnknownCourse(res);
      return;
    }

    const quiz = await prisma.quiz.create({
      data: { ...quizFields(input), questions: { create: questionCreates(input.questions) } },
      include: { questions: QUESTIONS_WITH_CHOICES, _count: { select: { attempts: true } } },
    });

    logger.info('Quiz created', { quizId: quiz.id, published: quiz.published, userId: user.userId });
    res.status(201).json({ success: true, data: toAdminQuiz(quiz) });
  } catch (error) {
    logAndFail(res, req, 'Create quiz error', error);
  }
};

export const updateQuiz = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quizId } = req.params as { quizId: string };
    const input = parseSaveRequest(req, res);
    if (!input) return;

    const user = (req as AuthenticatedRequest).user;
    const existing = await findQuizInScope(quizId, user);
    if (!existing) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    if (input.courseId !== existing.courseId && !(await courseInScope(input.courseId, user))) {
      rejectUnknownCourse(res);
      return;
    }

    const rewriteQuestions = questionsChanged(existing.questions, input.questions);

    if (rewriteQuestions && existing._count.attempts > 0) {
      res.status(409).json({
        error:
          'Learners have already sat this quiz, so its questions can no longer change. ' +
          'Duplicate it to make a new version instead.',
      });
      return;
    }

    // Questions are only rewritten when they actually changed, so a
    // settings-only save (title, pass mark, publish) keeps question ids stable.
    const quiz = await prisma.$transaction(async (tx) => {
      if (rewriteQuestions) {
        await tx.question.deleteMany({ where: { quizId } });
      }

      return tx.quiz.update({
        where: { id: quizId },
        data: {
          ...quizFields(input),
          ...(rewriteQuestions ? { questions: { create: questionCreates(input.questions) } } : {}),
        },
        include: { questions: QUESTIONS_WITH_CHOICES, _count: { select: { attempts: true } } },
      });
    });

    logger.info('Quiz updated', {
      quizId,
      published: quiz.published,
      questionsRewritten: rewriteQuestions,
      userId: user.userId,
    });
    res.status(200).json({ success: true, data: toAdminQuiz(quiz) });
  } catch (error) {
    logAndFail(res, req, 'Update quiz error', error);
  }
};
