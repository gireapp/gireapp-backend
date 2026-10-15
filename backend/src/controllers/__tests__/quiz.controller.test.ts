import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { POINTS } from '@gireapp/shared';

const { prismaMock, txMock, loggerMock } = vi.hoisted(() => {
  const txMock = {
    $executeRaw: vi.fn(),
    quizAttempt: { aggregate: vi.fn(), create: vi.fn() },
    user: { update: vi.fn() },
    userBadge: { findUnique: vi.fn(), create: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      quiz: { findFirst: vi.fn() },
      enrolment: { findUnique: vi.fn() },
      $transaction: vi.fn(async (run: (tx: typeof txMock) => unknown) => run(txMock)),
    },
    loggerMock: { error: vi.fn(), security: vi.fn(), info: vi.fn(), warn: vi.fn() },
  };
});

vi.mock('../../services/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({ logger: loggerMock }));

import { getQuizIntro, startQuiz, submitQuiz } from '../quiz.controller';
import { issueQuizTicket } from '../../utils/quiz-ticket';

const LEARNER = {
  userId: 'learner-1',
  role: 'STUDENT',
  academicLevel: 'SECONDARY',
  department: 'Science',
};
const Q1 = 'cmquestion000000000000001';
const RIGHT = 'cmchoice00000000000000001';
const WRONG = 'cmchoice00000000000000002';

const QUESTIONS = [
  {
    id: Q1,
    text: 'What is velocity?',
    explanation: 'Speed with a direction.',
    points: 5,
    choices: [
      { id: RIGHT, text: 'Speed with direction', isCorrect: true },
      { id: WRONG, text: 'Mass times speed', isCorrect: false },
    ],
  },
];

function buildRes() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

async function call(
  handler: (req: Request, res: Response) => Promise<void>,
  { body, quizId = 'quiz-1', user = LEARNER }: { body?: unknown; quizId?: string; user?: object }
) {
  const res = buildRes();
  await handler({ body, params: { quizId }, user } as unknown as Request, res as unknown as Response);
  return res;
}

function ticketFor(quizId = 'quiz-1', userId = LEARNER.userId) {
  return issueQuizTicket(quizId, userId, 30).ticket;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.enrolment.findUnique.mockResolvedValue({ id: 'enrolment-1' });
  prismaMock.quiz.findFirst.mockResolvedValue({
    id: 'quiz-1',
    courseId: 'course-1',
    timeLimitMin: 30,
    passingScore: 70,
    questions: QUESTIONS,
  });
  txMock.quizAttempt.aggregate.mockResolvedValue({ _count: 0, _sum: { pointsEarned: null } });
  txMock.quizAttempt.create.mockResolvedValue({ id: 'attempt-1' });
  txMock.userBadge.findUnique.mockResolvedValue(null);
});

