import { uniqueSlug } from "@/lib/slug";
import { normalizeWebsite } from "@/lib/schemas/prospect";
import { STATUS_LABELS, type ActivityType, type ProspectStatus } from "./constants";
import type { ActivityRecord, ProspectRecord } from "./types";

export type QuickAction = "mark_contacted" | "reply_received" | "mark_won" | "mark_lost";

export type ActivityDraft = { type: ActivityType; title: string; description?: string | null; occurred_on?: string };

/**
 * What a one-click action changes. A real status change is recorded by the database (never twice); when the
 * status is already the target, the action is still a real event (another contact, another reply), so an
 * activity is added for it. Dates are only ever set to the day the person clicked.
 */
export function quickActionPatch(
  action: QuickAction,
  current: Pick<ProspectRecord, "status" | "first_contact_on" | "last_contact_on">,
  today: string,
): { patch: Record<string, unknown>; activity: ActivityDraft | null } {
  const target: ProspectStatus = { mark_contacted: "contacted", reply_received: "replied", mark_won: "won", mark_lost: "lost" }[action] as ProspectStatus;
  const unchanged = current.status === target;
  const patch: Record<string, unknown> = { status: target };

  if (action === "mark_contacted" || action === "reply_received") {
    patch.last_contact_on = today;
    if (action === "mark_contacted" && !current.first_contact_on) patch.first_contact_on = today;
  }

  let activity: ActivityDraft | null = null;
  if (unchanged && action === "mark_contacted") activity = { type: "contacted", title: "Contact logged", occurred_on: today };
  if (unchanged && action === "reply_received") activity = { type: "reply_received", title: "Reply received", occurred_on: today };
  return { patch, activity };
}

/** Activity written when a follow-up is scheduled, rescheduled or cleared. */
export function followUpSetActivity(next: string | null, previous: string | null, today: string): ActivityDraft | null {
  if (next === previous) return null;
  return next
    ? { type: "follow_up_set", title: previous ? "Follow-up rescheduled" : "Follow-up scheduled", occurred_on: today }
    : { type: "follow_up_set", title: "Follow-up cleared", occurred_on: today };
}

export function followUpDoneActivity(today: string): ActivityDraft {
  return { type: "follow_up_done", title: "Follow-up completed", occurred_on: today };
}

/** Timeline heading for an activity (status changes read from their metadata). */
export function activityHeading(a: Pick<ActivityRecord, "type" | "title" | "metadata">): { title: string; detail: string | null } {
  if (a.type === "status_changed") {
    const from = a.metadata.from as ProspectStatus | undefined;
    const to = a.metadata.to as ProspectStatus | undefined;
    if (to) {
      return {
        title: `Status: ${STATUS_LABELS[to] ?? to}`,
        detail: from ? `From ${STATUS_LABELS[from] ?? from}` : null,
      };
    }
  }
  return { title: a.title, detail: null };
}

/** A project draft from a prospect: only what the prospect really says. Nothing is published or invented. */
export function projectDraftFromProspect(
  prospect: Pick<ProspectRecord, "company_name" | "sector" | "website_url">,
  takenSlugs: Iterable<string>,
) {
  const live = normalizeWebsite(prospect.website_url ?? "");
  return {
    slug: uniqueSlug(prospect.company_name, takenSlugs),
    title: prospect.company_name.slice(0, 120),
    // The projects table requires these; they are clearly marked placeholders on an unpublished draft.
    short_description: "Draft created from a prospect. Add the description before publishing.",
    category: (prospect.sector ?? "Website").slice(0, 80),
    client: prospect.company_name.slice(0, 120),
    live_url: live,
    published: false,
    featured: false,
  };
}
