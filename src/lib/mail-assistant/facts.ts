import { CLOSED_STATUSES } from "@/lib/prospects/constants";
import { activitySortKey } from "@/lib/mail/timeline";
import { conversationLanguage } from "./language";
import { brusselsDayOf, calendarDaysBetween, type Day } from "./timing";
import type { AssistantInputs, Facts } from "./types";

/**
 * The deterministic state of a prospect's outreach, computed from the CRM with no AI. An "event" is one thing that happened between Ian and the
 * prospect; they come from the places they live in (synced Zoho mail, hand-logged CRM activities, sent quotes) and are never copied between them.
 *
 *   outreach   a mail Ian sent (Zoho outgoing) or logged as "contacted" / "follow-up sent"
 *   concept    "concept sent"
 *   quote      "quote sent" or a quote that was sent
 *   in         a mail from the prospect, or "reply received"
 *
 * Several messages on the same Brussels day count as ONE touch, so a mail that is both synced and logged by hand is not counted twice.
 */
type Ev = { at: number; day: Day; dir: "in" | "out"; cat: "outreach" | "concept" | "quote" | "meeting" | "in" | "other"; mailId?: string };

const OUTREACH_ACTIVITY = new Set(["contacted", "follow_up_sent"]);
/** A snippet shorter than this cannot be answered properly: the assistant says more email context is needed instead of guessing. */
export const MIN_REPLY_CONTEXT_CHARS = 20;

const ms = (iso: string) => new Date(iso).getTime();

function activityAt(a: AssistantInputs["activities"][number]): number {
  return ms(activitySortKey({ occurred_on: a.occurred_on, occurred_at: a.occurred_at, created_at: a.created_at }));
}

