import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { AgentApi, AgentApiError, backoffMs } from "./api-client";
import { diagnose, supportedFlags, type Diagnostics, type ProcRunner } from "./codex";
import type { AgentConfig } from "./config";
import { runJob, type JobDeps } from "./job";
import type { Logger } from "./logger";
import { runsDir } from "./paths";
import { CompositeBusinessSource } from "./discovery-source";
import { heartbeatSummary } from "./osm/data-manager";

/**
 * The worker loop: verify Codex, send heartbeats, poll for a queued run, run it, repeat. One job at a time (one Codex process). It only makes
 * outbound HTTPS requests; there is no listening socket. Polling is conservative (every few seconds while idle) with exponential backoff on errors.
 */
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
};

export type WorkerHandle = { stop(): void; done: Promise<"stopped" | "unauthorized"> };

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

  const refreshDiagnostics = async (force = false) => {
    if (!force && Date.now() - lastDiagnosed < (deps.diagnoseEveryMs ?? 5 * 60_000)) return;
    lastDiagnosed = Date.now();
    diag = await diagnose(config.codexBin, deps.runner);
    if (diag.state === "ready" || diag.state === "not_authenticated") flags = await supportedFlags(config.codexBin, deps.runner);
    log.info("codex", { state: diag.state, version: diag.version ?? "unknown", note: diag.note ?? "" });
  };

  const heartbeat = async () => {
    try {
      await api.heartbeat({ codexVersion: diag.version, codexState: diag.state, failureKind: lastFailure, businessData: heartbeatSummary(deps.home) });
    } catch (e) {
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
        try {
          const run = await api.claim();
          failures = 0;
          if (!run) {
            await sleep(config.pollSeconds * 1000);
            continue;
          }
          log.info("claimed run", { run: run.id, mode: run.mode, attempt: run.attempt });
          const summary = await runJob(run, { api, config, log, source: deps.source ?? new CompositeBusinessSource({ home: deps.home, allowOverpass: config.overpassFallback, local: { priorities: config.discoveryPriorities }, log: (m, f) => log.info(m, f) }), flags, runner: deps.runner, home: deps.home, stopping: () => stopping, ...deps.jobOverrides });
          lastFailure = summary.kind;
          pruneRuns(deps.home);
          await heartbeat();
        } catch (e) {
          if (e instanceof AgentApiError && e.kind === "unauthorized") {
            fatal = true;
            log.error("the connection token was rejected: this device was revoked or the token is wrong.");
            break;
          }
          failures++;
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

  return { stop: () => ((stopping = true), wake.abort()), done };
}
