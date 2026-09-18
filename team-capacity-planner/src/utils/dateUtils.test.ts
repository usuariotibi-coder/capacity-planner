import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getWeekStart,
  parseISODate,
  normalizeWeekStartDate,
  getWeeksInRange,
  formatToISO,
  getWeek1Start,
  getWeekNumber,
  getAllWeeksOfYear,
} from './dateUtils';

describe('parseISODate', () => {
  let originalTz: string | undefined;

  beforeAll(() => {
    originalTz = process.env.TZ;
    // The app is used in America/Mexico_City (UTC-6). This is the exact
    // timezone that exposed the bug documented in dateUtils.ts: naive
    // `new Date('YYYY-MM-DD')` parses as UTC midnight, which lands on the
    // *previous* calendar day once converted to local time.
    process.env.TZ = 'America/Mexico_City';
  });

  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it('reads back the same calendar day it was given (regression: UTC-vs-local shift)', () => {
    const date = parseISODate('2026-01-05'); // known Monday
    expect(date.getDate()).toBe(5);
    expect(date.getDay()).toBe(1); // Monday, not Sunday
  });

  it('trims full ISO datetime strings to the date portion', () => {
    const date = parseISODate('2026-01-05T23:59:59Z');
    expect(formatToISO(date)).toBe('2026-01-05');
  });

  it('returns an invalid Date for empty input', () => {
    expect(Number.isNaN(parseISODate('').getTime())).toBe(true);
  });
});

describe('formatToISO / parseISODate round trip', () => {
  it('round-trips arbitrary dates without drift', () => {
    const samples = ['2026-01-01', '2026-02-28', '2026-12-31', '2025-12-29'];
    for (const iso of samples) {
      expect(formatToISO(parseISODate(iso))).toBe(iso);
    }
  });
});

describe('getWeekStart', () => {
  it('returns Monday for a mid-week date', () => {
    const start = getWeekStart(new Date(2026, 0, 7)); // Wednesday
    expect(start.getDay()).toBe(1);
    expect(formatToISO(start)).toBe('2026-01-05');
  });

  it('returns the previous Monday for a Sunday date', () => {
    const start = getWeekStart(new Date(2026, 0, 11)); // Sunday
    expect(formatToISO(start)).toBe('2026-01-05');
  });

  it('is idempotent for a date that is already Monday', () => {
    const monday = new Date(2026, 0, 5);
    expect(formatToISO(getWeekStart(monday))).toBe('2026-01-05');
  });
});

describe('normalizeWeekStartDate', () => {
  it('snaps a Sunday forward to Monday', () => {
    expect(normalizeWeekStartDate('2026-01-04')).toBe('2026-01-05');
  });

  it('snaps a mid-week date back to Monday of the same week', () => {
    expect(normalizeWeekStartDate('2026-01-08')).toBe('2026-01-05');
  });

  it('leaves an already-Monday date unchanged', () => {
    expect(normalizeWeekStartDate('2026-01-05')).toBe('2026-01-05');
  });
});

describe('getWeeksInRange', () => {
  it('produces consecutive Mondays spanning the range', () => {
    const weeks = getWeeksInRange('2026-01-05', '2026-01-26');
    expect(weeks).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });

  it('snaps a mid-week start date to its Monday before enumerating', () => {
    const weeks = getWeeksInRange('2026-01-07', '2026-01-12');
    expect(weeks[0]).toBe('2026-01-05');
  });
});

describe('getWeek1Start', () => {
  it('resolves to the Monday of the week containing the first Thursday of the year', () => {
    // 2026-01-01 is a Thursday, so ISO week 1 starts the Monday before it.
    expect(formatToISO(getWeek1Start(2026))).toBe('2025-12-29');
  });
});

describe('getWeekNumber', () => {
  it('assigns week 1 to the first Thursday of the year', () => {
    expect(getWeekNumber('2026-01-01')).toBe(1);
  });

  it('assigns late-December dates that belong to next ISO year to week 1', () => {
    // 2025-12-29 (Monday) starts the week containing 2026-01-01 (Thursday).
    expect(getWeekNumber('2025-12-29')).toBe(1);
  });
});

describe('getAllWeeksOfYear', () => {
  it('starts on the ISO week-1 Monday and stays within the target ISO year', () => {
    const weeks = getAllWeeksOfYear(2026);
    expect(weeks[0]).toBe('2025-12-29');
    expect(weeks.every((w) => getWeekNumber(w, 2026) >= 1)).toBe(true);
  });
});
