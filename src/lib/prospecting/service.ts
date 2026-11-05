import type { SupabaseClient } from "@supabase/supabase-js";
import { brusselsToday } from "@/lib/prospects/dates";
import { emptyProspectForm, toProspectRow, validateProspectForm } from "@/lib/schemas/prospect";
import type { Database } from "@/types/database";
import { businessKey, checkDuplicate, domainOfBusiness } from "./dedupe";
import type { CandidateInsert, PipelineStore, RunCounters, SeenOutcome } from "./pipeline";
import { reasonLines } from "./scoring";
import type { DiscoveryRequest, Observation, ScoreBreakdown, SearchMode } from "./types";

/**
 * Prospect discovery in the database. Every function takes the signed-in admin's client, so RLS decides who may do what. The only thing
 * here that creates a prospect is `addDiscoveryCandidate`, and it runs only when a person presses "Add prospect".
 */
type Db = SupabaseClient<Database>;

export const SOURCE_LABEL = "AI prospecting";
const RUN_STALE_MS = 15 * 60_000;
const generic = "That couldn't be saved. Please try again.";

/* ----------------------------------- runs ----------------------------------- */

/** queued -> claimed -> discovering -> analyzing -> qualifying -> completed | partial | failed | cancelled ("running" is the in-process mock). */
export type RunStatus = "queued" | "claimed" | "discovering" | "analyzing" | "qualifying" | "running" | "completed" | "partial" | "failed" | "cancelled";
export const ACTIVE_STATUSES: readonly RunStatus[] = ["queued", "claimed", "discovering", "analyzing", "qualifying", "running"];
/** States in which a person is waiting for the run: the page polls and offers Cancel. */
export const isActiveStatus = (s: RunStatus): boolean => ACTIVE_STATUSES.includes(s);

export type RunRow = {
  id: string;
  mode: SearchMode;
  location: string;
  area: string | null;
  industry: string | null;
  threshold: number;
  requested_count: number;
  status: RunStatus;
  stage: string | null;
  provider: string;
  raw_found: number;
  analyzed: number;
  qualified: number;
  duplicates_removed: number;
  skipped_cooldown: number;
  errors: string[];
  started_at: string;
  finished_at: string | null;
  /** Why a run failed, as a fixed sanitised kind (codex_usage_limit, codex_timeout...). */
  failure_kind: string | null;
  lease_expires_at: string | null;
  cancel_requested: boolean;
  codex_ms: number | null;
  codex_calls: number | null;
};

const RUN_COLUMNS = "id, mode, location, area, industry, threshold, requested_count, status, stage, provider, raw_found, analyzed, qualified, duplicates_removed, skipped_cooldown, errors, started_at, finished_at, failure_kind, lease_expires_at, cancel_requested, codex_ms, codex_calls";

/** A run that says "running" but has not been touched for a long time died with its server function: shown as failed, never as running forever. */
export function effectiveStatus(run: Pick<RunRow, "status" | "started_at" | "finished_at" | "lease_expires_at">, now = Date.now()): RunStatus {
  if (run.status === "running" && !run.finished_at && now - Date.parse(run.started_at) > RUN_STALE_MS) return "failed";
  // An agent that stopped heartbeating: the run is waiting to be picked up again (or fails after three attempts) rather than "in progress".
  if (["claimed", "discovering", "analyzing", "qualifying"].includes(run.status) && run.lease_expires_at && Date.parse(run.lease_expires_at) < now) return "queued";
  return run.status;
}

