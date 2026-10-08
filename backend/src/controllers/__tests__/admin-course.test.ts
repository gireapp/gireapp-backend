import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { saveCourseSchema } from '@gireapp/shared';

const { prismaMock, txMock, loggerMock } = vi.hoisted(() => {
  const txMock = {
    lesson: { deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    module: { update: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    course: { update: vi.fn() },
    $executeRaw: vi.fn(),
  };
  return {
    txMock,
    prismaMock: {
      course: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
      $transaction: vi.fn(async (run: (tx: typeof txMock) => unknown) => run(txMock)),
    },
    loggerMock: { error: vi.fn(), security: vi.fn(), info: vi.fn(), warn: vi.fn() },
  };
});

vi.mock('../../services/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({ logger: loggerMock }));

import {
  checkStructure,
  createCourse,
  getCourseForEditing,
  listCourses,
  mediaProblem,
  updateCourse,
} from '../admin-course.controller';
import { buildObjectKey } from '../../services/storage';

const ADMIN = { userId: 'admin-1', role: 'ADMIN' };
const TUTOR = { userId: 'tutor-1', role: 'TUTOR' };
const MODULE_ID = 'cmmodule0000000000000001';
const LESSON_A = 'cmlesson0000000000000001';
const LESSON_B = 'cmlesson0000000000000002';

function lesson(over: Record<string, unknown> = {}) {
  return { title: 'Velocity', contentType: 'MARKDOWN', content: '# Velocity', mediaUrl: null, estimatedMinutes: 10, ...over };
}

function body(over: Record<string, unknown> = {}) {
  return {
    title: 'Foundations of Physics',
    description: 'Motion, forces and energy for secondary students.',
    academicLevel: 'SECONDARY',
    department: 'Science',
    publish: false,
    modules: [{ title: 'Kinematics', lessons: [lesson()] }],
    ...over,
  };
}

function stored(over: Record<string, unknown> = {}) {
  return {
    id: 'course-1',
    title: 'Foundations of Physics',
    description: 'Motion, forces and energy for secondary students.',
    academicLevel: 'SECONDARY',
    department: 'Science',
    published: false,
    createdById: 'admin-1',
    updatedAt: new Date('2026-10-05T12:00:00Z'),
    _count: { enrolments: 0 },
    modules: [
      {
        id: MODULE_ID,
        title: 'Kinematics',
        order: 0,
        lessons: [
          { id: LESSON_A, title: 'Velocity', contentType: 'MARKDOWN', content: '# Velocity', mediaUrl: null, estimatedMinutes: 10, order: 0, _count: { progress: 0 } },
          { id: LESSON_B, title: 'Acceleration', contentType: 'TEXT', content: 'a = dv/dt', mediaUrl: null, estimatedMinutes: 10, order: 1, _count: { progress: 0 } },
        ],
      },
    ],
    ...over,
  };
}

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
  { body: reqBody, user = ADMIN, courseId = 'course-1' }: { body?: unknown; user?: object; courseId?: string }
) {
  const res = buildRes();
  await handler({ body: reqBody, params: { courseId }, user } as unknown as Request, res as unknown as Response);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.course.findFirst.mockResolvedValue(stored());
  prismaMock.course.create.mockResolvedValue(stored());
  txMock.module.update.mockResolvedValue({ id: MODULE_ID });
  txMock.module.create.mockResolvedValue({ id: 'cmmodule0000000000000099' });
  txMock.course.update.mockResolvedValue(stored());
});

describe('saveCourseSchema', () => {
  it('saves an incomplete draft', () => {
    expect(saveCourseSchema.safeParse(body({ description: '', modules: [] })).success).toBe(true);
  });

  it('refuses to publish a course with an empty lesson or a missing file, naming each', () => {
    const result = saveCourseSchema.safeParse(
      body({
        publish: true,
        modules: [{ title: 'Kinematics', lessons: [lesson({ content: '  ' }), lesson({ contentType: 'PDF', content: null })] }],
      })
    );

    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(['modules.0.lessons.0.content', 'modules.0.lessons.1.mediaUrl']);
  });

  it('rejects a department from another track, since learners would never see the course', () => {
    const result = saveCourseSchema.safeParse(body({ academicLevel: 'TERTIARY', department: 'Science' }));

    expect(result.success).toBe(false);
  });
});

describe('mediaProblem', () => {
  const existing = { id: LESSON_A, moduleId: MODULE_ID, title: 'Notes', mediaUrl: '/sample-lesson.pdf', hasProgress: false };

  it('accepts a freshly minted key of the right type', () => {
    expect(mediaProblem(lesson({ contentType: 'PDF', mediaUrl: buildObjectKey('notes.pdf') }) as never, undefined)).toBeNull();
  });

  it('accepts a lesson’s existing link left unchanged, such as the seeded static PDF', () => {
    expect(mediaProblem(lesson({ id: LESSON_A, contentType: 'PDF', mediaUrl: '/sample-lesson.pdf' }) as never, existing)).toBeNull();
  });

  it('rejects any other link — only uploads this server minted may be stored', () => {
    expect(mediaProblem(lesson({ contentType: 'PDF', mediaUrl: 'https://evil.example/x.pdf' }) as never, undefined)).toMatch(/Upload/);
  });

  it('rejects a video file on a PDF lesson', () => {
    expect(mediaProblem(lesson({ contentType: 'PDF', mediaUrl: buildObjectKey('clip.mp4') }) as never, undefined)).toMatch(/\.pdf/);
  });
});

describe('checkStructure', () => {
  const existing = new Map([
    [LESSON_A, { id: LESSON_A, moduleId: MODULE_ID, title: 'Velocity', mediaUrl: null, hasProgress: true }],
    [LESSON_B, { id: LESSON_B, moduleId: MODULE_ID, title: 'Acceleration', mediaUrl: null, hasProgress: false }],
  ]);
  const modules = new Set([MODULE_ID]);
  const input = (lessonIds: string[]) =>
    saveCourseSchema.parse(body({ modules: [{ id: MODULE_ID, title: 'K', lessons: lessonIds.map((id) => lesson({ id })) }] }));

  it('lets a lesson nobody has completed be removed', () => {
    expect(() => checkStructure(input([LESSON_A]), modules, existing)).not.toThrow();
  });

  it('refuses to remove a lesson a learner has completed, naming it', () => {
    expect(() => checkStructure(input([LESSON_B]), modules, existing)).toThrow(/"Velocity"/);
  });

  it('refuses a lesson id from another course', () => {
    expect(() => checkStructure(input([LESSON_A, 'cmlesson0000000000000999']), modules, existing)).toThrow(/does not belong/);
  });

  it('refuses the same lesson listed twice', () => {
    expect(() => checkStructure(input([LESSON_A, LESSON_A, LESSON_B]), modules, existing)).toThrow(/does not belong/);
  });
});

describe('createCourse', () => {
  it('stores apostrophes and quoted SQL exactly as typed', async () => {
    const content = "SELECT * FROM users WHERE name = 'Ada'; -- Ohm's law";
    await call(createCourse, { body: body({ title: "Ohm's Law & Circuits", modules: [{ title: 'M', lessons: [lesson({ content })] }] }) });

    const data = prismaMock.course.create.mock.calls[0]?.[0].data;
    expect(data.title).toBe("Ohm's Law & Circuits");
    expect(data.modules.create[0].lessons.create[0].content).toBe(content);
  });

  it('records who wrote the course and orders modules and lessons by position', async () => {
    await call(createCourse, {
      body: body({ modules: [{ title: 'One', lessons: [lesson(), lesson()] }, { title: 'Two', lessons: [] }] }),
      user: TUTOR,
    });

    const data = prismaMock.course.create.mock.calls[0]?.[0].data;
    expect(data.createdById).toBe('tutor-1');
    expect(data.modules.create.map((m: { order: number }) => m.order)).toEqual([0, 1]);
    expect(data.modules.create[0].lessons.create.map((l: { order: number }) => l.order)).toEqual([0, 1]);
  });

  it('keeps only the field matching the lesson type', async () => {
    await call(createCourse, {
      body: body({ modules: [{ title: 'M', lessons: [lesson({ contentType: 'PDF', content: 'stray text', mediaUrl: buildObjectKey('a.pdf') })] }] }),
    });

    const created = prismaMock.course.create.mock.calls[0]?.[0].data.modules.create[0].lessons.create[0];
    expect(created.content).toBeNull();
    expect(created.mediaUrl).toMatch(/^lessons\//);
  });

  it('refuses a new course that reuses existing lesson ids', async () => {
    const res = await call(createCourse, { body: body({ modules: [{ title: 'M', lessons: [lesson({ id: LESSON_A })] }] }) });

    expect(res.statusCode).toBe(422);
    expect(prismaMock.course.create).not.toHaveBeenCalled();
  });
});

describe('updateCourse', () => {
  it('keeps a lesson’s id when it is edited, so learners keep their progress', async () => {
    await call(updateCourse, {
      body: body({ modules: [{ id: MODULE_ID, title: 'Kinematics', lessons: [lesson({ id: LESSON_A, title: 'Velocity, revised' }), lesson({ id: LESSON_B })] }] }),
    });

    expect(txMock.lesson.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: LESSON_A }, data: expect.objectContaining({ title: 'Velocity, revised', order: 0 }) })
    );
    expect(txMock.lesson.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [] } } });
  });

  it('writes nothing for lessons and modules that did not change', async () => {
    await call(updateCourse, {
      body: body({
        modules: [
          {
            id: MODULE_ID,
            title: 'Kinematics',
            lessons: [lesson({ id: LESSON_A }), lesson({ id: LESSON_B, title: 'Acceleration', contentType: 'TEXT', content: 'a = dv/dt' })],
          },
        ],
      }),
    });

    expect(txMock.module.update).not.toHaveBeenCalled();
    expect(txMock.lesson.update).not.toHaveBeenCalled();
    expect(txMock.lesson.create).not.toHaveBeenCalled();
  });

  it('accepts hand-written ids on existing rows, as some seeded lessons have', async () => {
    const seeded = stored();
    seeded.modules[0]!.lessons[1]!.id = 'lesson-text-fixture';
    prismaMock.course.findFirst.mockResolvedValue(seeded);

    const res = await call(updateCourse, {
      body: body({ modules: [{ id: MODULE_ID, title: 'Kinematics', lessons: [lesson({ id: LESSON_A }), lesson({ id: 'lesson-text-fixture' })] }] }),
    });

    expect(res.statusCode).toBe(200);
  });

  it('deletes a lesson dropped from the course and adds a new one', async () => {
    await call(updateCourse, {
      body: body({ modules: [{ id: MODULE_ID, title: 'Kinematics', lessons: [lesson({ id: LESSON_A }), lesson({ title: 'Momentum' })] }] }),
    });

    expect(txMock.lesson.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [LESSON_B] } } });
    expect(txMock.lesson.create).toHaveBeenCalledWith({ data: expect.objectContaining({ title: 'Momentum', order: 1, moduleId: MODULE_ID }) });
  });

  it('refuses to drop a lesson learners have completed', async () => {
    const withProgress = stored();
    withProgress.modules[0]!.lessons[1]!._count.progress = 3;
    prismaMock.course.findFirst.mockResolvedValue(withProgress);

    const res = await call(updateCourse, {
      body: body({ modules: [{ id: MODULE_ID, title: 'Kinematics', lessons: [lesson({ id: LESSON_A })] }] }),
    });

    expect(res.statusCode).toBe(409);
    expect((res.body as { error: string }).error).toMatch(/"Acceleration"/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('recomputes every enrolment’s progress after changing the structure', async () => {
    await call(updateCourse, { body: body({ modules: [{ id: MODULE_ID, title: 'K', lessons: [lesson({ id: LESSON_A }), lesson({ id: LESSON_B })] }] }) });

    expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for a course a tutor did not write', async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);

    const res = await call(updateCourse, { body: body(), user: TUTOR });

    expect(res.statusCode).toBe(404);
    expect(prismaMock.course.findFirst.mock.calls[0]?.[0].where).toMatchObject({ createdById: 'tutor-1' });
  });
});

describe('listCourses and getCourseForEditing', () => {
  it('marks only the tutor’s own courses as editable', async () => {
    prismaMock.course.findMany.mockResolvedValue([
      { ...stored(), id: 'mine', createdById: 'tutor-1', modules: [{ _count: { lessons: 2 } }], _count: { modules: 1, quizzes: 0, enrolments: 0 } },
      { ...stored(), id: 'theirs', createdById: 'admin-1', modules: [], _count: { modules: 0, quizzes: 0, enrolments: 4 } },
    ]);

    const res = await call(listCourses, { user: TUTOR });

    expect(res.body).toMatchObject({
      data: [
        { id: 'mine', canEdit: true, lessonCount: 2 },
        { id: 'theirs', canEdit: false, enrolmentCount: 4 },
      ],
    });
  });

  it('flags lessons with progress so the builder can lock their removal', async () => {
    const withProgress = stored();
    withProgress.modules[0]!.lessons[0]!._count.progress = 1;
    prismaMock.course.findFirst.mockResolvedValue(withProgress);

    const res = await call(getCourseForEditing, {});

    expect(res.body).toMatchObject({
      data: { modules: [{ lessons: [{ id: LESSON_A, hasProgress: true }, { id: LESSON_B, hasProgress: false }] }] },
    });
  });
});
