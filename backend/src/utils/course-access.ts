import type { Prisma } from '@prisma/client';
import type { JwtPayload } from '@gireapp/shared';

/**
 * Who may reach a course through the learner endpoints (`/api/courses`,
 * `/api/quizzes`, the dashboard). The frontend hides other tracks' courses,
 * but only these filters stop a direct API call.
 */
export type CourseViewer = Pick<JwtPayload, 'userId' | 'role' | 'academicLevel' | 'department'>;

const NO_COURSES: Prisma.CourseWhereInput = { id: { in: [] } };

export function isStaffViewer(viewer: CourseViewer): boolean {
  return viewer.role === 'ADMIN' || viewer.role === 'TUTOR';
}

/**
 * Courses a viewer may discover and join. A learner sees only their own track
 * and department; one who has not finished onboarding has neither, so sees
 * nothing. Staff preview what they manage, matching the admin rules: admins
 * every course, tutors the ones they wrote.
 */
export function coursesInScopeFor(viewer: CourseViewer): Prisma.CourseWhereInput {
  if (viewer.role === 'ADMIN') return {};
  if (viewer.role === 'TUTOR') return { createdById: viewer.userId };
  if (!viewer.academicLevel || !viewer.department) return NO_COURSES;
  return { academicLevel: viewer.academicLevel, department: viewer.department };
}

/**
 * Courses a viewer may open: those in scope, plus any they already joined. A
 * learner can change track or department in their preferences, and doing so
 * must not lock them out of courses they have started.
 */
export function coursesOpenTo(viewer: CourseViewer): Prisma.CourseWhereInput {
  return {
    OR: [coursesInScopeFor(viewer), { enrolments: { some: { userId: viewer.userId } } }],
  };
}

/**
 * Courses whose lessons a viewer may read. Learners must be enrolled; staff
 * preview without enrolling, which would otherwise count them as students in
 * every enrolment figure.
 */
export function coursesWithLessonsReadableBy(viewer: CourseViewer): Prisma.CourseWhereInput {
  if (isStaffViewer(viewer)) return coursesInScopeFor(viewer);
  return { enrolments: { some: { userId: viewer.userId } } };
}
