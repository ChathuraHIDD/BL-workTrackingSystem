/**
 * Date helpers fixed to the business timezone (Asia/Colombo, UTC+05:30, no DST).
 * Calendar dates are handled as ISO strings (YYYY-MM-DD) so the viewer's own
 * device timezone can never shift a due date.
 */
export const BUSINESS_TZ = 'Asia/Colombo';
const OFFSET = '+05:30';

const isoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function toColomboISODate(d: Date): string {
  return isoFmt.format(d);
}

export function todayISO(): string {
  return toColomboISODate(new Date());
}

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, n: number): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((utc(a).getTime() - utc(b).getTime()) / 86_400_000);
}

/** Monday of the week containing `iso` (weeks run Monday → Sunday). */
export function weekStart(iso: string): string {
  const dow = (utc(iso).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -dow);
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEnd(iso: string): string {
  const d = utc(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, n: number): string {
  const d = utc(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export interface DateRange {
  from: string;
  to: string;
}

export type PresetKey =
  | 'today'
  | 'this_week'
  | 'next_week'
  | 'last_week'
  | 'this_month'
  | 'next_month'
  | 'last_month'
  | 'last_30_days';

export const PRESET_LABELS: Record<PresetKey, string> = {
  today: 'Today',
  this_week: 'This Week',
  next_week: 'Next Week',
  last_week: 'Last Week',
  this_month: 'This Month',
  next_month: 'Next Month',
  last_month: 'Last Month',
  last_30_days: 'Last 30 Days',
};

export function presetRange(key: PresetKey, today = todayISO()): DateRange {
  const ws = weekStart(today);
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'this_week':
      return { from: ws, to: addDays(ws, 6) };
    case 'next_week':
      return { from: addDays(ws, 7), to: addDays(ws, 13) };
    case 'last_week':
      return { from: addDays(ws, -7), to: addDays(ws, -1) };
    case 'this_month':
      return { from: monthStart(today), to: monthEnd(today) };
    case 'next_month': {
      const m = addMonths(today, 1);
      return { from: m, to: monthEnd(m) };
    }
    case 'last_month': {
      const m = addMonths(today, -1);
      return { from: m, to: monthEnd(m) };
    }
    case 'last_30_days':
      return { from: addDays(today, -29), to: today };
  }
}

/** Inclusive date range → timestamp bounds in Asia/Colombo: [from 00:00, to+1 00:00). */
export function startOfDayTs(iso: string): string {
  return `${iso}T00:00:00${OFFSET}`;
}
export function endExclusiveTs(iso: string): string {
  return `${addDays(iso, 1)}T00:00:00${OFFSET}`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: BUSINESS_TZ,
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateFmt.format(utc(iso.slice(0, 10)));
}

export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  return dateTimeFmt.format(new Date(ts));
}

/** For exports: "2026-11-07 14:32" in Asia/Colombo. */
export function formatDateTimeISO(ts: string | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function relativeTime(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return formatDateTime(ts);
}

export function dueLabel(due: string, completed: boolean, today = todayISO()): string {
  if (completed) return formatDate(due);
  const d = diffDays(due, today);
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d > 1) return `Due in ${d} days`;
  if (d === -1) return '1 day overdue';
  return `${-d} days overdue`;
}

export function isValidISODate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(utc(v).getTime());
}
