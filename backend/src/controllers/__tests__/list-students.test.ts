import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { prismaMock, loggerMock, storageMock } = vi.hoisted(() => ({
  prismaMock: { user: { count: vi.fn(), findMany: vi.fn() } },
  loggerMock: { error: vi.fn(), security: vi.fn(), info: vi.fn(), warn: vi.fn() },
  storageMock: {
    resolveAvatarUrl: vi.fn(async (image: string | null) => image),
    isStorageConfigured: vi.fn(() => true),
    isAllowedUpload: vi.fn(),
    isMintedObjectKey: vi.fn(),
    allowedUploadExtensions: vi.fn(() => []),
    createUploadUrl: vi.fn(),
  },
}));

vi.mock('../../services/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({ logger: loggerMock }));
vi.mock('../../services/storage', () => storageMock);

import { listStudents } from '../admin.controller';

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

type TestRes = ReturnType<typeof buildRes>;

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stu-1',
    name: 'Afolabi Hassan',
    email: 'afolabi@example.com',
    image: null,
    academicLevel: 'PROFESSIONAL',
    deletedAt: null,
    emailVerified: new Date(),
    enrolments: [{ progress: 0.89, course: { id: 'course-1', title: 'Data Analytics' } }],
    ...overrides,
  };
}

async function callListStudents(query: Record<string, string>) {
  const res = buildRes();
  await listStudents(
    { query, user: { userId: 'admin-1', role: 'ADMIN' } } as unknown as Request,
    res as unknown as Response
  );
  return res as TestRes;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.count.mockResolvedValue(1);
  prismaMock.user.findMany.mockResolvedValue([buildUser()]);
});

describe('listStudents', () => {
  it('returns a paginated envelope with progress as a percentage', async () => {
    const res = await callListStudents({});

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: [
        {
          id: 'stu-1',
          status: 'ACTIVE',
          course: { id: 'course-1', title: 'Data Analytics' },
          progress: 89,
        },
      ],
      meta: { page: 1, total: 1, totalPages: 1 },
    });
  });

  it('never lists staff accounts', async () => {
    await callListStudents({});

    const call = prismaMock.user.findMany.mock.calls[0];
    if (!call) throw new Error('findMany was not called');
    expect(call[0].where.role).toBe('STUDENT');
  });

  it('derives PENDING from an unverified account and INACTIVE from a soft-deleted one', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      buildUser({ id: 'a', emailVerified: null }),
      buildUser({ id: 'b', deletedAt: new Date() }),
    ]);

    const res = await callListStudents({});
    const { data } = res.body as { data: { status: string }[] };

    expect(data.map((student) => student.status)).toEqual(['PENDING', 'INACTIVE']);
  });

  it('omits the course and progress for a student with no enrolment', async () => {
    prismaMock.user.findMany.mockResolvedValue([buildUser({ enrolments: [] })]);

    const res = await callListStudents({});
    const { data } = res.body as { data: { course: unknown; progress: unknown }[] };

    expect(data[0]).toMatchObject({ course: null, progress: null });
  });

  it('searches name and email case-insensitively', async () => {
    await callListStudents({ search: '  Favor  ' });

    const call = prismaMock.user.findMany.mock.calls[0];
    if (!call) throw new Error('findMany was not called');
    expect(call[0].where.OR).toEqual([
      { name: { contains: 'Favor', mode: 'insensitive' } },
      { email: { contains: 'Favor', mode: 'insensitive' } },
    ]);
  });

  it('restricts the loaded enrolment to the filtered course', async () => {
    await callListStudents({ courseId: 'cmf0000000000000000000000' });

    const call = prismaMock.user.findMany.mock.calls[0];
    if (!call) throw new Error('findMany was not called');
    expect(call[0].where.enrolments).toEqual({
      some: { courseId: 'cmf0000000000000000000000' },
    });
    expect(call[0].select.enrolments.where).toEqual({ courseId: 'cmf0000000000000000000000' });
  });

  it('rejects a page size beyond the shared maximum', async () => {
    const res = await callListStudents({ limit: '5000' });

    expect(res.statusCode).toBe(422);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('reports at least one page when no student matches', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);

    const res = await callListStudents({});
    const { meta } = res.body as { meta: { totalPages: number } };

    expect(meta.totalPages).toBe(1);
  });
});
