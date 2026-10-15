import { describe, it, expect } from 'vitest';
import {
  coursesInScopeFor,
  coursesOpenTo,
  coursesWithLessonsReadableBy,
  type CourseViewer,
} from '../course-access';

const LEARNER: CourseViewer = {
  userId: 'learner-1',
  role: 'STUDENT',
  academicLevel: 'SECONDARY',
  department: 'Science',
};
const ADMIN: CourseViewer = { userId: 'admin-1', role: 'ADMIN', academicLevel: null, department: null };
const TUTOR: CourseViewer = { userId: 'tutor-1', role: 'TUTOR', academicLevel: null, department: null };
const MATCHES_NOTHING = { id: { in: [] } };

describe('coursesInScopeFor', () => {
  it("limits a learner to their own track and department", () => {
    expect(coursesInScopeFor(LEARNER)).toEqual({ academicLevel: 'SECONDARY', department: 'Science' });
  });

  it('gives a learner who has not finished onboarding nothing, rather than everything', () => {
    expect(coursesInScopeFor({ ...LEARNER, academicLevel: null })).toEqual(MATCHES_NOTHING);
    expect(coursesInScopeFor({ ...LEARNER, department: null })).toEqual(MATCHES_NOTHING);
  });

  it('lets an admin preview every course', () => {
    expect(coursesInScopeFor(ADMIN)).toEqual({});
  });

  it('lets a tutor preview only the courses they wrote', () => {
    expect(coursesInScopeFor(TUTOR)).toEqual({ createdById: 'tutor-1' });
  });
});

describe('coursesOpenTo', () => {
  it("keeps a learner's existing enrolments open after a change of track or department", () => {
    expect(coursesOpenTo(LEARNER)).toEqual({
      OR: [
        { academicLevel: 'SECONDARY', department: 'Science' },
        { enrolments: { some: { userId: 'learner-1' } } },
      ],
    });
  });
});

describe('coursesWithLessonsReadableBy', () => {
  it('requires a learner to be enrolled', () => {
    expect(coursesWithLessonsReadableBy(LEARNER)).toEqual({
      enrolments: { some: { userId: 'learner-1' } },
    });
  });

  it('lets staff preview lessons without enrolling', () => {
    expect(coursesWithLessonsReadableBy(ADMIN)).toEqual({});
    expect(coursesWithLessonsReadableBy(TUTOR)).toEqual({ createdById: 'tutor-1' });
  });
});
