import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { AgentApi, AgentApiError, backoffMs, type Counters, type RunParams } from "./api-client";
import { diagnose, supportedFlags, type Diagnostics, type ProcRunner } from "./codex";
import type { AgentConfig } from "./config";
import { runJob, type JobDeps, type JobSummary } from "./job";
import { runMailJob, type MailJobSummary } from "./mail-job";
import type { Logger } from "./logger";
import { runsDir } from "./paths";
import { CompositeBusinessSource } from "./discovery-source";
import { heartbeatSummary } from "./osm/data-manager";

/**
 * The worker loop: verify Codex, send heartbeats, poll for a queued run, run it, repeat. One job at a time (one Codex process). It only makes
 * outbound HTTPS requests; there is no listening socket. Polling is conservative (every few seconds while idle) with exponential backoff on errors.
 */
/**
 * What a user interface can observe about the loop, as plain callbacks. Nothing here carries a token, a business name or a candidate: only
 * states, counters and fixed failure kinds. A callback that throws is ignored, so a UI can never break the worker.
 */
export type ApiFailureKind = "unauthorized" | "network" | "rate_limited" | "rejected" | "server" | "lease_lost" | "error";
export type HeartbeatOutcome = { ok: true; device: string } | { ok: false; kind: ApiFailureKind };
export type WorkerHooks = {
  onDiagnostics?(d: Diagnostics): void;
  onHeartbeat?(outcome: HeartbeatOutcome): void;
  /** Whether the CRM could be reached when asking for work (the same connection the heartbeat uses). */
  onClaim?(outcome: { ok: true } | { ok: false; kind: ApiFailureKind }): void;
  onRunStart?(run: RunParams): void;
  onRunProgress?(run: RunParams, progress: { status?: "discovering" | "analyzing" | "qualifying"; stage: string; counters: Partial<Counters> }): void;
  onRunEnd?(run: RunParams, summary: JobSummary): void;
  /** A Mail Assistant draft request was picked up / finished (it writes one email draft; nothing is sent). */
  onMailStart?(jobId: string): void;
  onMailEnd?(jobId: string, summary: MailJobSummary): void;
  /** Claiming is paused (Codex usage limit) until the given time, or resumed (null). */
  onPause?(until: number | null): void;
};

export type WorkerDeps = {
  api: AgentApi;
  config: AgentConfig;
  log: Logger;
  runner?: ProcRunner;
  sleep?: (ms: number) => Promise<void>;
  heartbeatMs?: number;
  diagnoseEveryMs?: number;
  home?: string;
  source?: JobDeps["source"];
  jobOverrides?: Partial<JobDeps>;
  hooks?: WorkerHooks;
  /** After Codex reports its usage limit, no new run is claimed for this long (default 30 minutes), so a run is not accepted only to fail again. */
  usageLimitPauseMs?: number;
};

export type WorkerHandle = {
  /** Graceful: the loop ends after the current step; a run in progress is finished or stopped between steps and reported. */
  stop(): void;
  /** Stop anyway: also ends the running Codex process at once. The run is reported to the CRM as cancelled with what it already has. */
  abortRun(): void;
  /** Claim work again after a usage-limit pause. */
  resume(): void;
  done: Promise<"stopped" | "unauthorized">;
};

const classifyApiError = (e: unknown): ApiFailureKind => (e instanceof AgentApiError ? e.kind : "error");

/** Old scratch folders (a crashed run) are removed on start and after each job. */
export function pruneRuns(home?: string, maxAgeMs = 24 * 3600_000, now = Date.now()): number {
  let removed = 0;
  const dir = runsDir(home);
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (now - statSync(p).mtimeMs > maxAgeMs) {
        rmSync(p, { recursive: true, force: true });
        removed++;
      }
    }
  } catch {
    /* no runs folder yet */
  }
  return removed;
}

