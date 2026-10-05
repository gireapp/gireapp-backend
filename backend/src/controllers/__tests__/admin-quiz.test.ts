import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { prismaMock, txMock, loggerMock } = vi.hoisted(() => {
  const txMock = { question: { deleteMany: vi.fn() }, quiz: { update: vi.fn() } };
  return {
    txMock,
    prismaMock: {
      quiz: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
      course: { findFirst: vi.fn() },
      $transaction: vi.fn(async (run: (tx: typeof txMock) => unknown) => run(txMock)),
    },
    loggerMock: { error: vi.fn(), security: vi.fn(), info: vi.fn(), warn: vi.fn() },
  };
});

vi.mock('../../services/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({ logger: loggerMock }));

import {
  createQuiz,
  getQuiz,
  listQuizzes,
  questionsChanged,
  updateQuiz,
} from '../admin-quiz.controller';

const COURSE_ID = 'cmqjfipmm000bgoe9mne7uzhp';
const ADMIN = { userId: 'admin-1', role: 'ADMIN' };
const TUTOR = { userId: 'tutor-1', role: 'TUTOR' };

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

function question(over: Record<string, unknown> = {}) {
  return {
    text: 'What is electromagnetic induction?',
    explanation: null,
    points: 5,
    choices: [
      { text: 'Current from a changing field', isCorrect: true },
      { text: 'Two magnets attracting', isCorrect: false },
    ],
    ...over,
  };
}

function saveBody(over: Record<string, unknown> = {}) {
  return {
    courseId: COURSE_ID,
    title: 'Physics - Electromagnetism Quiz',
    description: null,
    difficulty: 'INTERMEDIATE',
    timeLimitMin: 30,
    passingScore: 70,
    publish: false,
    questions: [question()],
    ...over,
  };
}

function storedQuiz(over: Record<string, unknown> = {}) {
  return {
    id: 'quiz-1',
    courseId: COURSE_ID,
    title: 'Physics - Electromagnetism Quiz',
    description: null,
    difficulty: 'INTERMEDIATE',
    timeLimitMin: 30,
    passingScore: 70,
    published: false,
    questions: [question()],
    _count: { attempts: 0 },
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    ...over,
  };
}

async function call(
  handler: (req: Request, res: Response) => Promise<void>,
  { body, params = {}, user = ADMIN }: { body?: unknown; params?: object; user?: object }
) {
  const res = buildRes();
  await handler({ body, params, user } as unknown as Request, res as unknown as Response);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.course.findFirst.mockResolvedValue({ id: COURSE_ID });
  prismaMock.quiz.findFirst.mockResolvedValue(storedQuiz());
  prismaMock.quiz.create.mockImplementation(async () => storedQuiz());
  txMock.quiz.update.mockImplementation(async () => storedQuiz());
});

describe('questionsChanged', () => {
  it('is false when only the stored and incoming shapes differ, not the content', () => {
    expect(questionsChanged([question()], [question({ explanation: undefined })])).toBe(false);
  });

  it('notices an edited question, a re-marked answer and re-weighted points', () => {
    expect(questionsChanged([question()], [question({ text: 'Something else entirely?' })])).toBe(true);
    expect(questionsChanged([question()], [question({ points: 10 })])).toBe(true);
    expect(
      questionsChanged(
        [question()],
        [
          question({
            choices: [
              { text: 'Current from a changing field', isCorrect: false },
              { text: 'Two magnets attracting', isCorrect: true },
            ],
          }),
        ]
      )
    ).toBe(true);
  });

  it('notices reordering, since order is position in the array', () => {
    const first = question({ text: 'First question here?' });
    const second = question({ text: 'Second question here?' });
    expect(questionsChanged([first, second], [second, first])).toBe(true);
  });
});

