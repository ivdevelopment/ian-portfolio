import { createHash } from "node:crypto";
import { DEFAULT_TONE, type ToneChoice } from "./tone";
import { brusselsDayOf, calendarDaysBetween } from "./timing";
import type { ActionType, AssistantInputs, Facts, Plan, Step } from "./types";

/**
 * What Codex is allowed to see about one prospect: only what is needed to write one message. No other prospect, no notes, no email ADDRESSES,
 * no quote amounts, no score, no raw website analysis. Dates are given as "days ago" so the draft can say "last week" truthfully.
 */
export type HistoryItem = { kind: "email_sent" | "email_received" | "concept_sent" | "quote_sent" | "contact_logged" | "reply_logged" | "meeting_planned"; days_ago: number; date: string; subject: string | null; snippet: string | null };

export type MailContext = {
  sender: { name: string; role: string };
  action: { type: ActionType; step: Step; is_final: boolean };
  /** How to word it. Style only: it never changes the action, the language, the facts or any rule. */
  tone: ToneChoice;
  language: "nl" | "en";
  prospect: { company: string; contact_name: string | null; sector: string | null; city: string | null; website: string | null; crm_status: string; priority: string };
  /** What the Prospect Finder noticed, as plain observations about the business. Never a score. */
  observations: { summary: string | null; opportunity: string | null; points: string[] } | null;
  history: HistoryItem[];
  facts: { first_message_days_ago: number | null; last_message_days_ago: number | null; unanswered_messages: number; prospect_has_replied: boolean };
  /** The prospect's latest message, for a reply. */
  inbound: { subject: string | null; snippet: string | null } | null;
  quote: { status: string; sent_days_ago: number | null; title: string | null } | null;
  /** A concept was shared. `internal_note` exists only so the draft can sound natural; it must never be mentioned. */
  concept: { shared: boolean } | null;
  project: { title: string } | null;
};

const SENDER = { name: "Ian Verlinden", role: "freelance web developer in Belgium who builds websites, booking and quote flows and small web apps" } as const;

const host = (url: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};
const clip = (s: string | null | undefined, n: number) => (s ? s.replace(/\s+/g, " ").trim().slice(0, n) || null : null);

export const HISTORY_LIMIT = 8;

export function buildHistory(input: AssistantInputs): HistoryItem[] {
  const today = brusselsDayOf(input.now);
  const age = (day: string) => Math.max(0, calendarDaysBetween(day, today));
  const items: Array<HistoryItem & { at: number }> = [];
  for (const m of input.mail) {
    const date = brusselsDayOf(m.sent_at);
    items.push({ kind: m.direction === "incoming" ? "email_received" : "email_sent", days_ago: age(date), date, subject: clip(m.subject, 120), snippet: clip(m.snippet, 300), at: Date.parse(m.sent_at) });
  }
  const kinds: Record<string, HistoryItem["kind"]> = { contacted: "contact_logged", follow_up_sent: "contact_logged", reply_received: "reply_logged", concept_sent: "concept_sent", quote_sent: "quote_sent", meeting_planned: "meeting_planned" };
  for (const a of input.activities) {
    const kind = kinds[a.type];
    if (kind) items.push({ kind, days_ago: age(a.occurred_on), date: a.occurred_on, subject: clip(a.title, 120), snippet: null, at: Date.parse(`${a.occurred_on}T12:00:00Z`) });
  }
  for (const q of input.quotes) {
    if (q.sentAt) items.push({ kind: "quote_sent", days_ago: age(brusselsDayOf(q.sentAt)), date: brusselsDayOf(q.sentAt), subject: clip(q.title, 120), snippet: null, at: Date.parse(q.sentAt) });
  }
  return items
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_LIMIT)
    .map(({ at, ...rest }) => (void at, rest));
}

export function buildContext(input: AssistantInputs, facts: Facts, plan: Plan, tone: ToneChoice = { preset: DEFAULT_TONE, custom_instruction: null }): MailContext {
  const p = input.prospect;
  const action = plan.action === "wait" && plan.then ? plan.then : plan.action;
  return {
    sender: { ...SENDER },
    action: { type: action, step: plan.step, is_final: plan.is_final },
    tone,
    language: plan.language,
    prospect: { company: p.company_name, contact_name: clip(p.contact_name, 80), sector: clip(p.sector, 80), city: clip(p.city, 80), website: host(p.website_url), crm_status: p.status, priority: p.priority },
    observations: input.insight && (input.insight.summary || input.insight.opportunity || input.insight.observations.length > 0)
      ? { summary: clip(input.insight.summary, 500), opportunity: clip(input.insight.opportunity, 200), points: input.insight.observations.slice(0, 4).map((o) => clip(o, 220)).filter((o): o is string => o !== null) }
      : null,
    history: buildHistory(input),
    facts: {
      first_message_days_ago: facts.first_outreach_on ? Math.max(0, calendarDaysBetween(facts.first_outreach_on, facts.today)) : null,
      last_message_days_ago: facts.last_outgoing_days_ago,
      unanswered_messages: facts.unanswered_touches,
      prospect_has_replied: facts.has_reply,
    },
    inbound: facts.inbound ? { subject: clip(facts.inbound.subject, 120), snippet: clip(facts.inbound.snippet, 500) } : null,
    quote: facts.quote ? { status: facts.quote.status, sent_days_ago: facts.quote.sent_on ? Math.max(0, calendarDaysBetween(facts.quote.sent_on, facts.today)) : null, title: clip(facts.quote.title, 120) } : null,
    concept: facts.concept?.active ? { shared: true } : null,
    project: input.project ? { title: clip(input.project.title, 120) ?? "" } : null,
  };
}

/* -------------------------------------------- freshness -------------------------------------------- */

const h = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

const RELEVANT_ACTIVITY = new Set(["contacted", "follow_up_sent", "reply_received", "concept_sent", "quote_sent", "meeting_planned", "won", "lost", "preview_linked", "preview_unlinked"]);

/**
 * A fingerprint of the history a recommendation was based on. When any relevant part changes (a newly synced mail, a logged activity, a quote,
 * the first time the preview was opened, the status), the stored recommendation is OUTDATED and is never silently reused. The parts are kept so
 * the page can say what changed ("New mail activity detected").
 */
export type Fingerprint = { fingerprint: string; parts: { mail: string; activity: string; quote: string; preview: string; status: string } };

export function computeFingerprint(input: AssistantInputs): Fingerprint {
  const parts = {
    mail: h([...input.mail].map((m) => [m.id, m.direction, m.sent_at]).sort()).slice(0, 16),
    activity: h(input.activities.filter((a) => RELEVANT_ACTIVITY.has(a.type)).map((a) => [a.id, a.type]).sort()).slice(0, 16),
    quote: h(input.quotes.map((q) => [q.id, q.status, q.sentAt]).sort()).slice(0, 16),
    preview: h([input.preview?.id ?? null, input.preview?.firstAccessedAt ?? null]).slice(0, 16),
    status: h([input.prospect.status, Boolean(input.prospect.email)]).slice(0, 16),
  };
  return { fingerprint: h(parts), parts };
}

export type StaleReason = "mail" | "activity" | "quote" | "preview" | "status";

/** Which parts differ between the fingerprint a recommendation was made from and the one the CRM has now. Empty = still current. */
export function changedParts(stored: Record<string, string> | null | undefined, current: Fingerprint): StaleReason[] {
  if (!stored) return ["activity"];
  return (Object.keys(current.parts) as StaleReason[]).filter((k) => stored[k] !== current.parts[k]);
}
