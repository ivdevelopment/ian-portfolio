import { mkdirSync, rmSync } from "node:fs";
import { businessKey, type DedupeContext } from "../../../src/lib/prospecting/dedupe";
import { runPipeline, type CandidateInsert, type PipelineStore, type RunCounters, type SeenOutcome } from "../../../src/lib/prospecting/pipeline";
import type { BusinessSource } from "../../../src/lib/prospecting/providers/types";
import { SourceError } from "./osm-source";
import { BusinessDataMissingError } from "./osm/local-osm-source";
import { SEARCH_MODES, type DiscoveryRequest, type SearchMode } from "../../../src/lib/prospecting/types";
import { AgentApiError, type AgentApi, type RunParams } from "./api-client";
import { KIND_MESSAGES, type FailureKind, type ProcRunner } from "./codex";
import { CodexProvider } from "./codex-provider";
import { effortFor, type AgentConfig } from "./config";
import type { Logger } from "./logger";
import { runDir } from "./paths";

/**
 * One claimed run, start to finish. The pipeline is the P10 pipeline (discovery, duplicate/cooldown/ignored checks, deterministic website
 * analysis, qualification, scoring); the only AI step is Codex. Results are collected in memory and sent in ONE call at the end, so a crash
 * leaves nothing half-written: the lease expires and the run goes back to the queue.
 */
export type JobDeps = {
  api: AgentApi;
  config: AgentConfig;
  log: Logger;
  source: BusinessSource;
  flags: ReadonlySet<string>;
  runner?: ProcRunner;
  home?: string;
  /** Tests: shrink the keep-alive and budgets. */
  keepAliveMs?: number;
  budgets?: { quickMs: number; deepMs: number; callQuickMs: number; callDeepMs: number };
  /** True once the worker was told to stop (Ctrl+C): the job stops between steps and reports what it has. */
  stopping?: () => boolean;
  /** Aborted when a person chooses "stop anyway": the running Codex process is ended and the run is reported as cancelled with what it has. */
  signal?: AbortSignal;
  /** Real progress for a UI (the same stage and counters that are sent to the CRM). Never carries business details. */
  onProgress?: (progress: { status?: "discovering" | "analyzing" | "qualifying"; stage: string; counters: Partial<RunCounters> }) => void;
  analyzeDeps?: Parameters<typeof runPipeline>[1]["analyzeDeps"];
};

export const DEFAULT_BUDGETS = { quickMs: 10 * 60_000, deepMs: 30 * 60_000, callQuickMs: 6 * 60_000, callDeepMs: 10 * 60_000 } as const;

const STAGE_STATUS: Array<[RegExp, "discovering" | "analyzing" | "qualifying"]> = [[/^Finding/i, "discovering"], [/^(Checking|Analy)/i, "analyzing"], [/^Qualifying/i, "qualifying"]];

export type JobSummary = { status: "completed" | "partial" | "failed" | "cancelled" | "abandoned"; candidates: number; codexCalls: number; codexMs: number; kind: FailureKind | null };

