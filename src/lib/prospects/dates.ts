/**
 * Calendar-day helpers for the CRM. Everything is a "YYYY-MM-DD" string meaning a day in Europe/Brussels
 * (no time of day is ever invented), so follow-up arithmetic never drifts with the server's time zone.
 */

const TZ = "Europe/Brussels";
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** Today's calendar day in Brussels. */
export function brusselsToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const toUtc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  return fromUtc(toUtc(day) + days * 86_400_000);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(to: string, from: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** Sunday that ends the (Monday-first) week containing `day`. */
export function endOfWeek(day: string): string {
  const dow = new Date(toUtc(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? 0 : 7 - dow);
}

export type FollowUpState =
  | { kind: "none" }
  | { kind: "overdue"; days: number }
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "upcoming"; days: number };

/** Classifies a follow-up day against today (Brussels). Derived on the fly, never stored. */
export function classifyFollowUp(followUp: string | null | undefined, today: string): FollowUpState {
  if (!followUp) return { kind: "none" };
  const delta = diffDays(followUp, today);
  if (delta < 0) return { kind: "overdue", days: -delta };
  if (delta === 0) return { kind: "today" };
  if (delta === 1) return { kind: "tomorrow" };
  return { kind: "upcoming", days: delta };
}

export function followUpLabel(state: FollowUpState): string {
  switch (state.kind) {
    case "none":
      return "No follow-up";
    case "overdue":
      return `Overdue ${state.days} ${state.days === 1 ? "day" : "days"}`;
    case "today":
      return "Due today";
    case "tomorrow":
      return "Tomorrow";
    case "upcoming":
      return `In ${state.days} days`;
  }
}

export const FOLLOW_UP_PRESETS = [
  { id: "tomorrow", label: "Tomorrow", days: 1 },
  { id: "3d", label: "3 days", days: 3 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "14d", label: "14 days", days: 14 },
] as const;

/** "29 Oct 2026" for a calendar day (formatted without a time zone shift). */
export function formatDay(day: string | null | undefined): string {
  if (!day || !isIsoDay(day)) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(toUtc(day)));
}

const NL_MONTHS: Record<string, number> = {
  jan: 1, januari: 1, feb: 2, februari: 2, mrt: 3, maart: 3, apr: 4, april: 4, mei: 5, jun: 6, juni: 6,
  jul: 7, juli: 7, aug: 8, augustus: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Parses a date a person (or a spreadsheet) wrote: ISO, dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, "29 okt 2026",
 * "29 Oct 2026". Day-first (Belgian) for numeric forms. Returns null when it isn't a real calendar day.
 */
export function parseFlexibleDay(raw: unknown): string | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`;
  }
  if (typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!text) return null;

  let y: number;
  let m: number;
  let d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t ].*)?$/.exec(text);
  if (hit) {
    [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  } else if ((hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text))) {
    [d, m, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  } else if ((hit = /^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/.exec(text))) {
    const month = NL_MONTHS[hit[2]] ?? EN_MONTHS[hit[2]];
    if (!month) return null;
    [d, m, y] = [Number(hit[1]), month, Number(hit[3])];
  } else {
    return null;
  }

  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isIsoDay(iso) ? iso : null;
}
