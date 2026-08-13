import { Request, Response } from 'express';
import { prisma } from '../services/prisma';
import type {
  ActivityItem,
  AcademicLevel,
  CourseCard,
  DashboardOverview,
  NextQuiz,
  SessionUser,
} from '@gireapp/shared';
import { POINTS } from '@gireapp/shared';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

const RECENT_ACTIVITY_LIMIT = 10;
const WEEKLY_WINDOW_DAYS = 7;

/** Below this many peers a percentile says more about cohort size than merit. */
const MIN_PEERS_FOR_RANK = 5;

function startOfWeeklyWindow(now = new Date()): Date {
  return new Date(now.getTime() - WEEKLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * There is no points ledger — `User.points` is a running total — so the weekly
 * figure is rebuilt from the attempts inside the window using the same award
 * table that granted them.
 */
export function sumAttemptPoints(
  attempts: { score: number; quiz: { passingScore: number } }[]
): number {
  return attempts.reduce(
    (total, attempt) =>
      total +
      (attempt.score >= attempt.quiz.passingScore ? POINTS.QUIZ_PASS : POINTS.QUIZ_FAIL),
    0
  );
}

/**
 * Percentage of same-level learners at or above this learner, so 10 means
 * "top 10%". Null when the learner has yet to score, or the cohort is too small
 * for the number to carry meaning.
 */
async function calculateRankPercentile(
  userId: string,
  academicLevel: AcademicLevel | null,
  points: number
): Promise<number | null> {
  if (points <= 0 || !academicLevel) return null;

  const peerFilter = { academicLevel, deletedAt: null, id: { not: userId } };

  const [peerCount, ahead] = await Promise.all([
    prisma.user.count({ where: peerFilter }),
    prisma.user.count({ where: { ...peerFilter, points: { gt: points } } }),
  ]);

  if (peerCount < MIN_PEERS_FOR_RANK) return null;

  // +1 counts the learner themselves, so a clear leader lands in the top slice
  // rather than at 0%.
  return Math.ceil(((ahead + 1) / (peerCount + 1)) * 100);
}

export const getDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = (req as AuthenticatedRequest).user;
    const userId = payload.userId;

    const [
      user,
      enrolments,
      badgeCount,
      recentLessons,
      recentAttempts,
      recentBadges,
      quizzesTaken,
      scoreAggregate,
      weeklyAttempts,
      nextQuizRow,
    ] = await Promise.all([
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
        // Counted rather than derived from recentActivity, which is truncated
        // to RECENT_ACTIVITY_LIMIT and so undercounts an active learner.
        prisma.quizAttempt.count({ where: { userId } }),
        prisma.quizAttempt.aggregate({
          where: { userId },
          _avg: { score: true },
        }),
        prisma.quizAttempt.findMany({
          where: { userId, submittedAt: { gte: startOfWeeklyWindow() } },
          select: { score: true, quiz: { select: { passingScore: true } } },
        }),
        prisma.quiz.findFirst({
          where: {
            course: {
              deletedAt: null,
              published: true,
              enrolments: { some: { userId } },
            },
            attempts: { none: { userId } },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, courseId: true, title: true },
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

    const averageScore = scoreAggregate._avg.score;

    const nextQuiz: NextQuiz | null = nextQuizRow
      ? {
          id: nextQuizRow.id,
          courseId: nextQuizRow.courseId,
          title: nextQuizRow.title,
          // Quizzes carry no due date in the schema yet.
          dueDate: null,
        }
      : null;

    const overview: DashboardOverview = {
      profile,
      totalPoints: user.points,
      badgeCount,
      activeCourses,
      recentActivity,
      stats: {
        quizzesTaken,
        averageScore: averageScore === null ? null : Math.round(averageScore),
        weeklyPoints: sumAttemptPoints(weeklyAttempts),
        rankPercentile: await calculateRankPercentile(
          userId,
          user.academicLevel,
          user.points
        ),
      },
      nextQuiz,
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
