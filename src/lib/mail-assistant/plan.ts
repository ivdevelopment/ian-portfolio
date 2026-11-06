import { STATUS_LABELS } from "@/lib/prospects/constants";
import { addBusinessDays, businessDaysBetween, recommendedSendDay, type Day } from "./timing";
import type { ActionType, Facts, Plan, Step } from "./types";

/**
 * Conservative, deterministic timing. All numbers are business days (Europe/Brussels, no weekends or Belgian holidays) and are meant to be
 * configurable later: they live here and nowhere else. The sequence is deliberately short: first message, two follow-ups, then leave the
 * prospect alone. Nobody is chased endlessly.
 */
export const TIMING = {
  /** First follow-up: 3 to 5 business days after the first message. */
  followUp1: { min: 3, max: 5 },
  /** Second (final) follow-up: 5 to 7 business days after the first follow-up. */
  followUp2: { min: 5, max: 7 },
  /** Concept follow-up: 2 to 4 business days after the preview was viewed; 3 when it was only sent. */
  conceptViewed: { min: 2, max: 4 },
  conceptSent: { min: 3, max: 5 },
  /** Quote follow-up: 3 to 5 business days after the quote was sent; the second one 5 to 7 after the first. */
  quote1: { min: 3, max: 5 },
  quote2: { min: 5, max: 7 },
  /** Meeting follow-up: 2 business days after the meeting was arranged. */
  meeting: { min: 2, max: 4 },
  /** After this many unanswered messages in a sequence there is no further suggestion. */
  maxUnanswered: 3,
} as const;

const days = (n: number | null) => (n === null ? "some time ago" : n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);

type Ctx = { f: Facts; now: Date };

function base(f: Facts): Pick<Plan, "language" | "warnings"> {
  return { language: f.language, warnings: f.warnings };
}

const stop = (f: Facts, reason: string, step: Step = "stop"): Plan => ({ action: "no_action", then: null, step, is_final: true, recommended_on: null, reason, needs_ai: false, blocked: null, ...base(f) });

/** A message that is allowed now (draft it) or later (wait, then do it). `anchor` is the day the waiting period counts from. */
function schedule(c: Ctx, o: { action: ActionType; step: Step; is_final: boolean; anchor: Day | null; waitBusinessDays: number; reasonNow: string; reasonLater: string }): Plan {
  const { f, now } = c;
  const earliest = o.anchor ? addBusinessDays(o.anchor, o.waitBusinessDays) : null;
  if (earliest && earliest > f.today) {
    return { action: "wait", then: o.action, step: o.step, is_final: o.is_final, recommended_on: earliest, reason: o.reasonLater, needs_ai: false, blocked: null, ...base(f) };
  }
  return { action: o.action, then: null, step: o.step, is_final: o.is_final, recommended_on: recommendedSendDay(now), reason: o.reasonNow, needs_ai: true, blocked: null, ...base(f) };
}

