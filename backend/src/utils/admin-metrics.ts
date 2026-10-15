import type { Prisma } from '@prisma/client';
import type { AcademicLevel, AdminTotal, AdminTrackShare } from '@gireapp/shared';

export const WEEK_DAYS = 7;
export const PERCENT = 100;
/** Enrolment.progress is a 0–1 fraction; 1 means the course is finished. */
export const COMPLETE_PROGRESS = 1;

export const LIVE_STUDENT: Prisma.UserWhereInput = { role: 'STUDENT', deletedAt: null };

export function daysAgo(days: number, from: Date = new Date()): Date {
  const date = new Date(from);
  date.setDate(date.getDate() - days);
  return date;
}

/** Midnight UTC of the day `days` ago — the left edge of a day-bucketed window. */
export function startOfDayUtcDaysAgo(days: number, from: Date = new Date()): Date {
  const date = daysAgo(days, from);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `part` as a whole percent of `whole`; null when there is nothing to divide. */
export function wholePercent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * PERCENT);
}

export function toTotal(value: number, addedThisWeek: number): AdminTotal {
  return { value, addedThisWeek };
}

/**
 * Shares of the students who have picked a track. Students without one are
 * dropped *before* dividing: counting them in the denominator made the three
 * shares sum to less than 100 and left a hole in the donut.
 */
export function toTrackDistribution(
  groups: { academicLevel: AcademicLevel | null; _count: number }[]
): AdminTrackShare[] {
  const tracked = groups.filter(
    (group): group is { academicLevel: AcademicLevel; _count: number } =>
      group.academicLevel !== null
  );
  const trackedTotal = tracked.reduce((sum, group) => sum + group._count, 0);

  return tracked
    .map((group) => ({
      academicLevel: group.academicLevel,
      count: group._count,
      percentage: wholePercent(group._count, trackedTotal) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}
