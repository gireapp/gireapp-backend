import { Request, Response } from 'express';
import type {
  AcademicLevel,
  AdminActivity,
  AdminGrowthPoint,
  AdminOverview,
  AdminSubjectEnrolments,
} from '@gireapp/shared';
import { prisma } from '../services/prisma';
import {
  COMPLETE_PROGRESS,
  LIVE_STUDENT,
  WEEK_DAYS,
  daysAgo,
  isoDate,
  startOfDayUtcDaysAgo,
  toTotal,
  toTrackDistribution,
  wholePercent,
} from '../utils/admin-metrics';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

const GROWTH_WINDOW_DAYS = 30;
const RECENT_ACTIVITY_LIMIT = 5;
const TOP_SUBJECTS_LIMIT = 5;

type DailyCount = { day: Date; count: number };

/**
 * Fills the window with a point per day so the chart has an unbroken x-axis;
 * a day nobody registered is a zero, not a gap.
 */
export function buildGrowthSeries(
  since: Date,
  registered: DailyCount[],
  active: DailyCount[]
): AdminGrowthPoint[] {
  const registeredByDay = new Map(registered.map((row) => [isoDate(row.day), row.count]));
  const activeByDay = new Map(active.map((row) => [isoDate(row.day), row.count]));

  return Array.from({ length: GROWTH_WINDOW_DAYS }, (_, offset) => {
    const day = new Date(since);
    day.setUTCDate(day.getUTCDate() + offset);
    const date = isoDate(day);

    return {
      date,
      registered: registeredByDay.get(date) ?? 0,
      active: activeByDay.get(date) ?? 0,
    };
  });
}

/**
 * The two activity kinds are read separately and merged here rather than in
 * SQL: they come from unrelated tables and each needs its own detail line.
 */
export function mergeActivity(
  students: { id: string; name: string; academicLevel: AcademicLevel | null; createdAt: Date }[],
  quizzes: { id: string; title: string; createdAt: Date; course: { title: string } }[]
): AdminActivity[] {
  const entries: AdminActivity[] = [
    ...students.map((student) => ({
      id: `student-${student.id}`,
      type: 'STUDENT_REGISTERED' as const,
      detail: student.academicLevel
        ? `${student.name} joined the ${titleCase(student.academicLevel)} track`
        : `${student.name} joined GIREAPP`,
      at: student.createdAt.toISOString(),
    })),
    ...quizzes.map((quiz) => ({
      id: `quiz-${quiz.id}`,
      type: 'QUIZ_CREATED' as const,
      detail: `${quiz.course.title} : ${quiz.title}`,
      at: quiz.createdAt.toISOString(),
    })),
  ];

  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, RECENT_ACTIVITY_LIMIT);
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export const getAdminOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const weekAgo = daysAgo(WEEK_DAYS);
    const growthSince = startOfDayUtcDaysAgo(GROWTH_WINDOW_DAYS - 1);

    const [
      totalStudents,
      studentsThisWeek,
      totalCourses,
      coursesThisWeek,
      totalQuizzes,
      quizzesThisWeek,
      trackGroups,
      totalEnrolments,
      completedEnrolments,
      newStudents,
      newQuizzes,
      registeredByDay,
      activeByDay,
      topSubjects,
    ] = await Promise.all([
      prisma.user.count({ where: LIVE_STUDENT }),
      prisma.user.count({ where: { ...LIVE_STUDENT, createdAt: { gte: weekAgo } } }),
      prisma.course.count({ where: { deletedAt: null } }),
      prisma.course.count({ where: { deletedAt: null, createdAt: { gte: weekAgo } } }),
      prisma.quiz.count(),
      prisma.quiz.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.groupBy({
        by: ['academicLevel'],
        where: LIVE_STUDENT,
        _count: true,
      }),
      prisma.enrolment.count(),
      prisma.enrolment.count({ where: { progress: { gte: COMPLETE_PROGRESS } } }),
      prisma.user.findMany({
        where: LIVE_STUDENT,
        orderBy: { createdAt: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
        select: { id: true, name: true, academicLevel: true, createdAt: true },
      }),
      prisma.quiz.findMany({
        orderBy: { createdAt: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
        select: { id: true, title: true, createdAt: true, course: { select: { title: true } } },
      }),
      // Postgres buckets by day far more cheaply than shipping every row back
      // to group in JS, and the window is bounded either way.
      prisma.$queryRaw<DailyCount[]>`
        SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS count
        FROM users
        WHERE role = 'STUDENT' AND "deletedAt" IS NULL AND "createdAt" >= ${growthSince}
        GROUP BY 1
      `,
      // "Active" means the learner did something that day — finished a lesson
      // or sat a quiz — counted once however many times they did it.
      prisma.$queryRaw<DailyCount[]>`
        SELECT day, COUNT(DISTINCT "userId")::int AS count
        FROM (
          SELECT date_trunc('day', "createdAt")::date AS day, "userId"
          FROM lesson_progress WHERE "createdAt" >= ${growthSince}
          UNION ALL
          SELECT date_trunc('day', "createdAt")::date AS day, "userId"
          FROM quiz_attempts WHERE "createdAt" >= ${growthSince}
        ) activity
        GROUP BY day
      `,
      prisma.$queryRaw<{ subject: string; enrolments: number }[]>`
        SELECT c.department AS subject, COUNT(*)::int AS enrolments
        FROM enrolments e
        JOIN courses c ON c.id = e."courseId"
        WHERE c."deletedAt" IS NULL
        GROUP BY c.department
        ORDER BY enrolments DESC
        LIMIT ${TOP_SUBJECTS_LIMIT}
      `,
    ]);

    const overview: AdminOverview = {
      students: toTotal(totalStudents, studentsThisWeek),
      courses: toTotal(totalCourses, coursesThisWeek),
      quizzes: toTotal(totalQuizzes, quizzesThisWeek),
      growth: buildGrowthSeries(growthSince, registeredByDay, activeByDay),
      trackDistribution: toTrackDistribution(trackGroups),
      recentActivity: mergeActivity(newStudents, newQuizzes),
      topSubjects: topSubjects as AdminSubjectEnrolments[],
      courseCompletionRate: wholePercent(completedEnrolments, totalEnrolments),
    };

    res.status(200).json({ success: true, data: overview });
  } catch (error) {
    logger.error('Admin overview error', {
      errorMessage: (error as Error).message,
      userId: (req as AuthenticatedRequest).user?.userId,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};
