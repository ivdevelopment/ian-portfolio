import type { SupabaseClient } from "@supabase/supabase-js";
import { getAgentStatus } from "@/lib/prospecting/agent/service";
import { providerFlag } from "@/lib/prospecting/config";
import { getInsightForProspect } from "@/lib/prospecting/service";
import type { Database } from "@/types/database";
import { buildContext, computeFingerprint, type Fingerprint } from "./context";
import { computeFacts } from "./facts";
import { insightFromCandidate } from "./insight";
import { decidePlan } from "./plan";
import { brusselsDayOf } from "./timing";
import { parseToneChoice, type ToneChoice } from "./tone";
import type { AssistantInputs, Facts, Plan, ProspectInput } from "./types";
import { buildAssistantView, type AgentInfo, type AssistantView, type RecommendationRow } from "./view";

type Db = SupabaseClient<Database>;

const PROSPECT_COLUMNS = "id, company_name, contact_name, sector, city, website_url, email, status, priority, source, first_contact_on, last_contact_on, next_follow_up_on, linked_preview_id, linked_project_id";
const ROW_COLUMNS = "id, status, tone_preset, custom_instruction, action_type, recommended_send_at, subject, body, reason_summary, language, context_fingerprint, fingerprint_parts, requested_at, generated_at, used_at, failure_kind, attempts";

export type LoadedAssistant = { inputs: AssistantInputs; facts: Facts; plan: Plan; fingerprint: Fingerprint };

/** Reads what the assistant may use about one prospect: the prospect, their history (mail metadata and snippets, activities, quotes, preview, project) and the discovery insight. */
export async function loadAssistant(db: Db, prospectId: string, now = new Date()): Promise<LoadedAssistant | null> {
  const { data: p } = await db.from("prospects").select(PROSPECT_COLUMNS).eq("id", prospectId).maybeSingle();
  if (!p) return null;
  const [activities, mail, quotes, preview, project, insight] = await Promise.all([
    db.from("prospect_activities").select("id, type, title, occurred_on, occurred_at, created_at").eq("prospect_id", prospectId).order("occurred_on", { ascending: false }).limit(200),
    db.from("mail_messages").select("id, direction, subject, snippet, sent_at").eq("prospect_id", prospectId).order("sent_at", { ascending: false }).limit(100),
    db.from("quotes").select("id, status, sent_at, created_at, title").eq("prospect_id", prospectId).order("created_at", { ascending: false }).limit(20),
    p.linked_preview_id ? db.from("client_previews").select("id, first_accessed_at, last_accessed_at, successful_access_count").eq("id", p.linked_preview_id).maybeSingle() : Promise.resolve({ data: null }),
    p.linked_project_id ? db.from("projects").select("title, published").eq("id", p.linked_project_id).maybeSingle() : Promise.resolve({ data: null }),
    getInsightForProspect(db, prospectId),
  ]);
  const prospect: ProspectInput = {
    id: p.id, company_name: p.company_name, contact_name: p.contact_name, sector: p.sector, city: p.city, website_url: p.website_url, email: p.email,
    status: p.status as ProspectInput["status"], priority: p.priority as ProspectInput["priority"], source: p.source,
    first_contact_on: p.first_contact_on, last_contact_on: p.last_contact_on, next_follow_up_on: p.next_follow_up_on,
  };
  const inputs: AssistantInputs = {
    now,
    prospect,
    mail: (mail.data ?? []).map((m) => ({ id: m.id, direction: m.direction as "incoming" | "outgoing", subject: m.subject, snippet: m.snippet, sent_at: m.sent_at })),
    activities: (activities.data ?? []).map((a) => ({ id: a.id, type: a.type, title: a.title, occurred_on: a.occurred_on, occurred_at: a.occurred_at, created_at: a.created_at })),
    quotes: (quotes.data ?? []).map((q) => ({ id: q.id, status: q.status, sentAt: q.sent_at, createdAt: q.created_at, title: q.title })),
    preview: preview.data ? { linked: true, id: preview.data.id, firstAccessedAt: preview.data.first_accessed_at, lastAccessedAt: preview.data.last_accessed_at, accessCount: preview.data.successful_access_count } : p.linked_preview_id ? { linked: true, id: p.linked_preview_id, firstAccessedAt: null, lastAccessedAt: null, accessCount: 0 } : null,
    insight: insightFromCandidate(insight),
    project: project.data ? { title: project.data.title, published: project.data.published } : null,
  };
  const facts = computeFacts(inputs);
  return { inputs, facts, plan: decidePlan(facts, now), fingerprint: computeFingerprint(inputs) };
}

async function agentInfo(db: Db, now: number): Promise<AgentInfo | null> {
  const a = await getAgentStatus(db, now);
  return a ? { registered: true, online: a.online, codexState: a.codexState, lastFailureKind: a.lastFailureKind } : null;
}

async function listRows(db: Db, prospectId: string): Promise<RecommendationRow[]> {
  const { data } = await db.from("prospect_mail_recommendations").select(ROW_COLUMNS).eq("prospect_id", prospectId).order("requested_at", { ascending: false }).limit(20);
  return (data ?? []) as unknown as RecommendationRow[];
}

