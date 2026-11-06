import { createHash } from "node:crypto";
import { z } from "zod";
import { FAILURE_KINDS } from "./messages";
import { brusselsDayOf } from "@/lib/mail-assistant/timing";
import { ACTION_TYPES, STEPS } from "@/lib/mail-assistant/types";
import { checkMailResult } from "@/lib/mail-assistant/validate";
import { checkCandidate, resultSchema } from "./validate";

/**
 * The agent API, transport-independent: `handleAgentOp` takes the already-extracted bearer token, the raw body and a function that calls the
 * database. It never touches cookies or a session: an agent request is authorised ONLY by its connection token, checked inside the database
 * functions on every call (so a revoked token stops working at once), and it can do nothing but the six operations below.
 */
export const AGENT_OPS = ["heartbeat", "claim", "context", "progress", "result", "fail", "mail_claim", "mail_progress", "mail_result", "mail_fail"] as const;
export type AgentOp = (typeof AGENT_OPS)[number];
export const MAX_BODY_BYTES = 1_500_000;
export const LEASE_SECONDS = 90;

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export type AgentResponse = { status: number; body: Record<string, unknown> };

const text = (max: number) => z.string().trim().max(max);
const runId = z.uuid();

const schemas = {
  heartbeat: z.object({
    codexVersion: text(60).nullish(),
    codexState: z.enum(["ready", "not_installed", "not_authenticated", "error"]),
    failureKind: text(40).nullish(),
    /** The state of the agent's local business data (P10.2). Optional: an older agent sends none. */
    businessData: z
      .object({
        state: z.enum(["ready", "missing"]),
        source: text(60).nullish(),
        dataDate: text(40).nullish(),
        businesses: z.number().int().min(0).max(100_000_000).nullish(),
        freshness: z.enum(["fresh", "aging", "stale", "unknown"]).default("unknown"),
      })
      .optional(),
  }),
  claim: z.object({}).passthrough(),
  context: z.object({ runId }),
  progress: z.object({
    runId,
    status: z.enum(["discovering", "analyzing", "qualifying"]).optional(),
    stage: text(80).min(1),
    counters: z.object({ raw_found: z.number().int().min(0), analyzed: z.number().int().min(0), qualified: z.number().int().min(0), duplicates_removed: z.number().int().min(0), skipped_cooldown: z.number().int().min(0) }).partial(),
    errors: z.array(text(200)).max(25).default([]),
  }),
  fail: z.object({ runId, kind: z.enum([...FAILURE_KINDS, "cancelled"]), message: text(200).default(""), status: z.enum(["failed", "partial", "cancelled"]).default("failed") }),
  /** Mail Assistant (P10.5): the same device and token, a separate small queue of draft requests. */
  mailClaim: z.object({}).passthrough(),
  mailProgress: z.object({ jobId: z.uuid() }),
  mailResult: z.object({ jobId: z.uuid(), result: z.unknown(), codexMs: z.number().int().min(0).max(86_400_000).default(0) }),
  mailFail: z.object({ jobId: z.uuid(), kind: z.enum([...FAILURE_KINDS, "not_allowed", "cancelled"]) }),
} as const;

/** The plan as stored with a request. Parsed loosely: the database wrote it, but it is still not trusted blindly. */
const storedPlan = z.object({
  action: z.enum(ACTION_TYPES),
  then: z.enum(ACTION_TYPES).nullable(),
  step: z.enum(STEPS),
  is_final: z.boolean(),
  recommended_on: z.string().nullable(),
  reason: z.string(),
  needs_ai: z.boolean(),
  blocked: z.enum(["more_context_needed"]).nullable(),
  language: z.enum(["nl", "en"]),
  warnings: z.array(z.string()),
});

const ERRORS: Record<string, number> = { unauthorized: 401, lease_lost: 409 };

function reply(data: unknown): AgentResponse {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok === false) {
    const error = typeof d.error === "string" ? d.error : "failed";
    return { status: ERRORS[error] ?? 400, body: { ok: false, error } };
  }
  return { status: 200, body: d };
}