/** Decides what, if anything, should be sent to this prospect next. Pure: the same facts and the same moment always give the same plan. */
export function decidePlan(f: Facts, now: Date): Plan {
  const c: Ctx = { f, now };

  // 1. Closed prospects: no cold outreach, ever, unless Ian reopens them (changes the status himself).
  if (f.closed) {
    if (f.crm_status === "won") return stop(f, "This prospect is already a client. No outreach is suggested.");
    if (f.crm_status === "no_response") return stop(f, "Marked as No response. Leave this prospect alone unless something changes.");
    return stop(f, `Marked as ${STATUS_LABELS[f.crm_status]}. No outreach is suggested unless you reopen this prospect.`);
  }

  // 2. They wrote last: answer them. Never invent what they said.
  if (f.latest_is_incoming) {
    const when = days(f.last_incoming_days_ago);
    if (f.inbound?.sufficient) {
      return { action: "reply", then: null, step: "reply", is_final: false, recommended_on: recommendedSendDay(now), reason: `The prospect replied ${when} and has not had an answer yet.`, needs_ai: true, blocked: null, ...base(f) };
    }
    return { action: "reply", then: null, step: "reply", is_final: false, recommended_on: recommendedSendDay(now), reason: `The prospect replied ${when}, but the stored mail text is too short to answer properly. More email context needed.`, needs_ai: false, blocked: "more_context_needed", ...base(f) };
  }

  // 3. A quote was answered by a decision: nothing to chase.
  if (f.quote && (f.quote.status === "accepted" || f.quote.status === "rejected")) {
    return stop(f, f.quote.status === "accepted" ? "The quote was accepted. No outreach is suggested." : "The quote was declined. No outreach is suggested.");
  }

  // 4. An open quote.
  if (f.quote && (f.quote.status === "sent" || f.crm_status === "quote_sent")) {
    const anchor = f.last_outgoing_on ?? f.quote.sent_on;
    if (f.quote.touches_after >= 2) return stop(f, "Two follow-ups on the quote went unanswered. Leave it for now, or pick up the phone.", "stop");
    const second = f.quote.touches_after === 1;
    return schedule(c, {
      action: "quote_follow_up",
      step: second ? "quote_follow_up_2_final" : "quote_follow_up_1",
      is_final: second,
      anchor,
      waitBusinessDays: second ? TIMING.quote2.min : TIMING.quote1.min,
      reasonNow: f.quote.sent_on
        ? `The quote was sent ${days(daysSince(f.quote.sent_on, f.today))} with no reply${second ? ", and one follow-up is already out" : ""}.`
        : `The prospect is marked as having received a quote, and no reply is recorded${second ? "; one follow-up is already out" : ""}.`,
      reasonLater: `The quote was sent ${days(f.last_outgoing_days_ago)}. Give it a few working days before following up.`,
    });
  }

  // 5. A concept / preview was shared.
  if (f.concept?.active) {
    if (f.concept.touches_after >= 2) return stop(f, "Two follow-ups on the concept went unanswered. Leave it for now.", "stop");
    const second = f.concept.touches_after === 1;
    const viewed = f.concept.preview_viewed;
    const anchor = viewed && !second ? latest(f.concept.first_viewed_on, f.last_outgoing_on) : f.last_outgoing_on ?? f.concept.first_viewed_on;
    return schedule(c, {
      action: "concept_follow_up",
      step: second ? "concept_follow_up_2_final" : "concept_follow_up_1",
      is_final: second,
      anchor,
      waitBusinessDays: second ? TIMING.followUp2.min : viewed ? TIMING.conceptViewed.min : TIMING.conceptSent.min,
      reasonNow: `The concept was shared and there has been no reply${second ? ", and one follow-up is already out" : ""}.`,
      reasonLater: `The concept was shared ${days(f.last_outgoing_days_ago)}. Wait a little before following up.`,
    });
  }

  // 6. A planned meeting.
  if (f.crm_status === "meeting_planned") {
    if (f.unanswered_touches >= TIMING.maxUnanswered) return stop(f, "Several messages around the meeting went unanswered. Leave it for now.");
    return schedule(c, {
      action: "meeting_follow_up",
      step: "meeting_follow_up",
      is_final: false,
      anchor: f.meeting_planned_on ?? f.last_outgoing_on,
      waitBusinessDays: TIMING.meeting.min,
      reasonNow: "A meeting was planned. A short follow-up keeps it moving.",
      reasonLater: "A meeting was planned recently. Give it a couple of working days.",
    });
  }

  // 7. The ordinary outreach sequence: first message, follow-up 1, follow-up 2 (final), then stop.
  const n = f.unanswered_touches;
  if (n === 0) {
    const noEmail = !f.has_email;
    return {
      action: "first_outreach",
      then: null,
      step: "first_outreach",
      is_final: false,
      recommended_on: recommendedSendDay(now),
      reason: f.outgoing_touches === 0 ? "No previous outreach found." : "The conversation is open and nothing is waiting for an answer.",
      needs_ai: true,
      blocked: null,
      language: f.language,
      warnings: noEmail ? [...f.warnings, "This prospect has no email address yet."] : f.warnings,
    };
  }
  if (n >= TIMING.maxUnanswered) return stop(f, `${n} messages have gone unanswered. Leave this prospect alone; the sequence is finished.`);
  const second = n === 2;
  return schedule(c, {
    action: "follow_up",
    step: second ? "follow_up_2_final" : "follow_up_1",
    is_final: second,
    anchor: f.last_outgoing_on,
    waitBusinessDays: second ? TIMING.followUp2.min : TIMING.followUp1.min,
    reasonNow: second ? `Two messages are unanswered (the last one ${days(f.last_outgoing_days_ago)}). One last, short follow-up, then stop.` : `The first message was sent ${days(f.last_outgoing_days_ago)} with no reply.`,
    reasonLater: `You emailed this prospect ${days(f.last_outgoing_days_ago)}. Give them time to answer.`,
  });
}

function daysSince(day: Day, today: Day): number {
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000));
}

function latest(a: Day | null, b: Day | null): Day | null {
  if (a && b) return a > b ? a : b;
  return a ?? b;
}

/** How many business days have passed since a day (for display and tests). */
export const businessDaysSince = (day: Day, today: Day) => businessDaysBetween(day, today);
