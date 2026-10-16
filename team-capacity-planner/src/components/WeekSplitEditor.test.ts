import { describe, it, expect } from 'vitest';
import { computeWeeklyHours, computeMatrixHours } from './WeekSplitEditor';

describe('computeWeeklyHours', () => {
  it('returns the full total for a single week (weekCount 1), even mode', () => {
    expect(computeWeeklyHours(20, 1, true, [])).toEqual([20]);
  });

  it('returns the full total for a single week (weekCount 1), manual mode', () => {
    // weekCount 1 is always treated as even/whole, regardless of isEven or weeklyInputs --
    // this is what keeps the feature a no-op for every existing single-week assignment.
    expect(computeWeeklyHours(20, 1, false, ['5'])).toEqual([20]);
  });

  it('divides evenly across N weeks and the parts sum back to the total exactly', () => {
    const parts = computeWeeklyHours(20, 3, true, []);
    expect(parts).toHaveLength(3);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(20, 10);
    // 20 / 3 does not divide evenly -- exact decimals are expected (no special rounding).
    parts.forEach((p) => expect(p).toBeCloseTo(20 / 3, 10));
  });

  it('uses the typed manual values as-is when every week has one', () => {
    expect(computeWeeklyHours(20, 3, false, ['5', '7', '8'])).toEqual([5, 7, 8]);
  });

  it('fills blank manual weeks with an even share of whatever remains', () => {
    // Week 1 = 5 (typed), weeks 2-3 blank -> remaining 15h split evenly between them.
    const parts = computeWeeklyHours(20, 3, false, ['5', '', '']);
    expect(parts[0]).toBe(5);
    expect(parts[1]).toBeCloseTo(7.5, 10);
    expect(parts[2]).toBeCloseTo(7.5, 10);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(20, 10);
  });

  it('treats a fully blank manual table the same as even distribution', () => {
    const manual = computeWeeklyHours(20, 4, false, []);
    const even = computeWeeklyHours(20, 4, true, []);
    expect(manual).toEqual(even);
  });

  it('never lets manually-typed values exceed the total silently -- remainder clamps to 0', () => {
    // Typed values alone already exceed the 20h total; the (blank) remaining weeks get 0,
    // not a negative share.
    const parts = computeWeeklyHours(20, 3, false, ['15', '10', '']);
    expect(parts[0]).toBe(15);
    expect(parts[1]).toBe(10);
    expect(parts[2]).toBe(0);
  });

  it('clamps weekCount into [1, 52] and rounds non-integers', () => {
    expect(computeWeeklyHours(10, 0, true, [])).toHaveLength(1);
    expect(computeWeeklyHours(10, -3, true, [])).toHaveLength(1);
    expect(computeWeeklyHours(10, 2.6, true, [])).toHaveLength(3);
    expect(computeWeeklyHours(10, 999, true, [])).toHaveLength(52);
  });

  it('handles a zero total gracefully (all-zero weeks, no NaN)', () => {
    expect(computeWeeklyHours(0, 3, true, [])).toEqual([0, 0, 0]);
    expect(computeWeeklyHours(0, 3, false, ['', '', ''])).toEqual([0, 0, 0]);
  });
});

describe('computeMatrixHours', () => {
  it('divides evenly across every (week, column) cell when even and the cells sum to the total', () => {
    // 20h, 2 weeks, 2 people -> 5h in each of the 4 cells (matches the "entre todas las
    // celdas por igual" even-split rule).
    const result = computeMatrixHours(20, 2, ['daniel', 'guadalupe'], true, {});
    expect(result).toEqual({
      'daniel::0': 5, 'guadalupe::0': 5,
      'daniel::1': 5, 'guadalupe::1': 5,
    });
  });

  it('keeps manually typed per-cell values as-is when every cell has one', () => {
    const result = computeMatrixHours(20, 2, ['a', 'b'], false, {
      'a::0': '3', 'b::0': '7',
      'a::1': '4', 'b::1': '6',
    });
    expect(result).toEqual({ 'a::0': 3, 'b::0': 7, 'a::1': 4, 'b::1': 6 });
  });

  it('fills blank cells with an even share of whatever remains, across the whole grid', () => {
    // 20h total, one cell typed (a::0 = 8), the other 3 cells blank -> 12h left, split 3 ways.
    const result = computeMatrixHours(20, 2, ['a', 'b'], false, { 'a::0': '8' });
    expect(result['a::0']).toBe(8);
    expect(result['b::0']).toBeCloseTo(4, 10);
    expect(result['a::1']).toBeCloseTo(4, 10);
    expect(result['b::1']).toBeCloseTo(4, 10);
    expect(Object.values(result).reduce((s, v) => s + v, 0)).toBeCloseTo(20, 10);
  });

  it('collapses to a single implicit column when no column ids are given', () => {
    const result = computeMatrixHours(10, 2, [], true, {});
    expect(result).toEqual({ '__total__::0': 5, '__total__::1': 5 });
  });

  it('always returns the whole total for a single cell (1 week, 1 column), ignoring stale manual input', () => {
    // No breakdown UI exists for a single cell, so it can never diverge from the real total --
    // this is what keeps the per-person grid a no-op until there are genuinely 2+ weeks or
    // 2+ people to break the total down across.
    expect(computeMatrixHours(20, 1, ['solo'], false, { 'solo::0': '5' })).toEqual({ 'solo::0': 20 });
    expect(computeMatrixHours(20, 1, [], false, { '__total__::0': '5' })).toEqual({ '__total__::0': 20 });
  });
});
