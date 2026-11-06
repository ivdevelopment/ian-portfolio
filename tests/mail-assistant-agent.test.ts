import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildContext, computeFingerprint } from "../src/lib/mail-assistant/context";
import { computeFacts } from "../src/lib/mail-assistant/facts";
import { decidePlan } from "../src/lib/mail-assistant/plan";
import type { AssistantInputs, Plan } from "../src/lib/mail-assistant/types";
import { AGENT_OPS, handleAgentOp, type Rpc } from "../src/lib/prospecting/agent/endpoint";
import { AgentApi, AgentApiError, type MailJob } from "../tools/prospect-agent/src/api-client";
import type { ProcResult, ProcRunner } from "../tools/prospect-agent/src/codex";
import { DEFAULT_CONFIG } from "../tools/prospect-agent/src/config";
import { createLogger } from "../tools/prospect-agent/src/logger";
import { runMailJob } from "../tools/prospect-agent/src/mail-job";
import { ProspectAgentService } from "../tools/prospect-agent/src/service";
import { startWorker } from "../tools/prospect-agent/src/worker";

const dirs: string[] = [];
const home = () => {
  const d = mkdtempSync(join(tmpdir(), "pma-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const quiet = createLogger({ file: false, sink: () => undefined });
const instantSleep = async () => new Promise<void>((r) => setTimeout(r, 1));
const res = (over: Partial<ProcResult> = {}): ProcResult => ({ code: 0, stdout: "", stderr: "", timedOut: false, truncated: false, spawnError: null, ...over });

/* --------------------------------------------- a first-outreach job --------------------------------------------- */

const NOW = new Date();
const inputs = (over: Partial<AssistantInputs> = {}): AssistantInputs => ({
  now: NOW,
  prospect: { id: "p1", company_name: "Brugse Bike Rental", contact_name: "Sofie", sector: "bicycle rental", city: "Brugge", website_url: "https://www.brugesbikerental.be/", email: "info@brugesbikerental.be", status: "ready_to_contact", priority: "normal", source: "AI prospecting", first_contact_on: null, last_contact_on: null, next_follow_up_on: null },
  mail: [], activities: [], quotes: [], preview: null, insight: { summary: null, opportunity: "Reservation flow", observations: ["No enquiry CTA, form or reservation link was found on the pages checked."] }, project: null,
  ...over,
});
function makeJob(over: Partial<AssistantInputs> = {}): { job: MailJob; plan: Plan } {
  const i = inputs(over);
  const facts = computeFacts(i);
  const plan = decidePlan(facts, i.now);
  return { job: { id: "33333333-3333-4333-8333-333333333333", plan, context: buildContext(i, facts, plan), attempt: 1 }, plan };
}

const GOOD = "Dag Sofie,\n\nIk kwam jullie website tegen en merkte dat de reservatieflow een stuk directer zou kunnen. Ik heb daar een kleine suggestie voor, en toon ze graag als je interesse hebt.\n\nGroeten,\nIan";
const answer = (over: Record<string, unknown> = {}) => ({ action_type: "first_outreach", recommended_send_at: null, should_send_now: true, subject: "Een kleine suggestie voor jullie site", body: GOOD, reason_summary: "A short, concrete angle on the reservation flow.", ...over });

/** Scripted Codex: each structured call gets the next answer; the prompts it was given are kept for inspection. */
function fakeCodex(answers: Array<unknown | { raw: Partial<ProcResult> }>) {
  const prompts: string[] = [];
  const calls: string[][] = [];
  let n = 0;
  const runner: ProcRunner = async (_bin, args, opts) => {
    if (args[0] !== "exec") return res();
    calls.push(args);
    prompts.push(opts.stdin);
    const a = answers[Math.min(n++, answers.length - 1)] as { raw?: Partial<ProcResult> } | undefined;
    if (a && typeof a === "object" && "raw" in a && a.raw) return res(a.raw);
    const out = args.indexOf("--output-last-message");
    if (out >= 0) writeFileSync(args[out + 1], JSON.stringify(a));
    return res();
  };
  return { runner, prompts, calls, count: () => n };
}

const flags = new Set(["--output-last-message", "--ephemeral", "--color", "--cd"]);

function fakeApi(over: { progress?: () => Promise<{ ok: true; cancel: boolean }>; result?: () => Promise<{ ok: true }> } = {}) {
  const calls: Array<[string, unknown]> = [];
  const api = {
    mailProgress: async (id: string) => (calls.push(["mailProgress", id]), over.progress ? await over.progress() : { ok: true as const, cancel: false }),
    mailResult: async (b: unknown) => (calls.push(["mailResult", b]), over.result ? await over.result() : { ok: true as const }),
    mailFail: async (b: unknown) => (calls.push(["mailFail", b]), { ok: true as const }),
  };
  return { api: api as unknown as AgentApi, calls, of: (n: string) => calls.filter(([x]) => x === n).map(([, b]) => b) };
}
const deps = (api: AgentApi, runner: ProcRunner, h = home(), extra = {}) => ({ api, config: { ...DEFAULT_CONFIG }, log: quiet, flags, runner, home: h, keepAliveMs: 60_000, ...extra });

/* ------------------------------------------------ the agent job ------------------------------------------------ */

describe("a Mail Assistant job on the agent", () => {
  it("asks Codex for ONE structured draft with the planned context, validates it, and sends it back (nothing is sent to anyone)", async () => {
    const { job } = makeJob();
    const codex = fakeCodex([answer()]);
    const f = fakeApi();
    const h = home();
    const summary = await runMailJob(job, deps(f.api, codex.runner, h));
    expect(summary).toMatchObject({ status: "completed", kind: null, codexCalls: 1 });
    expect(f.of("mailResult")).toHaveLength(1);
    expect(f.of("mailResult")[0]).toMatchObject({ jobId: job.id, result: { action_type: "first_outreach", subject: "Een kleine suggestie voor jullie site" } });
    // The same Codex runner as the Prospect Finder: read-only sandbox, prompt on stdin, strict schema, no search.
    const args = codex.calls[0];
    expect(args.slice(0, 5)).toEqual(["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-schema"]);
    expect(args).not.toContain("--search");
    expect(codex.prompts[0]).toContain("Do NOT run commands");
    expect(codex.prompts[0]).toContain("Brugse Bike Rental");
    expect(codex.prompts[0]).not.toContain("info@brugesbikerental.be");
    expect(existsSync(join(h, "runs", `mail-${job.id}`))).toBe(false); // the scratch folder is removed
  });

  it("retries ONCE with the exact reason when a draft breaks the rules, then succeeds", async () => {
    const { job } = makeJob();
    const codex = fakeCodex([answer({ body: `${GOOD} Mijn AI-analyse vond dit.` }), answer()]);
    const f = fakeApi();
    const summary = await runMailJob(job, deps(f.api, codex.runner));
    expect(summary).toMatchObject({ status: "completed", codexCalls: 2 });
    expect(codex.prompts[1]).toContain("Your previous answer was rejected: The body mentions AI");
    expect(f.of("mailFail")).toHaveLength(0);
  });

  it("gives up after the second bad draft: the request fails with a fixed kind and nothing is stored", async () => {
    const { job } = makeJob();
    const codex = fakeCodex([answer({ subject: "x" }), answer({ body: "te kort" })]);
    const f = fakeApi();
    expect(await runMailJob(job, deps(f.api, codex.runner))).toMatchObject({ status: "failed", kind: "invalid_output", codexCalls: 2 });
    expect(f.of("mailFail")).toEqual([{ jobId: job.id, kind: "invalid_output" }]);
    expect(f.of("mailResult")).toHaveLength(0);
  });

  it("never calls Codex for a request that should not exist (the plan says wait, stop, or more context is needed)", async () => {
    const waiting = makeJob({ mail: [{ id: "m", direction: "outgoing", subject: "Idee", snippet: "Dag, een idee voor jullie site.", sent_at: new Date(NOW.getTime() - 3_600_000).toISOString() }] });
    expect(waiting.plan.action).toBe("wait");
    const codex = fakeCodex([answer()]);
    const f = fakeApi();
    expect(await runMailJob(waiting.job, deps(f.api, codex.runner))).toMatchObject({ status: "failed", kind: "not_allowed", codexCalls: 0 });
    expect(codex.count()).toBe(0);
    expect(f.of("mailFail")).toEqual([{ jobId: waiting.job.id, kind: "not_allowed" }]);
  });

  it("reports Codex problems with their fixed kinds (usage limit, not signed in) and does not retry them", async () => {
    for (const [stderr, kind] of [["You've hit your usage limit. Try again in 3 hours.", "codex_usage_limit"], ["Not logged in. Run codex login", "codex_not_authenticated"]] as const) {
      const { job } = makeJob();
      const codex = fakeCodex([{ raw: { code: 1, stderr } }]);
      const f = fakeApi();
      expect(await runMailJob(job, deps(f.api, codex.runner))).toMatchObject({ status: "failed", kind, codexCalls: 1 });
      expect(f.of("mailFail")).toEqual([{ jobId: job.id, kind }]);
    }
  });

  it("a request dismissed while Codex works stops the Codex process and stores nothing", async () => {
    const { job } = makeJob();
    let aborted = false;
    const runner: ProcRunner = async (_b, args, opts) => {
      if (args[0] !== "exec") return res();
      await new Promise<void>((resolve) => opts.signal?.addEventListener("abort", () => ((aborted = true), resolve()), { once: true }));
      return res({ code: null, aborted: true });
    };
    const f = fakeApi({ progress: async () => ({ ok: true, cancel: true }) });
    const summary = await runMailJob(job, deps(f.api, runner, home(), { keepAliveMs: 5 }));
    expect(aborted).toBe(true);
    expect(summary.status).toBe("abandoned");
    expect(f.of("mailResult")).toHaveLength(0);
  });

  it("a lost lease abandons the job without sending a result", async () => {
    const { job } = makeJob();
    const codex = fakeCodex([answer()]);
    const f = fakeApi({ result: async () => { throw new AgentApiError("lease_lost", "lost", 409); } });
    expect(await runMailJob(job, deps(f.api, codex.runner))).toMatchObject({ status: "abandoned" });
  });

  it("when the server's own checks reject the answer the job ends as invalid_output (the server already failed the request)", async () => {
    const { job } = makeJob();
    const f = fakeApi({ result: async () => { throw new AgentApiError("rejected", "rejected", 422); } });
    expect(await runMailJob(job, deps(f.api, fakeCodex([answer()]).runner))).toMatchObject({ status: "failed", kind: "invalid_output" });
  });
});

/* --------------------------------------------------- the API --------------------------------------------------- */

describe("the agent API for mail requests", () => {
  const rpcLog: Array<[string, Record<string, unknown>]> = [];
  const { plan } = makeJob();
  const make = (params: unknown = { ok: true, plan }): Rpc => async (fn, args) => {
    rpcLog.push([fn, args]);
    if (fn === "agent_mail_params") return { data: params, error: null };
    return { data: { ok: true, job: null }, error: null };
  };
  const JOB = "44444444-4444-4444-8444-444444444444";

  it("knows the four mail operations and calls only their database functions with the token", async () => {
    for (const op of ["mail_claim", "mail_progress", "mail_result", "mail_fail"]) expect(AGENT_OPS).toContain(op);
    rpcLog.length = 0;
    await handleAgentOp("mail_claim", "tok", "{}", make());
    await handleAgentOp("mail_progress", "tok", JSON.stringify({ jobId: JOB }), make());
    await handleAgentOp("mail_fail", "tok", JSON.stringify({ jobId: JOB, kind: "codex_timeout" }), make());
    expect(rpcLog.map(([fn]) => fn)).toEqual(["agent_mail_claim", "agent_mail_progress", "agent_mail_fail"]);
    expect(rpcLog.every(([, a]) => a.p_token === "tok")).toBe(true);
  });

  it("rejects malformed requests before touching the database", async () => {
    rpcLog.length = 0;
    expect((await handleAgentOp("mail_progress", "t", JSON.stringify({ jobId: "nope" }), make())).status).toBe(400);
    expect((await handleAgentOp("mail_fail", "t", JSON.stringify({ jobId: JOB, kind: "<b>x</b>" }), make())).status).toBe(400);
    expect((await handleAgentOp("mail_result", "t", "not json", make())).status).toBe(400);
    expect(rpcLog).toHaveLength(0);
  });

  it("stores a valid draft with the PLAN's date and 'send now', whatever the model said", async () => {
    rpcLog.length = 0;
    const r = await handleAgentOp("mail_result", "t", JSON.stringify({ jobId: JOB, result: answer({ recommended_send_at: "2031-01-01", should_send_now: false }), codexMs: 1200 }), make());
    expect(r.status).toBe(200);
    const submit = rpcLog.find(([fn]) => fn === "agent_mail_submit")![1] as { p_result: { recommended_send_at: string; action_type: string }; p_codex_ms: number };
    expect(submit.p_result).toMatchObject({ action_type: "first_outreach", recommended_send_at: plan.recommended_on });
    expect(submit.p_codex_ms).toBe(1200);
  });

  it("refuses an answer that breaks the rules, fails the request, and stores nothing", async () => {
    rpcLog.length = 0;
    const bad = await handleAgentOp("mail_result", "t", JSON.stringify({ jobId: JOB, result: answer({ action_type: "follow_up" }) }), make());
    expect(bad.status).toBe(422);
    expect(rpcLog.map(([fn]) => fn)).toEqual(["agent_mail_params", "agent_mail_fail"]);
    expect(rpcLog.some(([fn]) => fn === "agent_mail_submit")).toBe(false);
  });

  it("a stored plan that says wait never accepts a draft (reject, do not override into a send)", async () => {
    const waiting = makeJob({ mail: [{ id: "m", direction: "outgoing", subject: "Idee", snippet: "Dag, een idee voor jullie site.", sent_at: new Date(NOW.getTime() - 3_600_000).toISOString() }] }).plan;
    rpcLog.length = 0;
    const r = await handleAgentOp("mail_result", "t", JSON.stringify({ jobId: JOB, result: answer({ action_type: "follow_up" }) }), make({ ok: true, plan: waiting }));
    expect(r).toMatchObject({ status: 422, body: { ok: false, error: "rejected" } });
    expect(rpcLog.some(([fn]) => fn === "agent_mail_submit")).toBe(false);
  });

  it("an unknown token or a lost lease is passed through as 401 / 409", async () => {
    expect((await handleAgentOp("mail_result", "t", JSON.stringify({ jobId: JOB, result: answer() }), make({ ok: false, error: "unauthorized" }))).status).toBe(401);
    expect((await handleAgentOp("mail_result", "t", JSON.stringify({ jobId: JOB, result: answer() }), make({ ok: false, error: "lease_lost" }))).status).toBe(409);
  });
});

/* ---------------------------------------------- worker and tray app ---------------------------------------------- */

describe("the worker picks up mail requests", () => {
  const apiWith = (mailJobs: MailJob[], over: Record<string, unknown> = {}) => {
    const calls: Array<[string, unknown]> = [];
    const queue = [...mailJobs];
    const api = {
      heartbeat: async (b: unknown) => (calls.push(["heartbeat", b]), { ok: true as const, device: "Ian-PC" }),
      claim: async () => (calls.push(["claim", {}]), null),
      mailClaim: async () => (calls.push(["mailClaim", {}]), queue.shift() ?? null),
      mailProgress: async () => ({ ok: true as const, cancel: false }),
      mailResult: async (b: unknown) => (calls.push(["mailResult", b]), { ok: true as const }),
      mailFail: async (b: unknown) => (calls.push(["mailFail", b]), { ok: true as const }),
      ...over,
    };
    return { api: api as unknown as AgentApi, calls, of: (n: string) => calls.filter(([x]) => x === n).map(([, b]) => b) };
  };
  const loginOk = (answers: unknown[]): ProcRunner => {
    const codex = fakeCodex(answers);
    return async (bin, args, opts) => {
      if (args[0] === "--version") return res({ stdout: "codex-cli 0.166.0\n" });
      if (args[0] === "exec" && args[1] === "--help") return res({ stdout: "--output-schema --sandbox --skip-git-repo-check --output-last-message --ephemeral --model --cd --color" });
      if (args[0] === "login") return res({ stdout: "Logged in using ChatGPT" });
      return codex.runner(bin, args, opts);
    };
  };

  it("looks for a draft request only when there is no search to run, runs it, and keeps going", async () => {
    const { job } = makeJob();
    const f = apiWith([job]);
    const events: string[] = [];
    const worker = startWorker({ api: f.api, config: { ...DEFAULT_CONFIG, pollSeconds: 2 }, log: quiet, runner: loginOk([answer()]), sleep: instantSleep, home: home(), heartbeatMs: 5, hooks: { onMailStart: () => events.push("start"), onMailEnd: (_id, s) => events.push(`end:${s.status}`) } });
    await vi.waitFor(() => expect(f.of("mailResult")).toHaveLength(1), { timeout: 15_000 });
    worker.stop();
    await worker.done;
    expect(events).toEqual(["start", "end:completed"]);
    const order = f.calls.map(([n]) => n).filter((n) => n === "claim" || n === "mailClaim");
    expect(order.slice(0, 2)).toEqual(["claim", "mailClaim"]); // searches first, then mail
  });

  it("a Codex usage limit on a draft pauses claiming, exactly like a usage limit on a search", async () => {
    const { job } = makeJob();
    const f = apiWith([job, job]);
    const worker = startWorker({ api: f.api, config: DEFAULT_CONFIG, log: quiet, runner: loginOk([{ raw: { code: 1, stderr: "usage limit reached" } }]), sleep: instantSleep, home: home(), heartbeatMs: 5, usageLimitPauseMs: 60_000 });
    await vi.waitFor(() => expect(f.of("mailFail")).toHaveLength(1), { timeout: 15_000 });
    const claims = f.of("mailClaim").length;
    await new Promise((r) => setTimeout(r, 40));
    expect(f.of("mailClaim").length).toBe(claims);
    worker.stop();
    await worker.done;
  });

  it("an older CRM that does not know the mail operations simply has no mail requests (no error, no backoff)", async () => {
    const api = new AgentApi("https://crm.example", `ipa_${"A".repeat(43)}`, (async (url: string) => (String(url).endsWith("/mail_claim") ? new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404 }) : new Response("{}", { status: 200 }))) as unknown as typeof fetch);
    expect(await api.mailClaim()).toBeNull();
    const down = new AgentApi("https://crm.example", `ipa_${"A".repeat(43)}`, (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch);
    await expect(down.mailClaim()).rejects.toMatchObject({ kind: "server" }); // a real outage is still an outage
  });

  it("the tray app shows a draft request as 'Mail Assistant' and never announces it as a finished search", async () => {
    const { job } = makeJob();
    const f = apiWith([job]);
    const service = new ProspectAgentService({ home: home(), loadConfig: () => ({ ...DEFAULT_CONFIG, pollSeconds: 2 }), loadToken: async () => "ipa_token", createApi: () => f.api, runner: loginOk([answer()]), log: quiet, noLock: true, workerOverrides: { sleep: instantSleep, heartbeatMs: 5 } });
    const labels: Array<string | null> = [];
    const events: string[] = [];
    service.onState((s) => labels.push(s.activeRun ? `${s.activeRun.modeLabel}|${s.activeRun.stage}` : null));
    service.onEvent((e) => events.push(e.type));
    await service.start();
    await vi.waitFor(() => expect(f.of("mailResult")).toHaveLength(1), { timeout: 15_000 });
    await service.stop();
    expect(labels).toContain("Mail Assistant|Generating draft…");
    expect(service.getState().activeRun).toBeNull();
    expect(events).not.toContain("run_finished"); // no "Prospect search completed" notification for a mail draft
  });
});

describe("what the draft request is allowed to know", () => {
  it("the fingerprint stored with a request is the CRM's own, and the context holds no address, score or tracking detail", () => {
    const i = inputs({ preview: { linked: true, id: "pv", firstAccessedAt: "2026-11-02T14:37:00Z", lastAccessedAt: "2026-11-03T09:00:00Z", accessCount: 4 } });
    const { job } = makeJob({ preview: i.preview });
    const json = JSON.stringify(job.context);
    for (const secret of ["info@brugesbikerental.be", "14:37", "score", "accessCount", "firstAccessedAt"]) expect(json).not.toContain(secret);
    expect(computeFingerprint(i).fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
