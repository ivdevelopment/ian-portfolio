import type { ActivityRecord } from "@/lib/prospects/types";
import { STATUS_LABELS, type ProspectStatus } from "@/lib/prospects/constants";

/** Mail rows as the CRM shows them (a subset of mail_messages). */
export type MailRow = {
  id: string;
  direction: "incoming" | "outgoing";
  from_address: string;
  subject: string | null;
  snippet: string | null;
  sent_at: string;
};

export type TimelineItem =
  | { kind: "activity"; key: string; day: string; sortAt: string; activity: ActivityRecord }
  | { kind: "email"; key: string; day: string; sortAt: string; mail: MailRow };

/** Brussels calendar day of an instant. */
export function brusselsDay(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * When an activity "happened" for ordering. A day-only activity logged on a LATER day (an import, a backfill) has no real time,
 * so it sorts at the start of its day instead of at the moment it was recorded, and never jumps above mail that was really sent that day.
 */
export function activitySortKey(a: Pick<ActivityRecord, "occurred_on" | "occurred_at" | "created_at">): string {
  if (a.occurred_at) return a.occurred_at;
  return brusselsDay(a.created_at) === a.occurred_on ? a.created_at : `${a.occurred_on}T00:00:00.000Z`;
}

/**
 * One timeline, newest first, rendered from two separate sources: CRM activities and synced mail. Mail is never copied
 * into `prospect_activities`.
 */
export function mergeTimeline(activities: readonly ActivityRecord[], mail: readonly MailRow[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...activities.map((a): TimelineItem => ({ kind: "activity", key: `a:${a.id}`, day: a.occurred_on, sortAt: activitySortKey(a), activity: a })),
    ...mail.map((m): TimelineItem => ({ kind: "email", key: `m:${m.id}`, day: brusselsDay(m.sent_at), sortAt: m.sent_at, mail: m })),
  ];
  // Newest day first; within a day newest first (a mail has an exact time, activities fall back to when they were logged).
  return items.sort((a, b) => (a.day !== b.day ? (a.day > b.day ? -1 : 1) : a.sortAt > b.sortAt ? -1 : a.sortAt < b.sortAt ? 1 : 0));
}

const REPLIED_OR_CLOSED: readonly ProspectStatus[] = ["replied", "interested", "concept_sent", "meeting_planned", "quote_sent", "won", "lost", "not_interested"];

/**
 * "New reply detected": the most recent message is an incoming one, after the last outgoing one, and the prospect is not
 * already marked as having replied. A suggestion only: the status is never changed automatically.
 */
export function suggestReply(status: ProspectStatus, mail: readonly MailRow[]): { mail: MailRow; suggestedStatus: "replied"; currentLabel: string } | null {
  if (REPLIED_OR_CLOSED.includes(status)) return null;
  const sorted = [...mail].sort((a, b) => (a.sent_at > b.sent_at ? -1 : 1));
  const latest = sorted[0];
  if (!latest || latest.direction !== "incoming") return null;
  return { mail: latest, suggestedStatus: "replied", currentLabel: STATUS_LABELS[status] };
}

/** "Last email" summary for a prospect, or null. */
export function lastEmail(mail: readonly MailRow[]): MailRow | null {
  return [...mail].sort((a, b) => (a.sent_at > b.sent_at ? -1 : 1))[0] ?? null;
}
