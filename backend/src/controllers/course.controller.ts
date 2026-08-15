import { Request, Response } from 'express';
import { prisma } from '../services/prisma';
import { logger } from '../utils/logger';
import { createDownloadUrl, isObjectKey, isStorageConfigured } from '../services/storage';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import type { BadgeType, AcademicLevel, CourseListItem } from '@gireapp/shared';
import { ACADEMIC_LEVELS } from '@gireapp/shared';

export const getLesson = async (req: Request, res: Response): Promise<void> => {
  try {
    const { courseId, lessonId } = req.params as { courseId: string; lessonId: string };
    const userId = (req as AuthenticatedRequest).user?.userId;

    if (!userId || !courseId || !lessonId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Verify enrolment
    const enrolment = await prisma.enrolment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      include: {
        course: {
          include: {
            modules: {
              orderBy: { order: 'asc' },
              include: {
                lessons: {
                  orderBy: { order: 'asc' },
                  include: {
                    progress: { where: { userId } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!enrolment || !enrolment.course.published) {
      res.status(403).json({ error: 'Not enrolled or course not published' });
      return;
    }

    const allLessons = enrolment.course.modules.flatMap((m) => m.lessons);
    const currentIndex = allLessons.findIndex((l) => l.id === lessonId);

    if (currentIndex === -1) {
      res.status(404).json({ error: 'Lesson not found' });
      return;
    }

    const currentLesson = allLessons[currentIndex];
    if (!currentLesson) {
      res.status(404).json({ error: 'Lesson not found' });
      return;
    }
    const nextLesson = allLessons[currentIndex + 1] || null;
    const prevLesson = allLessons[currentIndex - 1] || null;
    const currentModule = enrolment.course.modules.find((m) => m.id === currentLesson.moduleId) || null;

    // R2 objects are private, so the player gets a short-lived signed URL rather
    // than a key it could not fetch. Legacy paths and absolute URLs pass through.
    let mediaUrl = currentLesson.mediaUrl;
    if (mediaUrl && isObjectKey(mediaUrl) && isStorageConfigured()) {
      try {
        mediaUrl = await createDownloadUrl(mediaUrl);
      } catch (error) {
        logger.error('Could not sign lesson media URL', {
          errorMessage: (error as Error).message,
          lessonId: currentLesson.id,
        });
        mediaUrl = null;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        lesson: { ...currentLesson, mediaUrl },
        nextLessonId: nextLesson?.id || null,
        prevLessonId: prevLesson?.id || null,
        module: currentModule,
        allLessonsCount: allLessons.length,
        currentIndex,
        isCompleted: currentLesson.progress[0]?.completed ?? false
      }
    });
  } catch (error) {
    logger.error('Get Lesson error', {
      errorMessage: (error as Error).message,
      courseId: req.params.courseId,
      lessonId: req.params.lessonId,
      userId: (req as AuthenticatedRequest).user?.userId || 'anonymous',
    });
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Share of a course's lessons the learner has finished, as 0–1.
 * Derived from LessonProgress rather than incremented, so it self-corrects if a
 * lesson is added to or removed from the course later.
 */
export function calculateProgress(
  completedLessons: number,
  totalLessons: number
): number {
  if (totalLessons <= 0) return 0;
  return Math.min(1, completedLessons / totalLessons);
}

/**
 * BE-LEARN-003 criterion 4. Badge tiers in `BADGE_THRESHOLDS` are keyed on quiz
 * *score*, which has no natural mapping to "finished every lesson", so course
 * completion grants the entry tier for now. The unique constraint on
 * (userId, badgeType, courseId) makes repeat calls a no-op.
 */
async function awardCourseCompletionBadge(
  userId: string,
  courseId: string
): Promise<BadgeType | null> {
  const badgeType: BadgeType = 'BRONZE';

  const existing = await prisma.userBadge.findUnique({
    where: { userId_badgeType_courseId: { userId, badgeType, courseId } },
    select: { id: true },
  });
  if (existing) return null;

  await prisma.userBadge.create({ data: { userId, badgeType, courseId } });
  logger.info('Course completion badge awarded', { userId, courseId, badgeType });
  return badgeType;
}

export const completeLesson = async (req: Request, res: Response): Promise<void> => {
  try {
    const { courseId, lessonId } = req.params as { courseId: string; lessonId: string };
    const userId = (req as AuthenticatedRequest).user?.userId;

    if (!userId || !courseId || !lessonId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // The learner must own an enrolment before progress can be recorded against it.
    const enrolment = await prisma.enrolment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { id: true },
    });

    if (!enrolment) {
      res.status(403).json({ error: 'You are not enrolled in this course.' });
      return;
    }

    // Guard against marking a lesson that belongs to a different course.
    const lesson = await prisma.lesson.findFirst({
      where: { id: lessonId, module: { courseId } },
      select: { id: true },
    });

    if (!lesson) {
      res.status(404).json({ error: 'Lesson not found in this course.' });
      return;
    }

    // Idempotent: a repeat submission updates nothing and creates no duplicate.
    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: { userId, lessonId, completed: true },
      update: { completed: true },
    });

    const [totalLessons, completedLessons] = await Promise.all([
      prisma.lesson.count({ where: { module: { courseId } } }),
      prisma.lessonProgress.count({
        where: { userId, completed: true, lesson: { module: { courseId } } },
      }),
    ]);

    const progress = calculateProgress(completedLessons, totalLessons);

    await prisma.enrolment.update({
      where: { userId_courseId: { userId, courseId } },
      data: { progress },
    });

    const badgeEarned =
      progress >= 1 ? await awardCourseCompletionBadge(userId, courseId) : null;

    res.status(200).json({
      success: true,
      data: { courseId, lessonId, completedLessons, totalLessons, progress, badgeEarned },
    });
  } catch (error) {
    logger.error('Complete lesson error', {
      errorMessage: (error as Error).message,
      courseId: req.params.courseId,
      lessonId: req.params.lessonId,
      userId: (req as AuthenticatedRequest).user?.userId || 'anonymous',
    });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const enrolInCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const { courseId } = req.params as { courseId: string };
    const userId = (req as AuthenticatedRequest).user?.userId;

    if (!userId || !courseId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const course = await prisma.course.findFirst({
      where: { id: courseId, published: true, deletedAt: null },
      select: { id: true },
    });

    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    // Idempotent: enrolling twice returns the existing row rather than erroring.
    const enrolment = await prisma.enrolment.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, progress: 0 },
      update: {},
      select: { id: true, progress: true, createdAt: true },
    });

    res.status(200).json({
      success: true,
      data: { courseId, progress: enrolment.progress },
    });
  } catch (error) {
    logger.error('Enrol error', {
      errorMessage: (error as Error).message,
      courseId: req.params.courseId,
      userId: (req as AuthenticatedRequest).user?.userId || 'anonymous',
    });
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * BE-LEARN-002. `level` and `department` are optional query params; when absent
 * they fall back to the caller's own profile, so the dashboard can ask for
 * "courses for me" without restating what the token already says.
 */
export const listCourses = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = (req as AuthenticatedRequest).user;
    const userId = payload?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const levelParam = typeof req.query.level === 'string' ? req.query.level : undefined;
    const departmentParam =
      typeof req.query.department === 'string' ? req.query.department : undefined;

    const level = levelParam ?? payload.academicLevel ?? undefined;
    const department = departmentParam ?? payload.department ?? undefined;

    if (level && !ACADEMIC_LEVELS.includes(level as AcademicLevel)) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: { level: [`level must be one of: ${ACADEMIC_LEVELS.join(', ')}`] },
      });
      return;
    }

    const courses = await prisma.course.findMany({
      where: {
        published: true,
        deletedAt: null,
        ...(level ? { academicLevel: level as AcademicLevel } : {}),
        ...(department ? { department } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        thumbnailUrl: true,
        department: true,
        academicLevel: true,
        modules: { select: { lessons: { select: { estimatedMinutes: true } } } },
        enrolments: { where: { userId }, select: { progress: true } },
      },
    });

    // No matches is an empty list, never a 404 — the client renders an empty state.
    const data: CourseListItem[] = courses.map((course) => {
      const lessons = course.modules.flatMap((m) => m.lessons);
      const enrolment = course.enrolments[0];

      return {
        id: course.id,
        title: course.title,
        description: course.description,
        thumbnailUrl: course.thumbnailUrl,
        department: course.department,
        academicLevel: course.academicLevel,
        moduleCount: course.modules.length,
        lessonCount: lessons.length,
        progress: enrolment?.progress ?? 0,
        estimatedMinutes: lessons.reduce((sum, l) => sum + l.estimatedMinutes, 0),
        isEnrolled: Boolean(enrolment),
      };
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('List courses error', {
      errorMessage: (error as Error).message,
      userId: (req as AuthenticatedRequest).user?.userId || 'anonymous',
    });
    res.status(500).json({ error: 'Internal server error' });
  }
};
