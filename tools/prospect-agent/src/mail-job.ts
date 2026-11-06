import { rmSync } from "node:fs";
import { join } from "node:path";
import { buildMailPrompt, MAIL_OUTPUT_SCHEMA } from "../../../src/lib/mail-assistant/prompt";
import type { MailContext } from "../../../src/lib/mail-assistant/context";
import { brusselsDayOf } from "../../../src/lib/mail-assistant/timing";
import { isDraftAction, type Plan } from "../../../src/lib/mail-assistant/types";
import { checkMailResult } from "../../../src/lib/mail-assistant/validate";
import { AgentApiError, type AgentApi, type MailJob } from "./api-client";
import { execStructured, type FailureKind, type ProcRunner } from "./codex";
import { effortFor, type AgentConfig } from "./config";
import type { Logger } from "./logger";
import { runDir } from "./paths";

/**
 * One Mail Assistant request, start to finish. The CRM already decided WHAT is appropriate (the plan) and WHAT Codex may see (the context): this
 * only writes the words. It reuses the same Codex runner as the Prospect Finder (`execStructured`), checks the answer with the same guardrails the
 * server will apply, retries once with the reason when a draft is rejected, and sends the answer back. Nothing is sent to anyone.
 */
export type MailJobDeps = {
  api: AgentApi;
  config: AgentConfig;
  log: Logger;
  flags: ReadonlySet<string>;
  runner?: ProcRunner;
  home?: string;
  signal?: AbortSignal;
  keepAliveMs?: number;
  callTimeoutMs?: number;
  now?: () => Date;
};

export type MailJobSummary = { status: "completed" | "failed" | "abandoned"; kind: FailureKind | "not_allowed" | null; codexCalls: number; codexMs: number };

export const MAIL_CALL_TIMEOUT_MS = 5 * 60_000;

export async function runMailJob(job: MailJob, deps: MailJobDeps): Promise<MailJobSummary> {
  const { api, log, config } = deps;
  const now = deps.now ?? (() => new Date());
  const dir = runDir(`mail-${job.id}`, deps.home);
  const stats = { calls: 0, ms: 0 };
  let leaseLost = false;
  let cancelled = false;
  const stop = new AbortController();
  deps.signal?.addEventListener("abort", () => stop.abort(), { once: true });
  const keepAlive = setInterval(() => {
    api.mailProgress(job.id).then(
      (r) => {
        if (r.cancel) {
          cancelled = true;
          stop.abort();
        }
      },
      (e) => {
        if (e instanceof AgentApiError && (e.kind === "lease_lost" || e.kind === "unauthorized")) leaseLost = true;
      },
    );
  }, deps.keepAliveMs ?? 25_000);

  const done = (status: MailJobSummary["status"], kind: MailJobSummary["kind"]): MailJobSummary => ({ status, kind, codexCalls: stats.calls, codexMs: stats.ms });
  const fail = async (kind: NonNullable<MailJobSummary["kind"]>): Promise<MailJobSummary> => {
    await api.mailFail({ jobId: job.id, kind }).catch(() => undefined);
    log.warn("mail draft failed", { job: job.id, kind });
    return done("failed", kind);
  };

  try {
    const plan = job.plan as Plan;
    const context = job.context as MailContext;
    // The CRM only queues a request when a draft is called for; anything else is refused here too.
    if (!plan || !context || !plan.needs_ai || !isDraftAction(plan.action)) return await fail("not_allowed");

    let correction: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (stop.signal.aborted) return cancelled ? done("abandoned", null) : await fail("agent_error");
      stats.calls++;
      const res = await execStructured({
        bin: config.codexBin,
        dir: join(dir, `call-${attempt}`),
        prompt: buildMailPrompt(context, correction),
        schema: MAIL_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        model: config.model,
        effort: effortFor(config, "quick"),
        timeoutMs: deps.callTimeoutMs ?? MAIL_CALL_TIMEOUT_MS,
        flags: deps.flags,
        run: deps.runner,
        signal: stop.signal,
      });
      stats.ms += res.ms;
      log.info("codex call", { job: job.id, call: stats.calls, ok: res.ok, ms: res.ms, ...(res.ok ? {} : { kind: res.kind }) });
      if (leaseLost) return done("abandoned", null);
      if (!res.ok) {
        if (res.aborted) return cancelled ? done("abandoned", null) : await fail("agent_error");
        // A bad answer is retried once; anything that means Codex itself cannot work ends the request with its reason.
        if ((res.kind === "invalid_output" || res.kind === "agent_error") && attempt === 1) {
          correction = "it did not follow the required JSON format.";
          continue;
        }
        return await fail(res.kind);
      }
      const verdict = checkMailResult(res.value, plan, brusselsDayOf(now()));
      if (!verdict.ok) {
        if (verdict.kind === "not_allowed") return await fail("not_allowed");
        if (attempt === 1) {
          correction = verdict.reason;
          continue;
        }
        return await fail("invalid_output");
      }
      try {
        await api.mailResult({ jobId: job.id, result: res.value, codexMs: stats.ms });
      } catch (e) {
        if (e instanceof AgentApiError && (e.kind === "lease_lost" || e.kind === "unauthorized")) return done("abandoned", null);
        // The server's own checks refused it (it has already failed the request), or the CRM could not be reached.
        log.warn("mail result not accepted", { job: job.id, kind: e instanceof AgentApiError ? e.kind : "error" });
        return done("failed", e instanceof AgentApiError && e.kind === "rejected" ? "invalid_output" : "network_error");
      }
      log.info("mail draft submitted", { job: job.id, action: plan.action, calls: stats.calls, ms: stats.ms });
      return done("completed", null);
    }
    return await fail("invalid_output");
  } catch (e) {
    log.error("mail job crashed", { job: job.id, error: e instanceof Error ? e.constructor.name : "error" });
    return await fail("agent_error");
  } finally {
    clearInterval(keepAlive);
    rmSync(dir, { recursive: true, force: true });
  }
}