export async function createRun(db: Db, userId: string, request: DiscoveryRequest, provider: string, opts: { queued?: boolean } = {}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // One search at a time. A queued run counts for as long as it is queued; an in-process run only while it is plausibly still alive.
  const running = await db
    .from("prospect_discovery_runs")
    .select("id, started_at")
    .in("status", ["queued", "claimed", "discovering", "analyzing", "qualifying", "running"])
    .is("finished_at", null)
    .gt("started_at", new Date(Date.now() - (opts.queued ? 24 * 3600_000 : RUN_STALE_MS)).toISOString())
    .limit(1);
  if (running.error) return { ok: false, error: generic };
  if ((running.data ?? []).length > 0) return { ok: false, error: "A search is already running. Wait for it to finish." };
  const { data, error } = await db
    .from("prospect_discovery_runs")
    .insert({
      mode: request.mode,
      location: request.location,
      area: request.area,
      industry: request.industry,
      threshold: request.threshold,
      requested_count: request.count,
      exclude_researched: request.excludeResearched,
      provider,
      created_by: userId,
      ...(opts.queued ? { status: "queued", stage: "Queued, waiting for the agent…", events: [{ at: new Date().toISOString(), type: "queued" }] as never } : { stage: "Starting…" }),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: generic };
  return { ok: true, id: data.id };
}

export async function finishRun(db: Db, runId: string, status: "completed" | "partial" | "failed" | "cancelled", stage: string, counters: RunCounters, errors: string[]) {
  await db.from("prospect_discovery_runs").update({ status, stage, ...counters, errors: errors as never, finished_at: new Date().toISOString() }).eq("id", runId);
}

/** Asks a run to stop. A queued run is cancelled on the spot; one the agent is working on is flagged and the agent stops between steps, keeping what it found. */
export async function cancelRun(db: Db, runId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const queued = await db.from("prospect_discovery_runs").update({ status: "cancelled", stage: "Cancelled", finished_at: now, cancel_requested: true }).eq("id", runId).eq("status", "queued").select("id").maybeSingle();
  if (queued.error) return { ok: false, error: generic };
  if (queued.data) return { ok: true };
  const active = await db.from("prospect_discovery_runs").update({ cancel_requested: true, stage: "Cancelling…" }).eq("id", runId).in("status", ["claimed", "discovering", "analyzing", "qualifying"]).select("id").maybeSingle();
  if (active.error) return { ok: false, error: generic };
  return active.data ? { ok: true } : { ok: false, error: "This search has already finished." };
}

export async function listRuns(db: Db, limit = 8): Promise<RunRow[]> {
  const { data } = await db.from("prospect_discovery_runs").select(RUN_COLUMNS).order("started_at", { ascending: false }).limit(limit);
  return ((data ?? []) as unknown as RunRow[]).map((r) => ({ ...r, status: effectiveStatus(r) }));
}

export async function getRun(db: Db, runId: string): Promise<RunRow | null> {
  const { data } = await db.from("prospect_discovery_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle();
  const run = data as unknown as RunRow | null;
  return run ? { ...run, status: effectiveStatus(run) } : null;
}

/** The store the pipeline writes through: progress goes into the run row (that is what the page polls), candidates into their table. */
export function dbPipelineStore(db: Db, runId: string): PipelineStore {
  return {
    async context() {
      const [prospects, decided, seen] = await Promise.all([
        db.from("prospects").select("id, company_name, email, website_url, city").limit(20000),
        db.from("prospect_discovery_candidates").select("status, company_name, website_url, city, email").in("status", ["ignored", "pending"]).limit(5000),
        db.from("prospect_discovery_seen").select("domain, last_analyzed_at").limit(20000),
      ]);
      const rows = decided.data ?? [];
      const keyOf = (r: { company_name: string; website_url: string | null; city: string | null }) => businessKey({ companyName: r.company_name, websiteUrl: r.website_url, city: r.city });
      const ignoredRows = rows.filter((r) => r.status === "ignored");
      return {
        prospects: prospects.data ?? [],
        ignored: { domains: new Set(ignoredRows.map(keyOf).filter(Boolean)), emails: new Set(ignoredRows.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean)) },
        pending: new Set(rows.filter((r) => r.status === "pending").map(keyOf).filter(Boolean)),
        seen: seen.data ?? [],
      };
    },
    async progress(patch) {
      const { errors, ...rest } = patch;
      await db.from("prospect_discovery_runs").update({ ...rest, ...(errors ? { errors: errors as never } : {}) }).eq("id", runId);
    },
    async saveCandidates(rows: CandidateInsert[]) {
      const inserts = rows.map((r) => (r.kind === "candidate" ? candidateRow(runId, r) : duplicateRow(runId, r)));
      const { error } = await db.from("prospect_discovery_candidates").insert(inserts);
      if (error) throw new Error("candidates could not be saved");
    },
    async markSeen(entries) {
      if (entries.length === 0) return;
      const byDomain = new Map<string, { domain: string; outcome: SeenOutcome; score: number | null }>();
      for (const e of entries) byDomain.set(e.domain, e);
      const now = new Date().toISOString();
      const { error } = await db.from("prospect_discovery_seen").upsert([...byDomain.values()].map((e) => ({ domain: e.domain.toLowerCase(), outcome: e.outcome, last_score: e.score, last_analyzed_at: now, run_id: runId })), { onConflict: "domain" });
      if (error) throw new Error("history could not be saved");
    },
  };
}

function candidateRow(runId: string, r: Extract<CandidateInsert, { kind: "candidate" }>) {
  const { candidate: c } = r;
  const b = c.business;
  return {
    run_id: runId,
    company_name: b.companyName.slice(0, 200),
    website_url: b.websiteUrl,
    domain: domainOfBusiness(b) || null,
    email: b.email,
    phone: b.phone,
    city: b.city,
    region: b.region,
    industry: b.industry,
    score: c.score,
    score_breakdown: c.breakdown as never,
    summary: c.summary,
    opportunity: c.opportunity,
    evidence: c.evidence as never,
    source_urls: b.sourceUrls as never,
    synthetic: Boolean(b.synthetic),
    status: "pending",
  };
}

function duplicateRow(runId: string, r: Extract<CandidateInsert, { kind: "duplicate" }>) {
  const b = r.business;
  return { run_id: runId, company_name: b.companyName.slice(0, 200), website_url: b.websiteUrl, domain: domainOfBusiness(b) || null, email: b.email, phone: b.phone, city: b.city, region: b.region, industry: b.industry, score: 0, status: "rejected_duplicate", duplicate_of: r.duplicateOf, duplicate_reason: r.reason.slice(0, 200), synthetic: Boolean(b.synthetic) };
}

/* --------------------------------- candidates --------------------------------- */

export type CandidateView = {
  id: string;
  run_id: string;
  company_name: string;
  website_url: string | null;
  domain: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  industry: string | null;
  score: number;
  breakdown: ScoreBreakdown;
  summary: string | null;
  opportunity: string | null;
  evidence: Observation[];
  source_urls: string[];
  synthetic: boolean;
  status: "pending" | "added" | "ignored" | "rejected_duplicate";
  duplicate_of: string | null;
  duplicate_reason: string | null;
  created_at: string;
  added_prospect_id: string | null;
  /** The short "why this is interesting" lines, from the breakdown. */
  reasons: string[];
};

const CANDIDATE_COLUMNS = "id, run_id, company_name, website_url, domain, email, phone, city, region, industry, score, score_breakdown, summary, opportunity, evidence, source_urls, synthetic, status, duplicate_of, duplicate_reason, created_at, added_prospect_id";

type CandidateDbRow = Omit<CandidateView, "breakdown" | "reasons"> & { score_breakdown: ScoreBreakdown | Record<string, never> };

function toView(row: CandidateDbRow): CandidateView {
  const { score_breakdown, ...rest } = row;
  const breakdown = score_breakdown as ScoreBreakdown;
  return { ...rest, breakdown, reasons: Object.keys(score_breakdown).length > 0 ? reasonLines(breakdown) : [] };
}

export async function listCandidates(db: Db, filter: { status: CandidateView["status"]; runId?: string }, limit = 100): Promise<CandidateView[]> {
  let q = db.from("prospect_discovery_candidates").select(CANDIDATE_COLUMNS).eq("status", filter.status);
  if (filter.runId) q = q.eq("run_id", filter.runId);
  const { data } = await q.order(filter.status === "pending" ? "score" : "created_at", { ascending: false }).limit(limit);
  return ((data ?? []) as unknown as CandidateDbRow[]).map(toView);
}

export async function countPending(db: Db): Promise<number> {
  const { count } = await db.from("prospect_discovery_candidates").select("id", { count: "exact", head: true }).eq("status", "pending");
  return count ?? 0;
}

/* ----------------------------------- decide ----------------------------------- */

export type AddResult = { ok: true; prospectId: string; company: string } | { ok: false; error: string; duplicateOf?: string };

/**
 * "Add prospect": the only way a discovered business becomes a prospect. It reuses the CRM's own validation and row mapping (the same
 * schema as the New prospect form), starts at `researching` (a discovered business has NOT been contacted), copies only what was verified,
 * and leaves an activity behind. The claim (pending -> added) is atomic, so a double click creates one prospect.
 */
export async function addDiscoveryCandidate(db: Db, userId: string, id: string): Promise<AddResult> {
  const now = new Date().toISOString();
  const claimed = await db.from("prospect_discovery_candidates").update({ status: "added", reviewed_at: now, decided_by: userId }).eq("id", id).eq("status", "pending").select(CANDIDATE_COLUMNS).maybeSingle();
  if (claimed.error) return { ok: false, error: generic };
  if (!claimed.data) {
    const current = await db.from("prospect_discovery_candidates").select("status, added_prospect_id, company_name").eq("id", id).maybeSingle();
    if (current.data?.status === "added" && current.data.added_prospect_id) return { ok: true, prospectId: current.data.added_prospect_id, company: current.data.company_name };
    if (current.data?.status === "added") return { ok: false, error: "This candidate is already being added. Refresh in a moment." };
    return { ok: false, error: current.data ? "This candidate was already decided." : "Candidate not found." };
  }
  const c = toView(claimed.data as unknown as CandidateDbRow);
  const revert = () => db.from("prospect_discovery_candidates").update({ status: "pending", reviewed_at: null, decided_by: null }).eq("id", id);

  // Re-check against the live CRM: a prospect may have been added since the run.
  const live = await db.from("prospects").select("id, company_name, email, website_url, city").limit(20000);
  if (live.error) {
    await revert();
    return { ok: false, error: generic };
  }
  const verdict = checkDuplicate({ companyName: c.company_name, websiteUrl: c.website_url, email: c.email, city: c.city }, { prospects: live.data ?? [], ignored: { domains: new Set(), emails: new Set() }, seen: [], excludeResearched: false });
  if (verdict.kind === "duplicate") {
    await db.from("prospect_discovery_candidates").update({ status: "rejected_duplicate", duplicate_of: verdict.prospectId, duplicate_reason: verdict.reason.slice(0, 200) }).eq("id", id);
    return { ok: false, error: verdict.reason, duplicateOf: verdict.prospectId };
  }

  const checked = validateProspectForm({
    ...emptyProspectForm,
    companyName: c.company_name,
    websiteUrl: c.website_url ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    city: c.city ?? "",
    sector: c.industry ?? "",
    status: "researching",
    priority: "normal",
    source: c.synthetic ? `${SOURCE_LABEL} (sample data)` : SOURCE_LABEL,
  });
  if (!checked.ok) {
    await revert();
    return { ok: false, error: `Some details cannot be copied as they are (${Object.values(checked.errors)[0]}). Add the prospect by hand instead.` };
  }
  const inserted = await db.from("prospects").insert(toProspectRow(checked.data)).select("id").single();
  if (inserted.error || !inserted.data) {
    await revert();
    return { ok: false, error: generic };
  }

  const reason = c.reasons[0] ?? c.opportunity ?? "";
  const activity = await db.from("prospect_activities").insert({
    prospect_id: inserted.data.id,
    type: "other",
    title: "Prospect discovered",
    description: `Added from AI Prospect Finder. Score: ${c.score}/100${reason ? `\nReason: ${reason}` : ""}`.slice(0, 1000),
    occurred_on: brusselsToday(),
    metadata: { origin: "prospect_finder", candidate_id: c.id, run_id: c.run_id, score: c.score } as never,
  });
  if (activity.error) {
    await db.from("prospects").delete().eq("id", inserted.data.id);
    await revert();
    return { ok: false, error: generic };
  }
  await db.from("prospect_discovery_candidates").update({ added_prospect_id: inserted.data.id }).eq("id", id);
  return { ok: true, prospectId: inserted.data.id, company: checked.data.companyName };
}

export const IGNORE_NOTE = "Ignored by an admin after review; not suggested again.";

/** "Ignore": auditable (status, when, who, why) and permanent for that domain and email until someone restores it. Nothing is deleted. */
export async function ignoreDiscoveryCandidate(db: Db, userId: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const { data, error } = await db.from("prospect_discovery_candidates").update({ status: "ignored", ignored_at: now, reviewed_at: now, decided_by: userId, decision_note: IGNORE_NOTE }).eq("id", id).eq("status", "pending").select("id").maybeSingle();
  if (error) return { ok: false, error: generic };
  if (data) return { ok: true };
  const current = await db.from("prospect_discovery_candidates").select("status").eq("id", id).maybeSingle();
  if (current.data?.status === "ignored") return { ok: true };
  return { ok: false, error: current.data ? "This candidate was already decided." : "Candidate not found." };
}

/** The research behind a prospect that was added from a candidate. Never rewritten by later runs: the candidate row is historical. */
export async function getInsightForProspect(db: Db, prospectId: string): Promise<CandidateView | null> {
  const { data } = await db.from("prospect_discovery_candidates").select(CANDIDATE_COLUMNS).eq("added_prospect_id", prospectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? toView(data as unknown as CandidateDbRow) : null;
}
