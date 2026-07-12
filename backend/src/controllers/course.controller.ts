import { Request, Response } from 'express';
import { prisma } from '../services/prisma';
import { logger } from '../utils/logger';

export const getLesson = async (req: Request, res: Response): Promise<void> => {
  try {
    const { courseId, lessonId } = req.params as { courseId: string; lessonId: string };
    // user is attached by an auth middleware (we'll need to create this middleware)
    const userId = (req as any).user?.userId;

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

    res.status(200).json({
      success: true,
      data: {
        lesson: currentLesson,
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
      userId: (req as any).user?.userId || 'anonymous',
    });
    res.status(500).json({ error: 'Internal server error' });
  }
};