export async function runJob(run: RunParams, deps: JobDeps): Promise<JobSummary> {
  const { api, log, config } = deps;
  const started = Date.now();
  const mode = (SEARCH_MODES as readonly string[]).includes(run.mode) ? (run.mode as SearchMode) : "redesign";
  const request: DiscoveryRequest = { mode, location: run.location, area: run.area, industry: run.industry, threshold: run.threshold, count: run.count, excludeResearched: run.excludeResearched };
  const dir = runDir(run.id, deps.home);
  mkdirSync(dir, { recursive: true });
  const budgets = deps.budgets ?? DEFAULT_BUDGETS;
  const deadline = started + (mode === "quick" ? budgets.quickMs : budgets.deepMs);

  // Progress is remembered and sent both when it changes and on a timer, so the lease never runs out during a long Codex call.
  const latest: { status?: "discovering" | "analyzing" | "qualifying"; stage: string; counters: Partial<RunCounters>; errors: string[] } = { stage: "Picked up", counters: {}, errors: [] };
  let cancelRequested = false;
  let leaseLost = false;
  const send = async () => {
    try {
      const r = await api.progress({ runId: run.id, ...latest });
      if (r.cancel) cancelRequested = true;
    } catch (e) {
      if (e instanceof AgentApiError && (e.kind === "lease_lost" || e.kind === "unauthorized")) leaseLost = true;
    }
  };
  const keepAlive = setInterval(() => void send(), deps.keepAliveMs ?? 25_000);

  // A failing discovery source is its own failure kind: it must never be reported as a Codex problem.
  let sourceFailed = false;
  let dataMissing = false;
  const source: BusinessSource = {
    id: deps.source.id,
    discover: async (r) => {
      try {
        const t0 = Date.now();
        const found = await deps.source.discover(r);
        log.info("discovery finished", { run: run.id, source: deps.source.id, businesses: found.length, ms: Date.now() - t0 });
        return found;
      } catch (e) {
        sourceFailed = true;
        dataMissing = e instanceof BusinessDataMissingError;
        log.warn("business source failed", { run: run.id, error: e instanceof SourceError ? e.message : "error" });
        throw e;
      }
    },
  };

  const candidates: Array<Record<string, unknown>> = [];
  const duplicates: Array<Record<string, unknown>> = [];
  const seen: Array<{ domain: string; outcome: SeenOutcome; score: number | null }> = [];

  const provider = new CodexProvider({
    bin: config.codexBin,
    model: config.model,
    effort: effortFor(config, mode),
    timeoutMs: mode === "quick" ? budgets.callQuickMs : budgets.callDeepMs,
    dir,
    signal: deps.signal,
    flags: deps.flags,
    run: deps.runner,
    onLog: (m, f) => log.info(m, { run: run.id, ...f }),
  });

  try {
    const remote = await api.context(run.id);
    const context: Omit<DedupeContext, "excludeResearched" | "now"> = {
      prospects: remote.prospects.map((p) => ({ id: p.id, company_name: p.company_name, email: null, website_url: p.website_url, city: p.city })),
      emailHashes: new Map(remote.prospects.filter((p) => p.email_hash).map((p) => [p.email_hash as string, { id: p.id, company_name: p.company_name }])),
      ignored: { domains: new Set(remote.decided.filter((d) => d.status === "ignored").map((d) => businessKey({ companyName: d.company_name, websiteUrl: d.website_url, city: d.city })).filter(Boolean)), emails: new Set() },
      ignoredEmailHashes: new Set(remote.decided.filter((d) => d.status === "ignored" && d.email_hash).map((d) => d.email_hash as string)),
      pending: new Set(remote.decided.filter((d) => d.status === "pending").map((d) => businessKey({ companyName: d.company_name, websiteUrl: d.website_url, city: d.city })).filter(Boolean)),
      seen: remote.seen,
    };

    const store: PipelineStore = {
      context: async () => context,
      async progress(patch) {
        const { stage, errors, ...counters } = patch;
        if (stage) {
          latest.stage = stage;
          latest.status = STAGE_STATUS.find(([re]) => re.test(stage))?.[1] ?? latest.status;
        }
        Object.assign(latest.counters, counters);
        if (errors) latest.errors = errors;
        log.info("progress", { run: run.id, stage: latest.stage, ...latest.counters });
        try {
          deps.onProgress?.({ status: latest.status, stage: latest.stage, counters: { ...latest.counters } });
        } catch {
          /* a UI callback must never break a run */
        }
        await send();
      },
      async saveCandidates(rows: CandidateInsert[]) {
        for (const r of rows) {
          if (r.kind === "candidate") {
            const c = r.candidate;
            const b = c.business;
            candidates.push({ company_name: b.companyName, website_url: b.websiteUrl, email: b.email, phone: b.phone, city: b.city, region: b.region, industry: b.industry, score: c.score, score_breakdown: c.breakdown, summary: c.summary, opportunity: c.opportunity, evidence: c.evidence, source_urls: b.sourceUrls });
          } else duplicates.push({ company_name: r.business.companyName, website_url: r.business.websiteUrl, email: r.business.email, city: r.business.city, duplicate_of: r.duplicateOf, duplicate_reason: r.reason });
        }
      },
      async markSeen(entries) {
        seen.push(...entries);
      },
    };

    const outcome = await runPipeline(request, {
      provider,
      source,
      store,
      analyzeDeps: deps.analyzeDeps,
      shouldCancel: () => (leaseLost || cancelRequested || deps.stopping?.() || deps.signal?.aborted ? "cancelled" : Date.now() > deadline ? "deadline" : null),
    });

    clearInterval(keepAlive);
    if (leaseLost) {
      log.warn("lease lost, results not submitted", { run: run.id });
      return { status: "abandoned", candidates: 0, codexCalls: provider.stats.calls, codexMs: provider.stats.ms, kind: null };
    }
    const kind = sourceFailed ? (dataMissing ? ("business_data_missing" as FailureKind) : ("source_error" as FailureKind)) : provider.stats.lastFailure;
    const nothing = candidates.length === 0;
    // Codex never produced a usable answer and nothing was kept: that is a failure with a reason, not an empty "completed" run.
    const codexNeverWorked = provider.stats.calls > 0 && provider.stats.okCalls === 0 && kind !== null;
    if (nothing && outcome.status !== "cancelled" && (outcome.status === "failed" || codexNeverWorked || sourceFailed)) {
      const k: FailureKind = kind ?? "agent_error";
      // A CRM that predates `business_data_missing` rejects the new kind; the run is then failed as a generic source error with the clear message.
      await api.fail({ runId: run.id, kind: k, message: KIND_MESSAGES[k] }).catch((e: unknown) => {
        if (k === "business_data_missing" && e instanceof AgentApiError && e.kind === "rejected") return api.fail({ runId: run.id, kind: "source_error", message: KIND_MESSAGES[k] });
        throw e;
      });
      log.error("run failed", { run: run.id, kind: k, ms: Date.now() - started });
      return { status: "failed", candidates: 0, codexCalls: provider.stats.calls, codexMs: provider.stats.ms, kind: k };
    }
    const status = outcome.status === "failed" ? "partial" : outcome.status;
    const res = await api.result({
      runId: run.id,
      candidates,
      duplicates,
      seen: seen.map((s) => ({ domain: s.domain, outcome: s.outcome, score: s.score })),
      final: { status, stage: outcome.stage, counters: outcome.counters, errors: [...outcome.errors, ...provider.stats.notes].slice(0, 25), codexMs: provider.stats.ms, codexCalls: provider.stats.calls, failureKind: outcome.status === "completed" ? null : kind },
    });
    log.info("run submitted", { run: run.id, status, candidates: res.inserted, skippedKnown: res.skipped_known, rejected: res.rejected, codexCalls: provider.stats.calls, codexMs: provider.stats.ms, ms: Date.now() - started });
    return { status, candidates: res.inserted, codexCalls: provider.stats.calls, codexMs: provider.stats.ms, kind };
  } catch (error) {
    clearInterval(keepAlive);
    if (error instanceof AgentApiError && (error.kind === "lease_lost" || error.kind === "unauthorized")) {
      log.warn("run abandoned", { run: run.id, reason: error.kind });
      return { status: "abandoned", candidates: 0, codexCalls: provider.stats.calls, codexMs: provider.stats.ms, kind: null };
    }
    log.error("run crashed", { run: run.id, error: error instanceof Error ? error.constructor.name : "error" });
    const kind: FailureKind = error instanceof AgentApiError && error.kind === "network" ? "network_error" : "agent_error";
    await api.fail({ runId: run.id, kind, message: KIND_MESSAGES[kind] }).catch(() => undefined);
    return { status: "failed", candidates: 0, codexCalls: provider.stats.calls, codexMs: provider.stats.ms, kind };
  } finally {
    clearInterval(keepAlive);
    // The scratch folder holds only this run's prompt, schema and answers. It is removed as soon as the run is over.
    rmSync(dir, { recursive: true, force: true });
  }
}
