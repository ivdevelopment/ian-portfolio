import { ACTION_LABELS, type ActionType, type Plan } from "./types";
import { changedParts, type Fingerprint, type StaleReason } from "./context";
import { formatDayLabel, relativeDayLabel, type Day } from "./timing";

/**
 * Everything the Mail Assistant tab shows, as plain data. A pure function of the deterministic plan, the stored recommendation rows and the
 * state of the agent, so each situation (never contacted, waiting, reply, outdated draft, agent offline ...) is testable without a browser.
 */
export type RecommendationRow = {
  id: string;
  status: "queued" | "generating" | "current" | "used" | "superseded" | "dismissed" | "failed";
  action_type: ActionType | null;
  recommended_send_at: string | null;
  subject: string | null;
  body: string | null;
  reason_summary: string | null;
  language: "nl" | "en" | null;
  context_fingerprint: string;
  fingerprint_parts: Record<string, string>;
  requested_at: string;
  generated_at: string | null;
  used_at: string | null;
  failure_kind: string | null;
  attempts: number;
};

export type AgentInfo = { registered: boolean; online: boolean; codexState: "ready" | "not_installed" | "not_authenticated" | "error" | null; lastFailureKind: string | null };

export type Availability = { state: "ready" | "disabled" | "agent_offline" | "codex_not_ready"; message: string | null };

export const UNAVAILABLE_MESSAGE = "Mail Assistant unavailable";
export const START_AGENT_MESSAGE = "Start Ian Prospect Agent on your PC.";

export function availability(providerIsLocalCodex: boolean, agent: AgentInfo | null): Availability {
  if (!providerIsLocalCodex) return { state: "disabled", message: "The Mail Assistant is not switched on for this CRM." };
  if (!agent || !agent.registered || !agent.online) return { state: "agent_offline", message: `${UNAVAILABLE_MESSAGE}. ${START_AGENT_MESSAGE}` };
  if (agent.codexState !== "ready") return { state: "codex_not_ready", message: `${UNAVAILABLE_MESSAGE}. Codex is not ready on your PC${agent.codexState === "not_authenticated" ? ": sign in again" : agent.codexState === "not_installed" ? ": it is not installed" : ""}.` };
  return { state: "ready", message: null };
}

const FAILURE_TEXT: Record<string, string> = {
  codex_usage_limit: "Your Codex usage limit has been reached. Try again when your allowance resets.",
  codex_not_authenticated: "Codex on your PC is not signed in.",
  codex_not_installed: "Codex is not installed on your PC.",
  codex_timeout: "Codex took too long. Try again.",
  invalid_output: "The draft did not pass the safety checks. Regenerate to try again.",
  not_allowed: "No draft is appropriate right now.",
  network_error: "Codex could not reach its service. Try again.",
  agent_stopped: "The agent stopped before the draft was ready. Try again.",
  cancelled: "The request was cancelled.",
  agent_error: "The draft could not be generated. Try again.",
};
export const failureText = (kind: string | null) => (kind ? (FAILURE_TEXT[kind] ?? FAILURE_TEXT.agent_error) : FAILURE_TEXT.agent_error);

export type StaleInfo = { outdated: boolean; headline: string | null; detail: string | null; reasons: StaleReason[] | ["timing"] };

/** A recommendation is outdated when the history it was written from changed, or when the rules now call for something else. */
export function staleness(row: Pick<RecommendationRow, "context_fingerprint" | "fingerprint_parts" | "action_type">, current: Fingerprint, plan: Plan): StaleInfo {
  const reasons = row.context_fingerprint === current.fingerprint ? [] : changedParts(row.fingerprint_parts, current);
  if (reasons.length > 0) {
    return reasons.includes("mail")
      ? { outdated: true, headline: "New mail activity detected", detail: "This draft was written before the latest mail. Refresh the recommendation.", reasons }
      : { outdated: true, headline: "This prospect's history changed", detail: "This draft was written before the latest changes. Refresh the recommendation.", reasons };
  }
  // The history is the same, but time has moved on: the right next step is now a different one (e.g. waiting is over, or a send is no longer advised).
  if (row.action_type && row.action_type !== plan.action) {
    return { outdated: true, headline: "The timing has changed", detail: `The right next step is now "${ACTION_LABELS[plan.action]}". Refresh the recommendation.`, reasons: ["timing"] };
  }
  return { outdated: false, headline: null, detail: null, reasons: [] };
}

