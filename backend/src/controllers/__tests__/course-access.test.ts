import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { prismaMock, loggerMock } = vi.hoisted(() => ({
  prismaMock: {
    course: { findFirst: vi.fn(), findMany: vi.fn() },
    enrolment: { upsert: vi.fn() },
  },
  loggerMock: { error: vi.fn(), security: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../services/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({ logger: loggerMock }));

import { enrolInCourse, getCourse, getLesson, listCourses } from '../course.controller';

const LEARNER = {
  userId: 'learner-1',
  role: 'STUDENT',
  academicLevel: 'SECONDARY',
  department: 'Science',
};
const ADMIN = { userId: 'admin-1', role: 'ADMIN', academicLevel: null, department: null };

const LEARNER_SCOPE = { academicLevel: 'SECONDARY', department: 'Science' };
const LEARNER_ENROLMENTS = { enrolments: { some: { userId: 'learner-1' } } };
const OPEN_TO_LEARNER = { OR: [LEARNER_SCOPE, LEARNER_ENROLMENTS] };

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
  { user = LEARNER, query = {} }: { user?: object; query?: object } = {}
) {
  const res = buildRes();
  const params = { courseId: 'course-1', lessonId: 'lesson-1' };
  await handler({ params, query, user } as unknown as Request, res as unknown as Response);
  return res;
}

const whereOf = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls[0]?.[0].where;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.course.findFirst.mockResolvedValue(null);
  prismaMock.course.findMany.mockResolvedValue([]);
});

describe('getCourse', () => {
  it("only finds courses open to the learner, and answers 404 for another track's", async () => {
    const res = await call(getCourse);

    expect(whereOf(prismaMock.course.findFirst)).toEqual({
      id: 'course-1',
      published: true,
      deletedAt: null,
      AND: [OPEN_TO_LEARNER],
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('enrolInCourse', () => {
  it("refuses another track's course with 404 and creates no enrolment", async () => {
    const res = await call(enrolInCourse);

    expect(whereOf(prismaMock.course.findFirst)).toEqual({
      id: 'course-1',
      published: true,
      deletedAt: null,
      AND: [LEARNER_SCOPE],
    });
    expect(res.statusCode).toBe(404);
    expect(prismaMock.enrolment.upsert).not.toHaveBeenCalled();
  });
});

describe('listCourses', () => {
  it("ignores a learner's level and department parameters", async () => {
    await call(listCourses, { query: { level: 'TERTIARY', department: 'Law' } });

    expect(whereOf(prismaMock.course.findMany)).toEqual({
      published: true,
      deletedAt: null,
      AND: [OPEN_TO_LEARNER],
    });
  });

  it('lets an admin narrow the list by level and department', async () => {
    await call(listCourses, { user: ADMIN, query: { level: 'TERTIARY', department: 'Law' } });

    expect(whereOf(prismaMock.course.findMany)).toEqual({
      published: true,
      deletedAt: null,
      AND: [{ OR: [{}, { enrolments: { some: { userId: 'admin-1' } } }] }],
      academicLevel: 'TERTIARY',
      department: 'Law',
    });
  });

  it('still rejects an unknown level from staff', async () => {
    const res = await call(listCourses, { user: ADMIN, query: { level: 'NURSERY' } });

    expect(res.statusCode).toBe(422);
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });
});

describe('getLesson', () => {
  it('requires a learner to be enrolled, in a course that is neither draft nor deleted', async () => {
    const res = await call(getLesson);

    expect(whereOf(prismaMock.course.findFirst)).toEqual({
      id: 'course-1',
      published: true,
      deletedAt: null,
      AND: [LEARNER_ENROLMENTS],
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets an admin preview a lesson without enrolling', async () => {
    prismaMock.course.findFirst.mockResolvedValue({
      modules: [
        {
          id: 'module-1',
          lessons: [
            { id: 'lesson-1', moduleId: 'module-1', mediaUrl: null, progress: [] },
          ],
        },
      ],
    });

    const res = await call(getLesson, { user: ADMIN });

    expect(whereOf(prismaMock.course.findFirst).AND).toEqual([{}]);
    expect(res.statusCode).toBe(200);
  });
});
