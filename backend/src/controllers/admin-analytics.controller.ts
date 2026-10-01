import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
  ACADEMIC_LEVELS,
  RETENTION_WEEKS,
  analyticsQuerySchema,
  type AcademicLevel,
  type AdminAnalytics,
  type AdminRegistrationPoint,
  type AdminRetentionWeek,
  type AdminSubjectEnrolments,
  type AdminSubjectPassRate,
  type AnalyticsGrouping,
  type AnalyticsQuery,
} from '@gireapp/shared';
import { prisma } from '../services/prisma';
import { resolveAvatarUrl } from '../services/storage';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';
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

const TOP_SUBJECTS_LIMIT = 5;
const TOP_STUDENTS_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Postgres `date_trunc` units, keyed by the filter's grouping. */
const TRUNC_UNIT: Record<AnalyticsGrouping, 'day' | 'week'> = {
  DAILY: 'day',
  WEEKLY: 'week',
};

type Filters = Pick<AnalyticsQuery, 'academicLevel' | 'courseId'>;

type BucketCount = { bucket: Date; academicLevel: AcademicLevel; count: number };
type PassRateRow = { subject: string; attempts: number; passed: number };
type RetentionRow = { week: number; eligible: number; retained: number };

// ── Filter scopes ──

/**
 * The student population the track and course filters narrow to. Every
 * student-based figure on the page reads from this one definition, so the
 * tiles, charts and rankings can never disagree about who is counted.
 */
function studentWhere(filters: Filters): Prisma.UserWhereInput {
  return {
    ...LIVE_STUDENT,
    ...(filters.academicLevel ? { academicLevel: filters.academicLevel } : {}),
    ...(filters.courseId ? { enrolments: { some: { courseId: filters.courseId } } } : {}),
  };
}