describe('getQuizIntro', () => {
  it('only ever looks for published, non-empty quizzes in live courses the learner can open', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue(null);

    const res = await call(getQuizIntro, {});

    expect(res.statusCode).toBe(404);
    expect(prismaMock.quiz.findFirst.mock.calls[0]?.[0].where).toEqual({
      id: 'quiz-1',
      published: true,
      questions: { some: {} },
      course: {
        published: true,
        deletedAt: null,
        AND: [
          {
            OR: [
              { academicLevel: 'SECONDARY', department: 'Science' },
              { enrolments: { some: { userId: 'learner-1' } } },
            ],
          },
        ],
      },
    });
  });

  it('summarises the quiz without sending its questions', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue({
      id: 'quiz-1',
      title: 'Kinematics',
      description: null,
      difficulty: 'BEGINNER',
      timeLimitMin: 15,
      passingScore: 70,
      course: { id: 'course-1', title: 'Physics' },
      questions: [{ points: 5 }, { points: 2 }],
      attempts: [{ score: 40 }, { score: 80 }],
    });

    const res = await call(getQuizIntro, {});

    expect(res.body).toMatchObject({
      data: {
        questionCount: 2,
        totalPoints: 7,
        isEnrolled: true,
        history: { attemptCount: 2, bestScore: 80, passed: true },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('isCorrect');
  });
});

describe('startQuiz', () => {
  it('refuses a learner who has not enrolled in the course', async () => {
    prismaMock.enrolment.findUnique.mockResolvedValue(null);

    const res = await call(startQuiz, {});

    expect(res.statusCode).toBe(403);
  });

  it('hands out the questions without the answers or explanations', async () => {
    const res = await call(startQuiz, {});
    const text = JSON.stringify(res.body);

    expect(res.statusCode).toBe(200);
    expect(text).not.toContain('isCorrect');
    expect(text).not.toContain('Speed with a direction.');
    expect(res.body).toMatchObject({ data: { ticket: expect.any(String), questions: [{ id: Q1 }] } });
  });
});

describe('submitQuiz', () => {
  it('grades on the server and pays the first-pass points', async () => {
    const res = await call(submitQuiz, { body: { ticket: ticketFor(), answers: { [Q1]: RIGHT } } });

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      data: { score: 100, passed: true, pointsEarned: POINTS.QUIZ_PASS, badgeEarned: 'CURRENT_MASTER' },
    });
    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: LEARNER.userId },
      data: { points: { increment: POINTS.QUIZ_PASS } },
    });
  });

  it('locks the learner’s row before reading earlier attempts', async () => {
    await call(submitQuiz, { body: { ticket: ticketFor(), answers: { [Q1]: RIGHT } } });

    const lockOrder = txMock.$executeRaw.mock.invocationCallOrder[0] ?? Infinity;
    const readOrder = txMock.quizAttempt.aggregate.mock.invocationCallOrder[0] ?? -1;
    expect(lockOrder).toBeLessThan(readOrder);
  });

  it('pays nothing for re-passing a quiz already paid in full', async () => {
    txMock.quizAttempt.aggregate.mockResolvedValue({ _count: 1, _sum: { pointsEarned: POINTS.QUIZ_PASS } });

    const res = await call(submitQuiz, { body: { ticket: ticketFor(), answers: { [Q1]: RIGHT } } });

    expect(res.body).toMatchObject({ data: { pointsEarned: 0 } });
    expect(txMock.user.update).not.toHaveBeenCalled();
  });

  it('does not re-award a badge the learner already holds for this course', async () => {
    txMock.userBadge.findUnique.mockResolvedValue({ id: 'badge-1' });

    const res = await call(submitQuiz, { body: { ticket: ticketFor(), answers: { [Q1]: RIGHT } } });

    expect(res.body).toMatchObject({ data: { badgeEarned: null } });
    expect(txMock.userBadge.create).not.toHaveBeenCalled();
  });

  it('reveals the correct answer and explanation only in the result', async () => {
    const res = await call(submitQuiz, { body: { ticket: ticketFor(), answers: { [Q1]: WRONG } } });

    expect(res.body).toMatchObject({
      data: {
        passed: false,
        badgeEarned: null,
        review: [{ chosenChoiceId: WRONG, correctChoiceId: RIGHT, isCorrect: false, explanation: 'Speed with a direction.' }],
      },
    });
  });

  it('refuses a ticket issued to another learner', async () => {
    const res = await call(submitQuiz, { body: { ticket: ticketFor('quiz-1', 'someone-else'), answers: {} } });

    expect(res.statusCode).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a ticket issued for another quiz', async () => {
    const res = await call(submitQuiz, { body: { ticket: ticketFor('quiz-2'), answers: {} } });

    expect(res.statusCode).toBe(400);
  });

  it('answers 410 when time ran out, so the client can say so', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-05T12:00:00Z') });
    const ticket = ticketFor();
    vi.setSystemTime(new Date('2026-10-05T13:00:00Z'));

    const res = await call(submitQuiz, { body: { ticket, answers: {} } });

    vi.useRealTimers();
    expect(res.statusCode).toBe(410);
  });

  it('turns a second submission of the same ticket into 409, not a second attempt', async () => {
    txMock.quizAttempt.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' })
    );

    const res = await call(submitQuiz, { body: { ticket: ticketFor(), answers: { [Q1]: RIGHT } } });

    expect(res.statusCode).toBe(409);
  });

  it('rejects a malformed answer sheet before touching the database', async () => {
    const res = await call(submitQuiz, { body: { ticket: ticketFor(), answers: { 'not-a-cuid': 'x' } } });

    expect(res.statusCode).toBe(422);
    expect(prismaMock.quiz.findFirst).not.toHaveBeenCalled();
  });
});
