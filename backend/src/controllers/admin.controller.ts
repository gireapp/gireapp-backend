import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createCourseSchema } from '@gireapp/shared';
import { prisma } from '../services/prisma';
import { sanitizeObject, detectThreatsInBody } from '../utils/sanitize';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

/** BE-ADMIN-003: presigned PUT links expire in 15 minutes. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/** Only lesson media — anything else is rejected with 415. */
const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

export function isAllowedUpload(filename: string): boolean {
  return extensionOf(filename) in ALLOWED_UPLOAD_TYPES;
}

/**
 * Namespaced by a UUID so two tutors uploading `notes.pdf` never collide, and a
 * guessed key can't reach someone else's object.
 */
export function buildObjectKey(filename: string): string {
  return `lessons/${randomUUID()}${extensionOf(filename)}`;
}

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
        error: `Unsupported file type. Allowed: ${Object.keys(ALLOWED_UPLOAD_TYPES).join(', ')}`,
      });
      return;
    }

    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_REGION;
    const hasCredentials = Boolean(
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    );

    // Missing config is an environment problem, not a server fault — 503 says
    // "not wired up here" rather than burying it in a generic 500.
    if (!bucket || !region || !hasCredentials) {
      logger.error('Upload URL requested but S3 is not configured', {
        hasBucket: Boolean(bucket),
        hasRegion: Boolean(region),
        hasCredentials,
      });
      res.status(503).json({ error: 'File uploads are not configured on this environment.' });
      return;
    }

    const key = buildObjectKey(filename);
    const s3 = new S3Client({ region });

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: ALLOWED_UPLOAD_TYPES[extensionOf(filename)],
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS }
    );

    res.status(200).json({
      success: true,
      data: { uploadUrl, key, expiresInSeconds: UPLOAD_URL_TTL_SECONDS },
    });
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
    const key = typeof req.body?.key === 'string' ? req.body.key : '';

    if (!key.startsWith('lessons/')) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: { key: ['key must be an object key returned by /upload-url'] },
      });
      return;
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true },
    });

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
