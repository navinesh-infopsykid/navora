/**
 * Date-range helpers for invoice filters ("today", "this week", ...).
 *
 * The server may run in UTC while the shop is in India, so every range is
 * calculated in the shop's timezone (APP_TIMEZONE, default Asia/Kolkata)
 * and returned as UTC Date objects for the database query.
 *
 * All ranges are half-open: start <= invoiceDate < end.
 */
import { badRequest } from "./errors";

export type RangePreset = "all" | "today" | "yesterday" | "week" | "month" | "custom";
export const RANGE_PRESETS: RangePreset[] = ["all", "today", "yesterday", "week", "month", "custom"];

export interface DateRange {
  start: Date;
  end: Date;
}

interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Milliseconds the timezone is ahead of UTC at the given instant (IST = +5h30m). */
function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The calendar date (in the given timezone) at a moment in time. */
export function localDateOf(date: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** UTC instant of local midnight for a calendar date. Day/month overflow is normalised (day 32 -> next month). */
export function startOfLocalDay(d: LocalDate, timeZone: string): Date {
  const guess = Date.UTC(d.year, d.month - 1, d.day);
  let result = guess - offsetMs(guess, timeZone);
  // Re-check once for timezones with daylight-saving changes.
  const corrected = guess - offsetMs(result, timeZone);
  if (corrected !== result) result = corrected;
  return new Date(result);
}

function addDays(d: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Parse "YYYY-MM-DD" strictly. */
export function parseDateOnly(text: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw badRequest(`Invalid date "${text}". Use YYYY-MM-DD.`);
  const d = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(Date.UTC(d.year, d.month - 1, d.day));
  if (check.getUTCMonth() !== d.month - 1 || check.getUTCDate() !== d.day) {
    throw badRequest(`Invalid date "${text}"`);
  }
  return d;
}

/**
 * Returns the UTC [start, end) range for a preset, or null for "all".
 * Weeks start on Monday.
 */
export function getDateRange(
  preset: RangePreset,
  options: { from?: string; to?: string; now?: Date; timeZone: string },
): DateRange | null {
  const { timeZone } = options;
  const today = localDateOf(options.now ?? new Date(), timeZone);

  switch (preset) {
    case "all":
      return null;
    case "today":
      return { start: startOfLocalDay(today, timeZone), end: startOfLocalDay(addDays(today, 1), timeZone) };
    case "yesterday": {
      const y = addDays(today, -1);
      return { start: startOfLocalDay(y, timeZone), end: startOfLocalDay(today, timeZone) };
    }
    case "week": {
      // JavaScript: Sunday = 0. Convert so Monday = 0.
      const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
      const monday = addDays(today, -((weekday + 6) % 7));
      return { start: startOfLocalDay(monday, timeZone), end: startOfLocalDay(addDays(monday, 7), timeZone) };
    }
    case "month": {
      const first = { year: today.year, month: today.month, day: 1 };
      const nextFirst = { year: today.year, month: today.month + 1, day: 1 };
      return { start: startOfLocalDay(first, timeZone), end: startOfLocalDay(nextFirst, timeZone) };
    }
    case "custom": {
      if (!options.from || !options.to) throw badRequest("Custom range needs both 'from' and 'to' dates");
      const from = parseDateOnly(options.from);
      const to = parseDateOnly(options.to);
      const start = startOfLocalDay(from, timeZone);
      const end = startOfLocalDay(addDays(to, 1), timeZone); // "to" is inclusive
      if (end <= start) throw badRequest("'from' date must be on or before 'to' date");
      return { start, end };
    }
    default:
      throw badRequest(`Unknown date range "${preset}"`);
  }
}

/** Format a date for invoices, e.g. "12 Oct 2026, 09:15 pm", in the shop timezone. */
export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