describe('createQuiz', () => {
  it('saves an incomplete draft — that is what a draft is for', async () => {
    const res = await call(createQuiz, {
      body: saveBody({ difficulty: null, questions: [question({ text: '', choices: [{ text: '', isCorrect: false }, { text: '', isCorrect: false }] })] }),
    });

    expect(res.statusCode).toBe(201);
  });

  it('refuses to publish a quiz a learner could not complete, naming the question', async () => {
    const res = await call(createQuiz, {
      body: saveBody({
        publish: true,
        questions: [
          question(),
          question({ choices: [{ text: 'A', isCorrect: false }, { text: 'B', isCorrect: false }] }),
        ],
      }),
    });

    expect(res.statusCode).toBe(422);
    expect((res.body as { errors: Record<string, string[]> }).errors).toEqual({
      'questions.1.choices': ['Mark exactly one correct answer for question 2'],
    });
    expect(prismaMock.quiz.create).not.toHaveBeenCalled();
  });

  it('stores question and answer order from array position, not client fields', async () => {
    await call(createQuiz, { body: saveBody({ questions: [question(), question({ text: 'Second question here?' })] }) });

    const created = prismaMock.quiz.create.mock.calls[0]?.[0];
    if (!created) throw new Error('quiz.create was not called');
    expect(created.data.questions.create.map((q: { order: number }) => q.order)).toEqual([0, 1]);
    expect(
      created.data.questions.create[0].choices.create.map((c: { order: number }) => c.order)
    ).toEqual([0, 1]);
  });

  it('keeps SQL and apostrophes in question text exactly as typed', async () => {
    const text = "What does SELECT * FROM users WHERE name = 'Ada' return?";
    await call(createQuiz, { body: saveBody({ questions: [question({ text })] }) });

    const created = prismaMock.quiz.create.mock.calls[0]?.[0];
    if (!created) throw new Error('quiz.create was not called');
    expect(created.data.questions.create[0].text).toBe(text);
  });

  it('rejects a course outside the caller’s scope without creating anything', async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);

    const res = await call(createQuiz, { body: saveBody(), user: TUTOR });

    expect(res.statusCode).toBe(422);
    expect(prismaMock.quiz.create).not.toHaveBeenCalled();
  });

  it('limits a tutor to courses they authored', async () => {
    await call(createQuiz, { body: saveBody(), user: TUTOR });

    const where = prismaMock.course.findFirst.mock.calls[0]?.[0].where;
    expect(where).toMatchObject({ createdById: 'tutor-1', deletedAt: null });
  });

  it('does not narrow an admin to their own courses', async () => {
    await call(createQuiz, { body: saveBody() });

    const where = prismaMock.course.findFirst.mock.calls[0]?.[0].where;
    expect(where).not.toHaveProperty('createdById');
  });
});

describe('getQuiz and listQuizzes', () => {
  it('answers 404 for a quiz outside the caller’s scope, not 403', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue(null);

    const res = await call(getQuiz, { params: { quizId: 'quiz-1' }, user: TUTOR });

    expect(res.statusCode).toBe(404);
  });

  it('returns correct answers and the attempt count to staff', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue(storedQuiz({ _count: { attempts: 3 } }));

    const res = await call(getQuiz, { params: { quizId: 'quiz-1' } });

    expect(res.body).toMatchObject({
      success: true,
      data: { attemptCount: 3, questions: [{ choices: [{ isCorrect: true }, { isCorrect: false }] }] },
    });
  });

  it('lists only quizzes in courses the tutor authored', async () => {
    prismaMock.quiz.findMany.mockResolvedValue([]);

    await call(listQuizzes, { user: TUTOR });

    expect(prismaMock.quiz.findMany.mock.calls[0]?.[0].where).toEqual({
      course: { deletedAt: null, createdById: 'tutor-1' },
    });
  });
});

describe('updateQuiz', () => {
  it('leaves questions alone on a settings-only save, so their ids stay stable', async () => {
    await call(updateQuiz, { params: { quizId: 'quiz-1' }, body: saveBody({ title: 'Renamed quiz' }) });

    expect(txMock.question.deleteMany).not.toHaveBeenCalled();
    expect(txMock.quiz.update.mock.calls[0]?.[0].data).not.toHaveProperty('questions');
  });

  it('replaces the questions when they changed', async () => {
    await call(updateQuiz, {
      params: { quizId: 'quiz-1' },
      body: saveBody({ questions: [question({ text: 'A completely new question?' })] }),
    });

    expect(txMock.question.deleteMany).toHaveBeenCalledWith({ where: { quizId: 'quiz-1' } });
    expect(txMock.quiz.update.mock.calls[0]?.[0].data.questions.create).toHaveLength(1);
  });

  it('refuses to change the questions of a quiz learners have already sat', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue(storedQuiz({ _count: { attempts: 2 } }));

    const res = await call(updateQuiz, {
      params: { quizId: 'quiz-1' },
      body: saveBody({ questions: [question({ text: 'A completely new question?' })] }),
    });

    expect(res.statusCode).toBe(409);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('still lets settings change on a quiz with attempts, e.g. unpublishing it', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue(storedQuiz({ published: true, _count: { attempts: 2 } }));

    const res = await call(updateQuiz, { params: { quizId: 'quiz-1' }, body: saveBody({ publish: false }) });

    expect(res.statusCode).toBe(200);
    expect(txMock.quiz.update.mock.calls[0]?.[0].data.published).toBe(false);
  });

  it('checks the new course is in scope when a quiz is moved', async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);

    const res = await call(updateQuiz, {
      params: { quizId: 'quiz-1' },
      body: saveBody({ courseId: 'cmqjfipmm000bgoe9mne7zzzz' }),
      user: TUTOR,
    });

    expect(res.statusCode).toBe(422);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('answers 404 for a quiz the caller cannot see', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue(null);

    const res = await call(updateQuiz, { params: { quizId: 'nope' }, body: saveBody() });

    expect(res.statusCode).toBe(404);
  });
});
