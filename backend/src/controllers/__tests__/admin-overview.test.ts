import { describe, it, expect } from 'vitest';
import { buildGrowthSeries, mergeActivity } from '../admin-overview.controller';
import { toTrackDistribution } from '../../utils/admin-metrics';

const SINCE = new Date(Date.UTC(2026, 7, 1));

function day(offset: number): Date {
  return new Date(Date.UTC(2026, 7, 1 + offset));
}

describe('buildGrowthSeries', () => {
  it('emits an unbroken point per day across the window', () => {
    const series = buildGrowthSeries(SINCE, [], []);

    expect(series).toHaveLength(30);
    expect(series[0]?.date).toBe('2026-08-01');
    expect(series[29]?.date).toBe('2026-08-30');
  });

  it('reads a day nobody registered as zero rather than a gap', () => {
    const series = buildGrowthSeries(SINCE, [{ day: day(2), count: 4 }], []);

    expect(series[1]).toEqual({ date: '2026-08-02', registered: 0, active: 0 });
    expect(series[2]).toEqual({ date: '2026-08-03', registered: 4, active: 0 });
  });

  it('lines the two series up on the same day', () => {
    const series = buildGrowthSeries(
      SINCE,
      [{ day: day(5), count: 9 }],
      [{ day: day(5), count: 3 }]
    );

    expect(series[5]).toEqual({ date: '2026-08-06', registered: 9, active: 3 });
  });

  it('ignores a bucket that falls outside the window', () => {
    const series = buildGrowthSeries(SINCE, [{ day: day(60), count: 99 }], []);

    expect(series.some((point) => point.registered > 0)).toBe(false);
  });
});

describe('toTrackDistribution', () => {
  it('turns counts into whole percentages, largest first', () => {
    const shares = toTrackDistribution(
      [
        { academicLevel: 'TERTIARY', _count: 30 },
        { academicLevel: 'SECONDARY', _count: 50 },
        { academicLevel: 'PROFESSIONAL', _count: 20 },
      ]
    );

    expect(shares).toEqual([
      { academicLevel: 'SECONDARY', count: 50, percentage: 50 },
      { academicLevel: 'TERTIARY', count: 30, percentage: 30 },
      { academicLevel: 'PROFESSIONAL', count: 20, percentage: 20 },
    ]);
  });

  it('drops students who have not picked a track', () => {
    const shares = toTrackDistribution([
      { academicLevel: null, _count: 7 },
      { academicLevel: 'SECONDARY', _count: 3 },
    ]);

    expect(shares.map((share) => share.academicLevel)).toEqual(['SECONDARY']);
  });

  it('divides by tracked students only, so an untracked student leaves no hole', () => {
    // The live data that exposed this: 29 students, one without a track.
    const shares = toTrackDistribution([
      { academicLevel: 'PROFESSIONAL', _count: 10 },
      { academicLevel: 'SECONDARY', _count: 10 },
      { academicLevel: 'TERTIARY', _count: 8 },
      { academicLevel: null, _count: 1 },
    ]);

    expect(shares.map((share) => share.percentage)).toEqual([36, 36, 29]);
  });

  it('does not divide by zero on an empty platform', () => {
    expect(toTrackDistribution([{ academicLevel: 'SECONDARY', _count: 0 }])).toEqual([
      { academicLevel: 'SECONDARY', count: 0, percentage: 0 },
    ]);
  });
});

describe('mergeActivity', () => {
  const student = {
    id: 's1',
    name: 'Ola Aina',
    academicLevel: 'TERTIARY' as const,
    createdAt: new Date('2026-08-30T10:00:00Z'),
  };
  const quiz = {
    id: 'q1',
    title: 'Electromagnetism',
    createdAt: new Date('2026-08-30T11:00:00Z'),
    course: { title: 'Physics' },
  };

  it('interleaves both kinds newest first', () => {
    const activity = mergeActivity([student], [quiz]);

    expect(activity.map((entry) => entry.type)).toEqual(['QUIZ_CREATED', 'STUDENT_REGISTERED']);
  });

  it('names the track a student joined', () => {
    expect(mergeActivity([student], [])[0]?.detail).toBe('Ola Aina joined the Tertiary track');
  });

  it('omits the track for a student who has not onboarded', () => {
    const activity = mergeActivity([{ ...student, academicLevel: null }], []);

    expect(activity[0]?.detail).toBe('Ola Aina joined GIREAPP');
  });

  it('keeps ids unique across the two source tables', () => {
    const activity = mergeActivity([{ ...student, id: 'shared-id' }], [{ ...quiz, id: 'shared-id' }]);

    expect(new Set(activity.map((entry) => entry.id)).size).toBe(2);
  });

  it('caps the list at five entries', () => {
    const students = Array.from({ length: 5 }, (_, index) => ({ ...student, id: `s${index}` }));
    const quizzes = Array.from({ length: 5 }, (_, index) => ({ ...quiz, id: `q${index}` }));

    expect(mergeActivity(students, quizzes)).toHaveLength(5);
  });
});