export type AssistantView = {
  prospectId: string;
  today: Day;
  plan: {
    action: ActionType;
    actionLabel: string;
    /** For a wait: what the suggested next step will be. */
    thenLabel: string | null;
    recommendedOn: Day | null;
    recommendedLabel: string | null;
    timingLabel: string | null;
    reason: string;
    warnings: string[];
    blocked: Plan["blocked"];
    isFinal: boolean;
    needsDraft: boolean;
  };
  availability: Availability;
  /** The draft to show, if there is one. */
  draft: null | { id: string; used: boolean; usedAt: string | null; subject: string; body: string; reasonSummary: string | null; generatedAt: string | null; actionLabel: string; language: "nl" | "en" | null; stale: StaleInfo };
  /** A request that is being worked on. */
  job: null | { id: string; stage: "waiting_agent" | "generating"; stuck: boolean };
  failure: null | { message: string; kind: string | null };
  /** What the main button does, or null when there is nothing to generate. */
  generate: null | { label: "Generate draft" | "Regenerate" | "Refresh recommendation"; enabled: boolean; disabledReason: string | null };
};

const STUCK_AFTER_MS = 3 * 60_000;

export function buildAssistantView(o: {
  prospectId: string;
  plan: Plan;
  fingerprint: Fingerprint;
  today: Day;
  now: Date;
  rows: readonly RecommendationRow[];
  agent: AgentInfo | null;
  providerIsLocalCodex: boolean;
}): AssistantView {
  const { plan, rows } = o;
  const avail = availability(o.providerIsLocalCodex, o.agent);
  const open = rows.find((r) => r.status === "queued" || r.status === "generating") ?? null;
  const current = rows.find((r) => r.status === "current") ?? null;
  const used = [...rows].filter((r) => r.status === "used").sort((a, b) => ((a.used_at ?? "") < (b.used_at ?? "") ? 1 : -1))[0] ?? null;
  const latestFailed = [...rows].filter((r) => r.status === "failed").sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1))[0] ?? null;

  // A used draft stays visible only while nothing changed since: after a synced mail it is history, and the plan speaks for itself.
  const shown = current ?? (used && used.context_fingerprint === o.fingerprint.fingerprint ? used : null);
  const stale = shown ? staleness(shown, o.fingerprint, plan) : null;

  const wait = plan.action === "wait";
  const view: AssistantView = {
    prospectId: o.prospectId,
    today: o.today,
    plan: {
      action: plan.action,
      actionLabel: ACTION_LABELS[plan.action],
      thenLabel: wait && plan.then ? ACTION_LABELS[plan.then] : null,
      recommendedOn: plan.recommended_on,
      recommendedLabel: plan.recommended_on ? formatDayLabel(plan.recommended_on) : null,
      timingLabel: plan.recommended_on ? relativeDayLabel(plan.recommended_on, o.today) : null,
      reason: plan.reason,
      warnings: plan.warnings,
      blocked: plan.blocked,
      isFinal: plan.is_final,
      needsDraft: plan.needs_ai,
    },
    availability: avail,
    draft: shown && shown.subject !== null && shown.body !== null
      ? { id: shown.id, used: shown.status === "used", usedAt: shown.used_at, subject: shown.subject, body: shown.body, reasonSummary: shown.reason_summary, generatedAt: shown.generated_at, actionLabel: ACTION_LABELS[shown.action_type ?? "no_action"], language: shown.language, stale: stale! }
      : null,
    job: open ? { id: open.id, stage: open.status === "generating" ? "generating" : "waiting_agent", stuck: open.status === "queued" && o.now.getTime() - Date.parse(open.requested_at) > STUCK_AFTER_MS } : null,
    failure: !open && latestFailed && (!current || latestFailed.requested_at > (current.generated_at ?? current.requested_at)) && (!used || latestFailed.requested_at > (used.used_at ?? "")) ? { message: failureText(latestFailed.failure_kind), kind: latestFailed.failure_kind } : null,
    generate: null,
  };

  // The generate button exists only when a draft is actually called for, and only while no request is already running.
  if (plan.needs_ai && !open) {
    const hasDraft = Boolean(view.draft && !view.draft.stale.outdated);
    const label = view.draft?.stale.outdated ? "Refresh recommendation" : hasDraft ? "Regenerate" : "Generate draft";
    view.generate = { label, enabled: avail.state === "ready", disabledReason: avail.state === "ready" ? null : avail.message };
  }
  // An outdated draft is still returned (the page shows it collapsed, without copy buttons) so nothing disappears silently, but it is never
  // offered as the message to send: `stale.outdated` is true whenever the plan no longer calls for the action it was written for.
  return view;
}
