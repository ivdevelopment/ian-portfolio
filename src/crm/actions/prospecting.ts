"use server";

import { after } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAgentToken, DEFAULT_DEVICE_NAME, getAgentStatus, revokeAgent } from "@/lib/prospecting/agent/service";
import { getBusinessSource, getProvider, getProviderStatus, providerFlag } from "@/lib/prospecting/config";
import { runPipeline } from "@/lib/prospecting/pipeline";
import { addDiscoveryCandidate, cancelRun, createRun, dbPipelineStore, finishRun, getRun, ignoreDiscoveryCandidate, listCandidates, type AddResult, type CandidateView, type RunRow } from "@/lib/prospecting/service";
import { parseDiscoveryRequest } from "@/lib/prospecting/request";
import { idSchema } from "@/lib/schemas/prospect";

export type StartResult = { ok: true; runId: string } | { ok: false; error: string };

/**
 * Starts a search. The provider flag decides whether anything can run at all: when no provider is available this refuses, and no
 * research, no request to any AI service and no database row is made. The research itself runs after the response (so the page can show
 * real progress while it works) and only ever writes candidates for review.
 */
export async function startDiscoveryAction(input: unknown): Promise<StartResult> {
  const { supabase, userId } = await requireAdmin();
  const agent = providerFlag() === "local_codex" ? await getAgentStatus(supabase) : null;
  const status = getProviderStatus(process.env, agent);
  if (!status.ready) return { ok: false, error: status.message };

  const checked = parseDiscoveryRequest(input);
  if (!checked.ok) return checked;
  const request = checked.request;

  // local_codex: this server only QUEUES the search. The agent on Ian's PC picks it up and does the research and the AI step; nothing runs here.
  if (status.queued) {
    const queued = await createRun(supabase, userId, request, "local_codex", { queued: true });
    return queued.ok ? { ok: true, runId: queued.id } : queued;
  }

  const provider = getProvider();
  if (!provider) return { ok: false, error: status.message };
  const run = await createRun(supabase, userId, request, provider.id);
  if (!run.ok) return run;

  after(async () => {
    try {
      const outcome = await runPipeline(request, { provider, source: getBusinessSource(), store: dbPipelineStore(supabase, run.id) });
      await finishRun(supabase, run.id, outcome.status, outcome.stage, outcome.counters, outcome.errors);
    } catch {
      await finishRun(supabase, run.id, "failed", "Run stopped", { raw_found: 0, analyzed: 0, qualified: 0, duplicates_removed: 0, skipped_cooldown: 0 }, ["The run stopped unexpectedly."]).catch(() => undefined);
    }
  });
  return { ok: true, runId: run.id };
}

export type RunStatus = { run: RunRow; candidates: CandidateView[] } | null;

/** What the page polls while a run is going: the run's progress and the candidates found so far. */
export async function getRunStatusAction(runId: unknown): Promise<RunStatus> {
  const { supabase } = await requireAdmin();
  const id = idSchema.safeParse(runId);
  if (!id.success) return null;
  const run = await getRun(supabase, id.data);
  if (!run) return null;
  return { run, candidates: await listCandidates(supabase, { status: "pending", runId: run.id }, 50) };
}

/** "Cancel run": a queued search is cancelled at once; one in progress stops between steps and keeps the candidates already found. */
export async function cancelDiscoveryRunAction(runId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await requireAdmin();
  const id = idSchema.safeParse(runId);
  if (!id.success) return { ok: false, error: "Search not found." };
  return cancelRun(supabase, id.data);
}

export type TokenResult = { ok: true; token: string; name: string } | { ok: false; error: string };

/** Registers this PC and returns its connection token ONCE (it is stored only as a hash). Creating a new one revokes the old device. */
export async function createAgentTokenAction(deviceName: unknown): Promise<TokenResult> {
  const { supabase, userId } = await requireAdmin();
  return createAgentToken(supabase, userId, typeof deviceName === "string" ? deviceName : DEFAULT_DEVICE_NAME);
}

/** Revokes the device: its token stops working immediately. */
export async function revokeAgentAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await requireAdmin();
  return revokeAgent(supabase);
}

export async function addDiscoveryCandidateAction(id: unknown): Promise<AddResult> {
  const { supabase, userId } = await requireAdmin();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Candidate not found." };
  return addDiscoveryCandidate(supabase, userId, parsed.data);
}

export async function ignoreDiscoveryCandidateAction(id: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, userId } = await requireAdmin();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Candidate not found." };
  return ignoreDiscoveryCandidate(supabase, userId, parsed.data);
}
