import { Request, Response } from 'express';
import { prisma } from '../services/prisma';
import type {
  ActivityItem,
  CourseCard,
  DashboardOverview,
  SessionUser,
} from '@gireapp/shared';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

const RECENT_ACTIVITY_LIMIT = 10;

export const getDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = (req as AuthenticatedRequest).user;
    const userId = payload.userId;

    const [user, enrolments, badgeCount, recentLessons, recentAttempts, recentBadges] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId, deletedAt: null },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            academicLevel: true,
            department: true,
            moodTheme: true,
            points: true,
            image: true,
          },
        }),
        prisma.enrolment.findMany({
          where: { userId, course: { deletedAt: null, published: true } },
          orderBy: { updatedAt: 'desc' },
          include: {
            course: {
              select: {
                id: true,
                title: true,
                description: true,
                thumbnailUrl: true,
                modules: {
                  select: {
                    lessons: { select: { estimatedMinutes: true } },
                  },
                },
              },
            },
          },
        }),
        prisma.userBadge.count({ where: { userId } }),
        prisma.lessonProgress.findMany({
          where: { userId, completed: true },
          orderBy: { createdAt: 'desc' },
          take: RECENT_ACTIVITY_LIMIT,
          include: { lesson: { select: { title: true } } },
        }),
        prisma.quizAttempt.findMany({
          where: { userId },
          orderBy: { submittedAt: 'desc' },
          take: RECENT_ACTIVITY_LIMIT,
          include: { quiz: { select: { title: true, passingScore: true } } },
        }),
        prisma.userBadge.findMany({
          where: { userId },
          orderBy: { earnedAt: 'desc' },
          take: RECENT_ACTIVITY_LIMIT,
        }),
      ]);

    if (!user) {
      res.status(401).json({ error: 'Unauthorized: account not found' });
      return;
    }

    const profile: SessionUser = {
      ...user,
      isOnboardingComplete: Boolean(user.academicLevel && user.department),
    };

    const activeCourses: CourseCard[] = enrolments.map((enrolment) => {
      const lessons = enrolment.course.modules.flatMap((m) => m.lessons);
      return {
        id: enrolment.course.id,
        title: enrolment.course.title,
        description: enrolment.course.description,
        thumbnailUrl: enrolment.course.thumbnailUrl,
        moduleCount: enrolment.course.modules.length,
        lessonCount: lessons.length,
        progress: enrolment.progress,
        estimatedMinutes: lessons.reduce((sum, l) => sum + l.estimatedMinutes, 0),
      };
    });

    const recentActivity: ActivityItem[] = [
      ...recentLessons.map<ActivityItem>((p) => ({
        id: p.id,
        type: 'lesson_completed',
        title: p.lesson.title,
        timestamp: p.createdAt.toISOString(),
      })),
      ...recentAttempts.map<ActivityItem>((a) => ({
        id: a.id,
        type: a.score >= a.quiz.passingScore ? 'quiz_passed' : 'quiz_failed',
        title: a.quiz.title,
        timestamp: a.submittedAt.toISOString(),
        metadata: { score: a.score },
      })),
      ...recentBadges.map<ActivityItem>((b) => ({
        id: b.id,
        type: 'badge_earned',
        title: b.badgeType,
        timestamp: b.earnedAt.toISOString(),
      })),
      ...enrolments.map<ActivityItem>((e) => ({
        id: e.id,
        type: 'course_enrolled',
        title: e.course.title,
        timestamp: e.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, RECENT_ACTIVITY_LIMIT);

    const overview: DashboardOverview = {
      profile,
      totalPoints: user.points,
      badgeCount,
      activeCourses,
      recentActivity,
    };

    res.status(200).json(overview);
  } catch (error) {
    logger.error('Dashboard error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};
