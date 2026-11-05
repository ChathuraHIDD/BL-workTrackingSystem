import { describe, expect, it } from 'vitest';
import { addDays, endExclusiveTs, monthEnd, presetRange, startOfDayTs, toColomboISODate, weekStart, dueLabel } from '../dates';

describe('business dates (Asia/Colombo)', () => {
  it('converts instants to the Colombo calendar date', () => {
    // 2026-11-05 19:00 UTC is 2026-11-06 00:30 in Colombo
    expect(toColomboISODate(new Date('2026-11-05T19:00:00Z'))).toBe('2026-11-06');
    expect(toColomboISODate(new Date('2026-11-05T18:29:00Z'))).toBe('2026-11-05');
  });

  it('weeks run Monday to Sunday', () => {
    expect(weekStart('2026-11-05')).toBe('2026-11-02'); // Thursday → Monday
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // Sunday belongs to the same week
    expect(weekStart('2026-11-09')).toBe('2026-11-09'); // Monday
    expect(presetRange('this_week', '2026-11-05')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(presetRange('next_week', '2026-11-05')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(presetRange('last_week', '2026-11-05')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });

  it('month presets handle month lengths and year ends', () => {
    expect(presetRange('this_month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetRange('next_month', '2026-12-15')).toEqual({ from: '2027-01-01', to: '2027-01-31' });
    expect(presetRange('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(monthEnd('2028-02-03')).toBe('2028-02-29');
  });

  it('inclusive date ranges map to Colombo-midnight timestamp bounds', () => {
    expect(startOfDayTs('2026-11-02')).toBe('2026-11-02T00:00:00+05:30');
    expect(endExclusiveTs('2026-11-08')).toBe('2026-11-09T00:00:00+05:30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('describes due dates relative to today', () => {
    expect(dueLabel('2026-11-05', false, '2026-11-05')).toBe('Due today');
    expect(dueLabel('2026-11-06', false, '2026-11-05')).toBe('Due tomorrow');
    expect(dueLabel('2026-11-02', false, '2026-11-05')).toBe('3 days overdue');
  });
});
