import { Request, Response } from 'express';
import {
  createCourseSchema,
  studentListQuerySchema,
  type StudentListItem,
  type StudentStatus,
} from '@gireapp/shared';
import { prisma } from '../services/prisma';
import { sanitizeObject, detectThreatsInBody } from '../utils/sanitize';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';
import {
  allowedUploadExtensions,
  createUploadUrl,
  isAllowedUpload,
  isMintedObjectKey,
  isStorageConfigured,
  resolveAvatarUrl,
} from '../services/storage';
import type { Prisma } from '@prisma/client';

export const createCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const threats = detectThreatsInBody(req.body);
    if (threats.length > 0) {
      logger.security('Course creation blocked — threat detected', {
        threats,
        userId: (req as AuthenticatedRequest).user?.userId,
        ip: req.ip,
      });
      res.status(400).json({ error: 'Request blocked due to suspicious input.' });
      return;
    }

    const result = createCourseSchema.safeParse(sanitizeObject(req.body));
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { modules, ...course } = result.data;
    const createdById = (req as AuthenticatedRequest).user.userId;

    // One transaction: a course must never land without its modules and lessons.
    const created = await prisma.course.create({
      data: {
        ...course,
        createdById,
        modules: {
          create: modules.map((module) => ({
            title: module.title,
            order: module.order,
            lessons: { create: module.lessons },
          })),
        },
      },
      select: { id: true, title: true, published: true },
    });

    logger.info('Course created', { courseId: created.id, createdById });

    res.status(201).json({ success: true, data: { courseId: created.id } });
  } catch (error) {
    logger.error('Create course error', {
      errorMessage: (error as Error).message,
      userId: (req as AuthenticatedRequest).user?.userId,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

export const getUploadUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const filename = typeof req.query.filename === 'string' ? req.query.filename : '';

    if (!filename) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: { filename: ['filename query parameter is required'] },
      });
      return;
    }

    if (!isAllowedUpload(filename)) {
      res.status(415).json({
        error: `Unsupported file type. Allowed: ${allowedUploadExtensions().join(', ')}`,
      });
      return;
    }

    // Missing config is an environment problem, not a server fault — 503 says
    // "not wired up here" rather than burying it in a generic 500.
    if (!isStorageConfigured()) {
      logger.error('Upload URL requested but R2 is not configured');
      res.status(503).json({ error: 'File uploads are not configured on this environment.' });
      return;
    }

    const data = await createUploadUrl(filename);
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Upload URL error', { errorMessage: (error as Error).message });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

/**
 * BE-ADMIN-003 criterion 4 — the browser uploads straight to S3, so the server
 * only learns the object key once the client reports back.
 */
export const attachLessonMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const { lessonId } = req.params as { lessonId: string };
    const user = (req as AuthenticatedRequest).user;
    const key = typeof req.body?.key === 'string' ? req.body.key : '';

    if (!isMintedObjectKey(key)) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: { key: ['key must be an object key returned by /upload-url'] },
      });
      return;
    }

    // A tutor may only re-point media on a lesson in a course they authored;
    // admins may touch any. Without this, one tutor could swap an admin's
    // lesson PDF for their own file, which is then signed and served to every
    // enrolled learner from the app's own storage.
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: lessonId,
        ...(user.role === 'ADMIN'
          ? {}
          : { module: { course: { createdById: user.userId } } }),
      },
      select: { id: true },
    });

    // Deliberately 404 rather than 403: a tutor should not be able to probe
    // which lesson ids exist in courses that are not theirs.
    if (!lesson) {
      res.status(404).json({ error: 'Lesson not found.' });
      return;
    }

    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data: { mediaUrl: key },
      select: { id: true, mediaUrl: true },
    });

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    logger.error('Attach lesson media error', {
      errorMessage: (error as Error).message,
      lessonId: req.params.lessonId,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

// ─────────────────────────────────────────────────
// Student listing (BE-ADMIN-005)
// ─────────────────────────────────────────────────

const PROGRESS_PERCENT = 100;

/**
 * Status is not a stored column — a soft-deleted account is inactive and an
 * unverified one is still pending, so both the projection below and the
 * `status` filter derive it from the same two columns.
 */
const STATUS_FILTERS: Record<StudentStatus, Prisma.UserWhereInput> = {
  ACTIVE: { deletedAt: null, emailVerified: { not: null } },
  PENDING: { deletedAt: null, emailVerified: null },
  INACTIVE: { deletedAt: { not: null } },
};

function deriveStatus(user: { deletedAt: Date | null; emailVerified: Date | null }): StudentStatus {
  if (user.deletedAt) return 'INACTIVE';
  return user.emailVerified ? 'ACTIVE' : 'PENDING';
}

export const listStudents = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = studentListQuerySchema.safeParse(req.query);
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { search, courseId, academicLevel, status, page, limit } = result.data;

    const where: Prisma.UserWhereInput = {
      role: 'STUDENT',
      ...(status ? STATUS_FILTERS[status] : {}),
      ...(academicLevel ? { academicLevel } : {}),
      ...(courseId ? { enrolments: { some: { courseId } } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          academicLevel: true,
          deletedAt: true,
          emailVerified: true,
          // One row per student in the design, so only the enrolment the
          // learner touched most recently is loaded. Prisma resolves this as a
          // single extra query for the whole page, not one per student.
          enrolments: {
            ...(courseId ? { where: { courseId } } : {}),
            orderBy: { updatedAt: 'desc' },
            take: 1,
            select: {
              progress: true,
              course: { select: { id: true, title: true } },
            },
          },
        },
      }),
    ]);

    const data: StudentListItem[] = await Promise.all(
      users.map(async (user) => {
        const enrolment = user.enrolments[0] ?? null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: await resolveAvatarUrl(user.image),
          academicLevel: user.academicLevel,
          status: deriveStatus(user),
          course: enrolment ? enrolment.course : null,
          progress: enrolment ? Math.round(enrolment.progress * PROGRESS_PERCENT) : null,
        };
      })
    );

    res.status(200).json({
      success: true,
      data,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    logger.error('List students error', {
      errorMessage: (error as Error).message,
      userId: (req as AuthenticatedRequest).user?.userId,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

/**
 * Every course, unpublished and all, as `{ id, title, academicLevel }` — the
 * options behind the course filters and the quiz builder's subject picker,
 * which narrows them by track. Deliberately not `GET /api/courses`,
 * which narrows to what the *caller* may study and hides drafts.
 */
export const listCourseOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const courses = await prisma.course.findMany({
      where: { deletedAt: null },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, academicLevel: true },
    });

    res.status(200).json({ success: true, data: courses });
  } catch (error) {
    logger.error('List course options error', {
      errorMessage: (error as Error).message,
      userId: (req as AuthenticatedRequest).user?.userId,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};