/** The whole tab, ready to render. Reads only; never calls Codex. */
export async function getAssistantView(db: Db, prospectId: string, now = new Date(), env: Record<string, string | undefined> = process.env): Promise<AssistantView | null> {
  const loaded = await loadAssistant(db, prospectId, now);
  if (!loaded) return null;
  const local = providerFlag(env) === "local_codex";
  const [rows, agent] = await Promise.all([listRows(db, prospectId), local ? agentInfo(db, now.getTime()) : Promise.resolve(null)]);
  return buildAssistantView({ prospectId, plan: loaded.plan, fingerprint: loaded.fingerprint, today: brusselsDayOf(now), now, rows, agent, providerIsLocalCodex: local });
}

export type RequestResult = { ok: true; jobId: string; alreadyOpen: boolean } | { ok: false; error: string; code: "not_found" | "no_draft_needed" | "unavailable" | "failed" };

/**
 * Queues ONE draft for the local agent. Only an explicit person action calls this (Generate, Regenerate, Refresh): opening the page never does.
 * The plan and the minimal context are fixed here, on the server, from the CRM: the agent cannot choose what is sent to Codex or what is allowed.
 */
export async function requestRecommendation(db: Db, userId: string, prospectId: string, now = new Date(), env: Record<string, string | undefined> = process.env, toneInput?: unknown): Promise<RequestResult> {
  const parsed = parseToneChoice(toneInput);
  if (!parsed.ok) return { ok: false, error: parsed.error, code: "failed" };
  const tone: ToneChoice = parsed.tone;
  const loaded = await loadAssistant(db, prospectId, now);
  if (!loaded) return { ok: false, error: "Prospect not found.", code: "not_found" };
  if (!loaded.plan.needs_ai) return { ok: false, error: loaded.plan.reason, code: "no_draft_needed" };
  const local = providerFlag(env) === "local_codex";
  const agent = local ? await agentInfo(db, now.getTime()) : null;
  const view = buildAssistantView({ prospectId, plan: loaded.plan, fingerprint: loaded.fingerprint, today: brusselsDayOf(now), now, rows: [], agent, providerIsLocalCodex: local });
  if (view.availability.state !== "ready") return { ok: false, error: view.availability.message ?? "Mail Assistant unavailable.", code: "unavailable" };

  const context = buildContext(loaded.inputs, loaded.facts, loaded.plan, tone);
  const { data, error } = await db
    .from("prospect_mail_recommendations")
    .insert({ prospect_id: prospectId, tone_preset: tone.preset, custom_instruction: tone.custom_instruction, plan: { ...loaded.plan, tone: tone.preset } as never, context: context as never, context_fingerprint: loaded.fingerprint.fingerprint, fingerprint_parts: loaded.fingerprint.parts as never, language: loaded.plan.language, requested_by: userId })
    .select("id")
    .single();
  if (error) {
    // The unique index allows one open request per prospect: a double click, or a second tab, finds the one already running instead.
    if (error.code === "23505") {
      const { data: open } = await db.from("prospect_mail_recommendations").select("id").eq("prospect_id", prospectId).in("status", ["queued", "generating"]).maybeSingle();
      if (open) return { ok: true, jobId: open.id, alreadyOpen: true };
    }
    return { ok: false, error: "That couldn't be saved. Please try again.", code: "failed" };
  }
  return { ok: true, jobId: data.id, alreadyOpen: false };
}

export const USED_ACTIVITY_TITLE = "Mail Assistant draft used";

/**
 * "Mark as used": the draft is kept as used and the prospect's history says so. This does NOT claim a mail was sent and changes no prospect
 * status: the real mail arrives through the Zoho sync, which stays the source of truth.
 */
export async function markUsed(db: Db, recommendationId: string, now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row } = await db.from("prospect_mail_recommendations").select("id, prospect_id, status, action_type, generated_at").eq("id", recommendationId).maybeSingle();
  if (!row || row.status !== "current") return { ok: false, error: "This draft can no longer be marked as used." };
  const usedAt = now.toISOString();
  const { data, error } = await db.from("prospect_mail_recommendations").update({ status: "used", used_at: usedAt }).eq("id", recommendationId).eq("status", "current").select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "That couldn't be saved. Please try again." };
  await db.from("prospect_activities").insert({
    prospect_id: row.prospect_id,
    type: "mail_assistant_used",
    title: `${USED_ACTIVITY_TITLE}: ${row.action_type ?? "mail"}`.slice(0, 200),
    occurred_on: brusselsDayOf(now),
    metadata: { recommendation_id: row.id, action_type: row.action_type, generated_at: row.generated_at } as never,
  });
  return { ok: true };
}

/** Dismisses the current draft or cancels an open request. Never touches the prospect. */
export async function dismiss(db: Db, recommendationId: string, now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await db.from("prospect_mail_recommendations").update({ status: "dismissed", dismissed_at: now.toISOString() }).eq("id", recommendationId).in("status", ["queued", "generating", "current"]).select("id").maybeSingle();
  if (error) return { ok: false, error: "That couldn't be saved. Please try again." };
  return data ? { ok: true } : { ok: false, error: "This recommendation was already dealt with." };
}
