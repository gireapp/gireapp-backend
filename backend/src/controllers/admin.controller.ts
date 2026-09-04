import { Request, Response } from 'express';
import { createCourseSchema } from '@gireapp/shared';
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
} from '../services/storage';

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