export function startWorker(deps: WorkerDeps): WorkerHandle {
  const { api, config, log } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let stopping = false;
  let diag: Diagnostics = { state: "error", version: null, missingFlags: [], note: "not checked" };
  let flags = new Set<string>();
  let lastDiagnosed = 0;
  let lastFailure: string | null = null;
  let fatal = false;
  const wake = new AbortController();
  const runAbort = new AbortController();
  let pausedUntil = 0;
  const hook = <K extends keyof WorkerHooks>(name: K, ...args: Parameters<NonNullable<WorkerHooks[K]>>) => {
    try {
      (deps.hooks?.[name] as ((...a: unknown[]) => void) | undefined)?.(...args);
    } catch {
      /* a UI callback must never break the worker */
    }
  };

  const refreshDiagnostics = async (force = false) => {
    if (!force && Date.now() - lastDiagnosed < (deps.diagnoseEveryMs ?? 5 * 60_000)) return;
    lastDiagnosed = Date.now();
    diag = await diagnose(config.codexBin, deps.runner);
    if (diag.state === "ready" || diag.state === "not_authenticated") flags = await supportedFlags(config.codexBin, deps.runner);
    log.info("codex", { state: diag.state, version: diag.version ?? "unknown", note: diag.note ?? "" });
    hook("onDiagnostics", diag);
  };

  const heartbeat = async () => {
    try {
      const hello = await api.heartbeat({ codexVersion: diag.version, codexState: diag.state, failureKind: lastFailure, businessData: heartbeatSummary(deps.home) });
      hook("onHeartbeat", { ok: true, device: hello.device });
    } catch (e) {
      hook("onHeartbeat", { ok: false, kind: classifyApiError(e) });
      if (e instanceof AgentApiError && e.kind === "unauthorized") {
        fatal = true;
        log.error("the connection token was rejected: this device was revoked or the token is wrong. Run `prospect-agent setup` with a new token.");
        wake.abort();
      } else log.warn("heartbeat failed", { error: e instanceof AgentApiError ? e.kind : "error" });
    }
  };

  const done = (async (): Promise<"stopped" | "unauthorized"> => {
    pruneRuns(deps.home);
    await refreshDiagnostics(true);
    await heartbeat();
    const timer = setInterval(() => void heartbeat(), deps.heartbeatMs ?? 20_000);
    let failures = 0;
    try {
      while (!stopping && !fatal) {
        await refreshDiagnostics();
        if (diag.state !== "ready") {
          // Not claiming while Codex cannot work keeps the run queued and the CRM shows the reason.
          await sleep(Math.max(15_000, config.pollSeconds * 1000));
          await refreshDiagnostics(true);
          continue;
        }
        if (Date.now() < pausedUntil) {
          // Codex said its allowance is used up: stay online (heartbeats continue) but do not accept a run that cannot be executed.
          await sleep(Math.max(15_000, config.pollSeconds * 1000));
          continue;
        }
        if (pausedUntil) {
          pausedUntil = 0;
          hook("onPause", null);
        }
        try {
          const run = await api.claim();
          failures = 0;
          hook("onClaim", { ok: true });
          if (!run) {
            // No search to do: a Mail Assistant draft request may be waiting (same device, same Codex, one job at a time).
            const mail = await api.mailClaim();
            if (mail) {
              log.info("claimed mail draft", { job: mail.id, attempt: mail.attempt });
              hook("onMailStart", mail.id);
              const mailSummary = await runMailJob(mail, { api, config, log, flags, runner: deps.runner, home: deps.home, signal: runAbort.signal });
              lastFailure = mailSummary.kind === "not_allowed" ? lastFailure : mailSummary.kind;
              hook("onMailEnd", mail.id, mailSummary);
              if (mailSummary.kind === "codex_usage_limit") {
                pausedUntil = Date.now() + (deps.usageLimitPauseMs ?? 30 * 60_000);
                hook("onPause", pausedUntil);
              }
              pruneRuns(deps.home);
              await heartbeat();
              continue;
            }
            await sleep(config.pollSeconds * 1000);
            continue;
          }
          log.info("claimed run", { run: run.id, mode: run.mode, attempt: run.attempt });
          hook("onRunStart", run);
          const summary = await runJob(run, { api, config, log, signal: runAbort.signal, onProgress: (p) => hook("onRunProgress", run, p), source: deps.source ?? new CompositeBusinessSource({ home: deps.home, allowOverpass: config.overpassFallback, local: { priorities: config.discoveryPriorities }, log: (m, f) => log.info(m, f) }), flags, runner: deps.runner, home: deps.home, stopping: () => stopping, ...deps.jobOverrides });
          lastFailure = summary.kind;
          hook("onRunEnd", run, summary);
          if (summary.kind === "codex_usage_limit") {
            pausedUntil = Date.now() + (deps.usageLimitPauseMs ?? 30 * 60_000);
            hook("onPause", pausedUntil);
          }
          pruneRuns(deps.home);
          await heartbeat();
        } catch (e) {
          if (e instanceof AgentApiError && e.kind === "unauthorized") {
            fatal = true;
            log.error("the connection token was rejected: this device was revoked or the token is wrong.");
            break;
          }
          failures++;
          hook("onClaim", { ok: false, kind: classifyApiError(e) });
          const wait = backoffMs(failures);
          log.warn("could not reach the CRM, backing off", { failures, waitMs: wait });
          await sleep(wait);
        }
      }
    } finally {
      clearInterval(timer);
    }
    return fatal ? "unauthorized" : "stopped";
  })();

  return {
    stop: () => ((stopping = true), wake.abort()),
    abortRun: () => runAbort.abort(),
    resume: () => {
      pausedUntil = 0;
    },
    done,
  };
}
