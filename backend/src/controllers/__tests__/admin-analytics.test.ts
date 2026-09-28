import { describe, it, expect } from 'vitest';
import {
  bucketStarts,
  buildRegistrationSeries,
  toPassRates,
  toRetention,
} from '../admin-analytics.controller';

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('bucketStarts', () => {
  it('emits one bucket per day, inclusive of both ends', () => {
    const starts = bucketStarts(utc('2026-09-01'), utc('2026-09-07'), 'DAILY');

    expect(starts.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
    ]);
  });

  it('aligns weekly buckets to Monday, matching Postgres date_trunc("week")', () => {
    // 2026-09-03 is a Thursday; its week starts Monday 2026-08-31.
    const starts = bucketStarts(utc('2026-09-03'), utc('2026-09-20'), 'WEEKLY');

    expect(starts.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
    ]);
    expect(starts.every((d) => d.getUTCDay() === 1)).toBe(true);
  });

  it('treats a Sunday as the end of its week, not the start of the next', () => {
    const [first] = bucketStarts(utc('2026-09-06'), utc('2026-09-06'), 'WEEKLY');

    expect(first?.toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});

describe('buildRegistrationSeries', () => {
  const starts = [utc('2026-09-01'), utc('2026-09-02')];

  it('reads an empty bucket as zeros for every track, never a gap', () => {
    expect(buildRegistrationSeries(starts, [])).toEqual([
      { date: '2026-09-01', byTrack: { SECONDARY: 0, TERTIARY: 0, PROFESSIONAL: 0 } },
      { date: '2026-09-02', byTrack: { SECONDARY: 0, TERTIARY: 0, PROFESSIONAL: 0 } },
    ]);
  });

  it('files each count under its bucket and track', () => {
    const series = buildRegistrationSeries(starts, [
      { bucket: utc('2026-09-02'), academicLevel: 'TERTIARY', count: 3 },
      { bucket: utc('2026-09-02'), academicLevel: 'SECONDARY', count: 1 },
    ]);

    expect(series[1]?.byTrack).toEqual({ SECONDARY: 1, TERTIARY: 3, PROFESSIONAL: 0 });
  });

  it('ignores a row outside the window rather than adding a stray point', () => {
    const series = buildRegistrationSeries(starts, [
      { bucket: utc('2026-08-01'), academicLevel: 'TERTIARY', count: 9 },
    ]);

    expect(series).toHaveLength(2);
    expect(series.every((point) => point.byTrack.TERTIARY === 0)).toBe(true);
  });
});

describe('toPassRates', () => {
  it('turns passes into a whole percent of attempts', () => {
    expect(toPassRates([{ subject: 'Physics', attempts: 3, passed: 2 }])).toEqual([
      { subject: 'Physics', attempts: 3, passRate: 67 },
    ]);
  });

  it('reports 0% rather than dividing by zero', () => {
    expect(toPassRates([{ subject: 'Physics', attempts: 0, passed: 0 }])[0]?.passRate).toBe(0);
  });
});

describe('toRetention', () => {
  it('always returns all five weeks so the axis never shifts', () => {
    const weeks = toRetention([{ week: 1, eligible: 4, retained: 3 }]);

    expect(weeks.map((w) => w.week)).toEqual([1, 2, 3, 4, 5]);
    expect(weeks[0]).toEqual({ week: 1, eligible: 4, rate: 75 });
  });

  it('leaves a week null until someone has been signed up long enough', () => {
    const weeks = toRetention([{ week: 5, eligible: 0, retained: 0 }]);

    // Null, not 0%: "nobody retained" and "too soon to tell" are different.
    expect(weeks[4]).toEqual({ week: 5, eligible: 0, rate: null });
  });
});