/** `studentWhere` as a SQL predicate over a `users` row aliased `u`. */
function studentScopeSql(filters: Filters): Prisma.Sql {
  const byTrack = filters.academicLevel
    ? Prisma.sql`AND u."academicLevel" = ${filters.academicLevel}::"AcademicLevel"`
    : Prisma.empty;
  const byCourse = filters.courseId
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM enrolments scope_e
        WHERE scope_e."userId" = u.id AND scope_e."courseId" = ${filters.courseId}
      )`
    : Prisma.empty;

  return Prisma.sql`u.role = 'STUDENT' AND u."deletedAt" IS NULL ${byTrack} ${byCourse}`;
}

function courseWhere(filters: Filters): Prisma.CourseWhereInput {
  return {
    deletedAt: null,
    ...(filters.academicLevel ? { academicLevel: filters.academicLevel } : {}),
    ...(filters.courseId ? { id: filters.courseId } : {}),
  };
}

// ── Pure shaping ──

/** Monday 00:00 UTC of the week containing `date` — Postgres weeks start Monday. */
function startOfIsoWeekUtc(date: Date): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysSinceMonday = (day.getUTCDay() + 6) % WEEK_DAYS;
  return new Date(day.getTime() - daysSinceMonday * DAY_MS);
}

/**
 * The start of every bucket from `from` up to `to`, so the chart has an unbroken
 * x-axis. Weekly buckets align to Monday to match Postgres `date_trunc('week')`,
 * which means the first week can begin a few days before `from`.
 */
export function bucketStarts(from: Date, to: Date, grouping: AnalyticsGrouping): Date[] {
  const stepDays = grouping === 'WEEKLY' ? WEEK_DAYS : 1;
  const first = grouping === 'WEEKLY' ? startOfIsoWeekUtc(from) : from;
  const starts: Date[] = [];

  for (let cursor = first; cursor <= to; cursor = new Date(cursor.getTime() + stepDays * DAY_MS)) {
    starts.push(cursor);
  }
  return starts;
}

function emptyTrackCounts(): Record<AcademicLevel, number> {
  return Object.fromEntries(ACADEMIC_LEVELS.map((level) => [level, 0])) as Record<
    AcademicLevel,
    number
  >;
}

/** One point per bucket, each carrying a count per track; empty buckets are zeros. */
export function buildRegistrationSeries(
  starts: Date[],
  rows: BucketCount[]
): AdminRegistrationPoint[] {
  const byBucket = new Map(starts.map((start) => [isoDate(start), emptyTrackCounts()]));

  for (const row of rows) {
    const counts = byBucket.get(isoDate(row.bucket));
    if (counts) counts[row.academicLevel] += row.count;
  }

  return [...byBucket].map(([date, byTrack]) => ({ date, byTrack }));
}

export function toPassRates(rows: PassRateRow[]): AdminSubjectPassRate[] {
  return rows.map((row) => ({
    subject: row.subject,
    attempts: row.attempts,
    passRate: wholePercent(row.passed, row.attempts) ?? 0,
  }));
}

/** Always one entry per week, so the chart's x-axis is stable across filters. */
export function toRetention(rows: RetentionRow[]): AdminRetentionWeek[] {
  const byWeek = new Map(rows.map((row) => [row.week, row]));

  return Array.from({ length: RETENTION_WEEKS }, (_, index) => {
    const week = index + 1;
    const row = byWeek.get(week);
    const eligible = row?.eligible ?? 0;
    return { week, eligible, rate: wholePercent(row?.retained ?? 0, eligible) };
  });
}

// ── Queries ──

function registrationsByBucket(
  filters: Filters,
  from: Date,
  grouping: AnalyticsGrouping
): Promise<BucketCount[]> {
  return prisma.$queryRaw<BucketCount[]>`
    SELECT date_trunc(${TRUNC_UNIT[grouping]}, u."createdAt")::date AS bucket,
           u."academicLevel" AS "academicLevel",
           COUNT(*)::int AS count
    FROM users u
    WHERE ${studentScopeSql(filters)}
      AND u."createdAt" >= ${from}
      AND u."academicLevel" IS NOT NULL
    GROUP BY 1, 2
  `;
}

function passRatesBySubject(filters: Filters, from: Date): Promise<PassRateRow[]> {
  const byCourse = filters.courseId
    ? Prisma.sql`AND q."courseId" = ${filters.courseId}`
    : Prisma.empty;

  return prisma.$queryRaw<PassRateRow[]>`
    SELECT c.department AS subject,
           COUNT(*)::int AS attempts,
           COUNT(*) FILTER (WHERE qa.score >= q."passingScore")::int AS passed
    FROM quiz_attempts qa
    JOIN quizzes q ON q.id = qa."quizId"
    JOIN courses c ON c.id = q."courseId"
    JOIN users u ON u.id = qa."userId"
    WHERE c."deletedAt" IS NULL
      AND qa."createdAt" >= ${from}
      AND ${studentScopeSql(filters)}
      ${byCourse}
    GROUP BY c.department
    ORDER BY attempts DESC, subject ASC
    LIMIT ${TOP_SUBJECTS_LIMIT}
  `;
}

/**
 * Week N counts a student as retained if they finished a lesson or sat a quiz
 * during days [7(N-1), 7N) after signing up. A student only counts towards
 * week N once that week has fully elapsed, so a partial week never drags the
 * rate down.
 */
function retentionByWeek(filters: Filters, from: Date, now: Date): Promise<RetentionRow[]> {
  return prisma.$queryRaw<RetentionRow[]>`
    WITH cohort AS (
      SELECT u.id, u."createdAt" AS joined
      FROM users u
      WHERE ${studentScopeSql(filters)} AND u."createdAt" >= ${from}
    ),
    activity AS (
      SELECT "userId", "createdAt" FROM lesson_progress
      UNION ALL
      SELECT "userId", "createdAt" FROM quiz_attempts
    )
    SELECT w.week::int AS week,
           COUNT(c.id) FILTER (
             WHERE c.joined + w.week * interval '7 days' <= ${now}
           )::int AS eligible,
           COUNT(c.id) FILTER (
             WHERE c.joined + w.week * interval '7 days' <= ${now}
               AND EXISTS (
                 SELECT 1 FROM activity a
                 WHERE a."userId" = c.id
                   AND a."createdAt" >= c.joined + (w.week - 1) * interval '7 days'
                   AND a."createdAt" <  c.joined + w.week * interval '7 days'
               )
           )::int AS retained
    FROM generate_series(1, ${RETENTION_WEEKS}::int) AS w(week)
    LEFT JOIN cohort c ON true
    GROUP BY w.week
    ORDER BY w.week
  `;
}

function topSubjectsByEnrolment(filters: Filters, from: Date): Promise<AdminSubjectEnrolments[]> {
  const byCourse = filters.courseId
    ? Prisma.sql`AND e."courseId" = ${filters.courseId}`
    : Prisma.empty;

  return prisma.$queryRaw<AdminSubjectEnrolments[]>`
    SELECT c.department AS subject, COUNT(*)::int AS enrolments
    FROM enrolments e
    JOIN courses c ON c.id = e."courseId"
    JOIN users u ON u.id = e."userId"
    WHERE c."deletedAt" IS NULL
      AND e."createdAt" >= ${from}
      AND ${studentScopeSql(filters)}
      ${byCourse}
    GROUP BY c.department
    ORDER BY enrolments DESC, subject ASC
    LIMIT ${TOP_SUBJECTS_LIMIT}
  `;
}

async function topStudents(filters: Filters) {
  const students = await prisma.user.findMany({
    where: studentWhere(filters),
    orderBy: [{ points: 'desc' }, { name: 'asc' }],
    take: TOP_STUDENTS_LIMIT,
    select: {
      id: true,
      name: true,
      image: true,
      academicLevel: true,
      points: true,
      _count: { select: { quizAttempts: true } },
    },
  });

  return Promise.all(
    students.map(async ({ _count, image, ...student }) => ({
      ...student,
      image: await resolveAvatarUrl(image),
      quizzesTaken: _count.quizAttempts,
    }))
  );
}

// ── Handler ──

/**
 * The date range narrows only figures that are events in time — registrations,
 * quiz attempts, new enrolments and the retention cohort. Totals, track shares,
 * completion and rankings describe the platform as it stands, so the track and
 * course filters narrow them but the date range does not.
 */
export const getAdminAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = analyticsQuerySchema.safeParse(req.query);
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { rangeDays, groupBy, ...filters } = result.data;
    const now = new Date();
    const from = startOfDayUtcDaysAgo(rangeDays - 1, now);
    const weekAgo = daysAgo(WEEK_DAYS, now);
    const students = studentWhere(filters);
    const courses = courseWhere(filters);
    const quizzes: Prisma.QuizWhereInput = { course: courses };
    const enrolments: Prisma.EnrolmentWhereInput = {
      user: students,
      course: { deletedAt: null },
      ...(filters.courseId ? { courseId: filters.courseId } : {}),
    };

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
      registrationRows,
      passRateRows,
      retentionRows,
      topSubjects,
      rankedStudents,
    ] = await Promise.all([
      prisma.user.count({ where: students }),
      prisma.user.count({ where: { ...students, createdAt: { gte: weekAgo } } }),
      prisma.course.count({ where: courses }),
      prisma.course.count({ where: { ...courses, createdAt: { gte: weekAgo } } }),
      prisma.quiz.count({ where: quizzes }),
      prisma.quiz.count({ where: { ...quizzes, createdAt: { gte: weekAgo } } }),
      prisma.user.groupBy({ by: ['academicLevel'], where: students, _count: true }),
      prisma.enrolment.count({ where: enrolments }),
      prisma.enrolment.count({
        where: { ...enrolments, progress: { gte: COMPLETE_PROGRESS } },
      }),
      registrationsByBucket(filters, from, groupBy),
      passRatesBySubject(filters, from),
      retentionByWeek(filters, from, now),
      topSubjectsByEnrolment(filters, from),
      topStudents(filters),
    ]);

    const analytics: AdminAnalytics = {
      period: { from: from.toISOString(), to: now.toISOString(), rangeDays, groupBy },
      students: toTotal(totalStudents, studentsThisWeek),
      courses: toTotal(totalCourses, coursesThisWeek),
      quizzes: toTotal(totalQuizzes, quizzesThisWeek),
      registrations: buildRegistrationSeries(
        bucketStarts(from, now, groupBy),
        registrationRows
      ),
      trackDistribution: toTrackDistribution(trackGroups),
      quizPassRates: toPassRates(passRateRows),
      retention: toRetention(retentionRows),
      topStudents: rankedStudents,
      topSubjects,
      courseCompletionRate: wholePercent(completedEnrolments, totalEnrolments),
    };

    res.status(200).json({ success: true, data: analytics });
  } catch (error) {
    logger.error('Admin analytics error', {
      errorMessage: (error as Error).message,
      userId: (req as AuthenticatedRequest).user?.userId,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};
