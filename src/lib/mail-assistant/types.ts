import type { ProspectPriority, ProspectStatus } from "@/lib/prospects/constants";
import type { Day } from "./timing";
import type { Language } from "./language";

/**
 * The fixed vocabulary of the Mail Assistant. The model may only pick one of these; it can never invent a workflow name.
 *   first_outreach       never contacted: the first message
 *   follow_up            an earlier message got no answer (follow-up 1, or the final one)
 *   reply                the prospect wrote last: answer them
 *   concept_follow_up    a concept / preview was shared and there is no answer
 *   quote_follow_up      a quote was sent and there is no answer
 *   meeting_follow_up    after a planned meeting
 *   wait                 nothing to send yet; the plan says when
 *   no_action            leave this prospect alone
 */
export const ACTION_TYPES = ["first_outreach", "follow_up", "reply", "concept_follow_up", "quote_follow_up", "meeting_follow_up", "wait", "no_action"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** The actions that come with a draft. */
export const DRAFT_ACTIONS: readonly ActionType[] = ["first_outreach", "follow_up", "reply", "concept_follow_up", "quote_follow_up", "meeting_follow_up"];
export const isDraftAction = (a: string): a is ActionType => (DRAFT_ACTIONS as readonly string[]).includes(a);

export const ACTION_LABELS: Record<ActionType, string> = {
  first_outreach: "First outreach",
  follow_up: "Follow up",
  reply: "Reply",
  concept_follow_up: "Follow up on concept",
  quote_follow_up: "Follow up on quote",
  meeting_follow_up: "Follow up on meeting",
  wait: "Wait",
  no_action: "No action",
};

/** Where in the (short, deliberately limited) sequence this message sits. */
export const STEPS = ["first_outreach", "follow_up_1", "follow_up_2_final", "reply", "concept_follow_up_1", "concept_follow_up_2_final", "quote_follow_up_1", "quote_follow_up_2_final", "meeting_follow_up", "stop"] as const;
export type Step = (typeof STEPS)[number];

/* ------------------------------------------- inputs ------------------------------------------- */

export type MailInput = { id: string; direction: "incoming" | "outgoing"; subject: string | null; snippet: string | null; sent_at: string };
export type ActivityInput = { id: string; type: string; title: string; occurred_on: string; occurred_at: string | null; created_at: string };
export type QuoteInput = { id: string; status: string; sentAt: string | null; createdAt: string; title: string | null };
export type PreviewInput = { linked: boolean; id: string | null; firstAccessedAt: string | null; lastAccessedAt: string | null; accessCount: number };
export type InsightInput = { summary: string | null; opportunity: string | null; observations: string[] };
export type ProjectInput = { title: string; published: boolean };
export type ProspectInput = {
  id: string;
  company_name: string;
  contact_name: string | null;
  sector: string | null;
  city: string | null;
  website_url: string | null;
  email: string | null;
  status: ProspectStatus;
  priority: ProspectPriority;
  source: string | null;
  first_contact_on: string | null;
  last_contact_on: string | null;
  next_follow_up_on: string | null;
};

export type AssistantInputs = {
  now: Date;
  prospect: ProspectInput;
  mail: readonly MailInput[];
  activities: readonly ActivityInput[];
  quotes: readonly QuoteInput[];
  preview: PreviewInput | null;
  insight: InsightInput | null;
  project: ProjectInput | null;
};

/* ------------------------------------------- facts ------------------------------------------- */

/** Everything the plan is decided from. Built deterministically from the CRM; the model never has to infer any of it from raw history. */
export type Facts = {
  today: Day;
  crm_status: ProspectStatus;
  closed: boolean;
  has_email: boolean;
  first_outreach_on: Day | null;
  outgoing_touches: number;
  /** Outreach days since the prospect last wrote (all of them when they never did). */
  unanswered_touches: number;
  last_outgoing_on: Day | null;
  last_outgoing_days_ago: number | null;
  last_incoming_on: Day | null;
  last_incoming_days_ago: number | null;
  has_reply: boolean;
  latest_is_incoming: boolean;
  inbound: { subject: string | null; snippet: string | null; sufficient: boolean } | null;
  concept: { active: boolean; sent_on: Day | null; preview_linked: boolean; preview_viewed: boolean; first_viewed_on: Day | null; last_viewed_on: Day | null; touches_after: number } | null;
  quote: { status: string; sent_on: Day | null; title: string | null; touches_after: number } | null;
  meeting_planned_on: Day | null;
  language: Language;
  /** Things to double-check before sending, e.g. a status that does not match the recorded history. */
  warnings: string[];
};

/* -------------------------------------------- plan -------------------------------------------- */

export type Plan = {
  action: ActionType;
  /** For `wait`: the action that becomes appropriate on `recommended_on`. */
  then: ActionType | null;
  step: Step;
  is_final: boolean;
  /** The business day this should go out (or be done). For draft actions: today during business hours, otherwise the next business day. */
  recommended_on: Day | null;
  reason: string;
  /** A draft should be generated by the model. False for wait, no_action and for a reply that lacks context. */
  needs_ai: boolean;
  blocked: "more_context_needed" | null;
  language: Language;
  warnings: string[];
};

export type Recommendation = {
  action_type: ActionType;
  recommended_send_at: Day | null;
  should_send_now: boolean;
  subject: string;
  body: string;
  reason_summary: string;
};