export async function handleAgentOp(op: AgentOp, token: string, rawBody: string, rpc: Rpc): Promise<AgentResponse> {
  if (rawBody.length > MAX_BODY_BYTES) return { status: 413, body: { ok: false, error: "too_large" } };
  let json: unknown = {};
  if (rawBody.trim() !== "") {
    try {
      json = JSON.parse(rawBody);
    } catch {
      return { status: 400, body: { ok: false, error: "invalid_json" } };
    }
  }
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await rpc(fn, args);
    return error ? ({ ok: false, error: "unavailable" } as const) : data;
  };
  const invalid = (): AgentResponse => ({ status: 400, body: { ok: false, error: "invalid_request" } });

  switch (op) {
    case "heartbeat": {
      const p = schemas.heartbeat.safeParse(json);
      if (!p.success) return invalid();
      const bd = p.data.businessData;
      return reply(
        await call("agent_heartbeat", {
          p_token: token,
          p_codex_version: p.data.codexVersion ?? null,
          p_codex_state: p.data.codexState,
          p_failure: p.data.failureKind ?? null,
          ...(bd ? { p_business_data: { state: bd.state, source: bd.source ?? null, data_date: bd.dataDate ?? null, businesses: bd.businesses ?? null, freshness: bd.freshness } } : {}),
        }),
      );
    }
    case "claim": {
      if (!schemas.claim.safeParse(json).success) return invalid();
      return reply(await call("agent_claim_run", { p_token: token, p_lease_seconds: LEASE_SECONDS }));
    }
    case "context": {
      const p = schemas.context.safeParse(json);
      if (!p.success) return invalid();
      return reply(await call("agent_context", { p_token: token, p_run: p.data.runId }));
    }
    case "progress": {
      const p = schemas.progress.safeParse(json);
      if (!p.success) return invalid();
      return reply(await call("agent_progress", { p_token: token, p_run: p.data.runId, p_status: p.data.status ?? null, p_stage: p.data.stage, p_counters: p.data.counters, p_errors: p.data.errors, p_lease_seconds: LEASE_SECONDS }));
    }
    case "fail": {
      const p = schemas.fail.safeParse(json);
      if (!p.success) return invalid();
      return reply(await call("agent_fail", { p_token: token, p_run: p.data.runId, p_kind: p.data.kind, p_message: p.data.message, p_status: p.data.status }));
    }
    case "mail_claim": {
      if (!schemas.mailClaim.safeParse(json).success) return invalid();
      return reply(await call("agent_mail_claim", { p_token: token, p_lease_seconds: LEASE_SECONDS }));
    }
    case "mail_progress": {
      const p = schemas.mailProgress.safeParse(json);
      if (!p.success) return invalid();
      return reply(await call("agent_mail_progress", { p_token: token, p_job: p.data.jobId, p_lease_seconds: LEASE_SECONDS }));
    }
    case "mail_fail": {
      const p = schemas.mailFail.safeParse(json);
      if (!p.success) return invalid();
      return reply(await call("agent_mail_fail", { p_token: token, p_job: p.data.jobId, p_kind: p.data.kind }));
    }
    case "mail_result": {
      const p = schemas.mailResult.safeParse(json);
      if (!p.success) return invalid();
      // The plan the request was made for decides what is acceptable: the agent's own idea of it is not consulted.
      const params = (await call("agent_mail_params", { p_token: token, p_job: p.data.jobId })) as { ok?: boolean; error?: string; plan?: unknown };
      if (params?.ok !== true) return reply(params);
      const plan = storedPlan.safeParse(params.plan);
      if (!plan.success) return invalid();
      const verdict = checkMailResult(p.data.result, plan.data, brusselsDayOf(new Date()));
      if (!verdict.ok) {
        // An answer the guardrails reject never becomes a recommendation: the request is failed so the CRM stops waiting for it.
        await call("agent_mail_fail", { p_token: token, p_job: p.data.jobId, p_kind: verdict.kind });
        return { status: 422, body: { ok: false, error: "rejected", reason: verdict.reason } };
      }
      return reply(await call("agent_mail_submit", { p_token: token, p_job: p.data.jobId, p_result: verdict.recommendation, p_codex_ms: p.data.codexMs }));
    }
    case "result": {
      const p = resultSchema.safeParse(json);
      if (!p.success) return invalid();
      // The run's own parameters decide the threshold: the worker's idea of it is not consulted.
      const params = (await call("agent_run_params", { p_token: token, p_run: p.data.runId })) as { ok?: boolean; error?: string; threshold?: number };
      if (params?.ok !== true || typeof params.threshold !== "number") return reply(params);
      const accepted: Record<string, unknown>[] = [];
      const rejected: string[] = [];
      for (const candidate of p.data.candidates) {
        const verdict = checkCandidate(candidate, { threshold: params.threshold });
        if (verdict.ok) accepted.push(verdict.row);
        else rejected.push(verdict.reason);
      }
      const final = { ...p.data.final, codex_ms: p.data.final.codexMs, codex_calls: p.data.final.codexCalls, failure_kind: p.data.final.failureKind ?? null, errors: [...p.data.final.errors, ...(rejected.length ? [`${rejected.length} candidate${rejected.length === 1 ? "" : "s"} rejected by the server`] : [])].slice(0, 25) };
      const duplicates = p.data.duplicates.map((d) => ({ ...d, domain: null }));
      const res = reply(await call("agent_submit", { p_token: token, p_run: p.data.runId, p_candidates: accepted, p_duplicates: duplicates, p_seen: p.data.seen, p_final: final }));
      return res.status === 200 ? { status: 200, body: { ...res.body, rejected: rejected.length } } : res;
    }
  }
}

/** Best-effort per-token limiter (per server instance): an agent needs about 3 requests a minute, so 120 is generous and still stops a loop. */
const hits = new Map<string, number[]>();
export const RATE_LIMIT = { perMinute: 120 } as const;

export function rateLimited(token: string, now = Date.now()): boolean {
  const key = createHash("sha256").update(token).digest("hex").slice(0, 16);
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 500) for (const [k, v] of hits) if (v.every((t) => now - t >= 60_000)) hits.delete(k);
  return recent.length > RATE_LIMIT.perMinute;
}