export function computeFacts(input: AssistantInputs): Facts {
  const { prospect, now } = input;
  const today = brusselsDayOf(now);
  const events: Ev[] = [];

  for (const m of input.mail) events.push({ at: ms(m.sent_at), day: brusselsDayOf(m.sent_at), dir: m.direction === "incoming" ? "in" : "out", cat: m.direction === "incoming" ? "in" : "outreach", mailId: m.id });
  for (const a of input.activities) {
    const at = activityAt(a);
    const day = a.occurred_on;
    if (OUTREACH_ACTIVITY.has(a.type)) events.push({ at, day, dir: "out", cat: "outreach" });
    else if (a.type === "concept_sent") events.push({ at, day, dir: "out", cat: "concept" });
    else if (a.type === "quote_sent") events.push({ at, day, dir: "out", cat: "quote" });
    else if (a.type === "reply_received") events.push({ at, day, dir: "in", cat: "in" });
    else if (a.type === "meeting_planned") events.push({ at, day, dir: "out", cat: "meeting" }); // a meeting arrangement is contact too (waiting rules), not outreach
  }
  for (const q of input.quotes) if (q.sentAt) events.push({ at: ms(q.sentAt), day: brusselsDayOf(q.sentAt), dir: "out", cat: "quote" });

  // A prospect imported with contact dates but no recorded mail was still contacted: do not suggest a "first" outreach to them.
  const realOutbound = events.some((e) => e.dir === "out");
  const warnings: string[] = [];
  if (!realOutbound) {
    for (const day of new Set([prospect.first_contact_on, prospect.last_contact_on].filter((d): d is string => Boolean(d)))) events.push({ at: ms(`${day}T09:00:00Z`), day, dir: "out", cat: "outreach" });
  }

  const outbound = events.filter((e) => e.dir === "out").sort((a, b) => a.at - b.at);
  const inbound = events.filter((e) => e.dir === "in").sort((a, b) => a.at - b.at);
  const lastOut = outbound.at(-1) ?? null;
  const lastIn = inbound.at(-1) ?? null;
  const touchDays = (list: Ev[]) => new Set(list.map((e) => e.day));
  const outreach = outbound.filter((e) => e.cat === "outreach");
  const afterLastIn = lastIn ? outreach.filter((e) => e.at > lastIn.at) : outreach;
  const daysAgo = (day: Day | null) => (day ? Math.max(0, calendarDaysBetween(day, today)) : null);
  const touchesAfter = (day: Day | null) => (day ? touchDays(outbound.filter((e) => e.day > day)).size : 0);

  // The prospect wrote last when their latest message is after everything Ian sent.
  const latestIsIncoming = Boolean(lastIn && (!lastOut || lastIn.at > lastOut.at));
  const latestInMail = [...input.mail].filter((m) => m.direction === "incoming").sort((a, b) => ms(b.sent_at) - ms(a.sent_at))[0] ?? null;
  const snippet = latestInMail?.snippet?.replace(/\s+/g, " ").trim() ?? "";
  const inboundInfo = latestIsIncoming ? { subject: latestInMail?.subject ?? null, snippet: snippet || null, sufficient: snippet.length >= MIN_REPLY_CONTEXT_CHARS } : null;

  // Concept: a recorded "concept sent", the CRM status, or a preview the prospect has opened (they were obviously given the link).
  const preview = input.preview;
  const firstViewedOn = preview?.firstAccessedAt ? brusselsDayOf(preview.firstAccessedAt) : null;
  const lastViewedOn = preview?.lastAccessedAt ? brusselsDayOf(preview.lastAccessedAt) : null;
  const conceptSentOn = outbound.filter((e) => e.cat === "concept").at(-1)?.day ?? null;
  const conceptActive = prospect.status === "concept_sent" || conceptSentOn !== null || firstViewedOn !== null;
  const concept = conceptActive || preview?.linked
    ? { active: conceptActive, sent_on: conceptSentOn, preview_linked: Boolean(preview?.linked), preview_viewed: firstViewedOn !== null, first_viewed_on: firstViewedOn, last_viewed_on: lastViewedOn, touches_after: touchesAfter(conceptSentOn ?? firstViewedOn ?? lastOut?.day ?? null) }
    : null;

  // The latest quote that was actually sent decides the quote state.
  const sentQuotes = input.quotes.filter((q) => q.sentAt || ["sent", "accepted", "rejected"].includes(q.status)).sort((a, b) => ms(b.sentAt ?? b.createdAt) - ms(a.sentAt ?? a.createdAt));
  const q = sentQuotes[0] ?? null;
  const quoteSentOn = q?.sentAt ? brusselsDayOf(q.sentAt) : (outbound.filter((e) => e.cat === "quote").at(-1)?.day ?? null);
  const quote = q ? { status: q.status, sent_on: quoteSentOn, title: q.title, touches_after: touchesAfter(quoteSentOn) } : prospect.status === "quote_sent" ? { status: "sent", sent_on: quoteSentOn, title: null, touches_after: touchesAfter(quoteSentOn) } : null;

  const meetingOn = outbound.filter((e) => e.cat === "meeting").at(-1)?.day ?? null;

  if (["contacted", "follow_up_due"].includes(prospect.status) && outreach.length === 0) warnings.push("The CRM status says contacted, but no mail or contact is recorded. Check before sending a first message.");

  const language = conversationLanguage(
    [...input.mail].sort((a, b) => ms(b.sent_at) - ms(a.sent_at)).slice(0, 8).map((m) => ({ direction: m.direction, text: `${m.subject ?? ""} ${m.snippet ?? ""}` })),
  );

  return {
    today,
    crm_status: prospect.status,
    closed: CLOSED_STATUSES.includes(prospect.status),
    has_email: Boolean(prospect.email && prospect.email.includes("@")),
    first_outreach_on: outreach[0]?.day ?? null,
    outgoing_touches: touchDays(outreach).size,
    unanswered_touches: touchDays(afterLastIn).size,
    last_outgoing_on: lastOut?.day ?? null,
    last_outgoing_days_ago: daysAgo(lastOut?.day ?? null),
    last_incoming_on: lastIn?.day ?? null,
    last_incoming_days_ago: daysAgo(lastIn?.day ?? null),
    has_reply: Boolean(lastIn) || ["replied", "interested", "meeting_planned", "quote_sent", "concept_sent"].includes(prospect.status),
    latest_is_incoming: latestIsIncoming,
    inbound: inboundInfo,
    concept,
    quote,
    meeting_planned_on: meetingOn,
    language,
    warnings,
  };
}
