/**
 * Business-day arithmetic for the Mail Assistant, in Europe/Brussels. Everything works on calendar days ("YYYY-MM-DD"), so a day never shifts
 * with the server's time zone. A business day is Monday to Friday and not a Belgian public holiday. Nothing here is AI.
 */
const BRUSSELS = "Europe/Brussels";

export type Day = string; // YYYY-MM-DD

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: unknown): v is Day => typeof v === "string" && DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

const parts = (date: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: BRUSSELS, ...opts }).formatToParts(date);

/** The Brussels calendar day of an instant. */
export function brusselsDayOf(date: Date | string): Day {
  const p = parts(typeof date === "string" ? new Date(date) : date, { year: "numeric", month: "2-digit", day: "2-digit" });
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The Brussels hour (0-23) of an instant. */
export function brusselsHour(date: Date): number {
  const h = Number(parts(date, { hour: "2-digit", hour12: false }).find((x) => x.type === "hour")!.value);
  return h === 24 ? 0 : h;
}

const toUtc = (day: Day) => new Date(`${day}T00:00:00Z`);
const fromUtc = (d: Date): Day => d.toISOString().slice(0, 10);

export function addDays(day: Day, n: number): Day {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** Whole calendar days from `a` to `b` (negative when b is earlier). */
export function calendarDaysBetween(a: Day, b: Day): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** 0 = Sunday ... 6 = Saturday. */
export const weekdayOf = (day: Day): number => toUtc(day).getUTCDay();

/* ------------------------------------- Belgian public holidays ------------------------------------- */

/** Easter Sunday (Gregorian, anonymous algorithm). */
function easter(year: number): Day {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

const holidayCache = new Map<number, Set<Day>>();

/** Belgian public holidays of a year: fixed dates plus the Easter-dependent ones. */
export function belgianHolidays(year: number): Set<Day> {
  let set = holidayCache.get(year);
  if (set) return set;
  const e = easter(year);
  const fixed = ["01-01", "05-01", "07-21", "08-15", "11-01", "11-11", "12-25"].map((md) => `${year}-${md}`);
  set = new Set<Day>([...fixed, addDays(e, 1), addDays(e, 39), addDays(e, 50)]); // Easter Monday, Ascension, Whit Monday
  holidayCache.set(year, set);
  return set;
}

export function isBusinessDay(day: Day): boolean {
  const w = weekdayOf(day);
  return w !== 0 && w !== 6 && !belgianHolidays(Number(day.slice(0, 4))).has(day);
}

/** The first business day on or after `day`. */
export function onOrNextBusinessDay(day: Day): Day {
  let d = day;
  for (let i = 0; i < 14 && !isBusinessDay(d); i++) d = addDays(d, 1);
  return d;
}

/** `day` plus `n` business days (n >= 0). Starting on a weekend or holiday counts from the next business day. */
export function addBusinessDays(day: Day, n: number): Day {
  let d = day;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isBusinessDay(d)) left--;
  }
  return d;
}

/** Business days after `from` up to and including `to` (0 when `to` is not later). */
export function businessDaysBetween(from: Day, to: Day): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to && n < 400; d = addDays(d, 1)) if (isBusinessDay(d)) n++;
  return n;
}

/* -------------------------------------------- send timing -------------------------------------------- */

/** Mail is suggested for working hours: not before 08:00, not from 17:00 on, never on weekends or holidays. */
export const SEND_HOURS = { from: 8, until: 17 } as const;

/**
 * The day on which a message that is allowed to go out can reasonably be sent: today during business hours, otherwise the next business day
 * (so a draft prepared at night or on a Saturday is suggested for the next working morning).
 */
export function recommendedSendDay(now: Date, earliest?: Day): Day {
  const today = brusselsDayOf(now);
  if (earliest && earliest > today) return onOrNextBusinessDay(earliest);
  // Before 08:00 on a working day the message can go out later that same morning; from 17:00 on it waits for the next working day.
  if (isBusinessDay(today) && brusselsHour(now) < SEND_HOURS.until) return today;
  return onOrNextBusinessDay(addDays(today, 1));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "8 Nov 2026". */
export function formatDayLabel(day: Day): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Today", "Tomorrow" or "Mon 9 Nov 2026" relative to `today`. */
export function relativeDayLabel(day: Day, today: Day): string {
  const diff = calendarDaysBetween(today, day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[weekdayOf(day)]} ${formatDayLabel(day)}`;
}
