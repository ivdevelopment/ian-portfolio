import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AgentApi, AgentApiError, type RunParams } from "../tools/prospect-agent/src/api-client";
import { acquireLock, readLock } from "../tools/prospect-agent/src/lock";
import { readChildren, reapOrphans, registerChild, shouldReap, unregisterChild } from "../tools/prospect-agent/src/children";
import type { ProcResult, ProcRunner } from "../tools/prospect-agent/src/codex";
import { runProcess } from "../tools/prospect-agent/src/codex";
import { DEFAULT_CONFIG } from "../tools/prospect-agent/src/config";
import { createLogger } from "../tools/prospect-agent/src/logger";
import { updateBusinessData, type UpdateStage } from "../tools/prospect-agent/src/osm/data-manager";
import { crmPageUrl, deriveOverall, formatDiagnostics, ProspectAgentService, progressOf, type AgentSnapshot, type ServiceDeps } from "../tools/prospect-agent/src/service";
import { MockBusinessSource } from "../src/lib/prospecting/providers/mock";

/* No test here starts a real Codex, touches the network or reads a real credential: processes and the CRM are scripted fakes. */

const dirs: string[] = [];
const home = () => {
  const d = mkdtempSync(join(tmpdir(), "pas-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const quiet = createLogger({ file: false, sink: () => undefined });
// Runs are scripted and fast, but a loaded machine (the whole suite in parallel) can take a few seconds: wait generously, return as soon as it is true.
const wf = <T>(fn: () => T | Promise<T>) => vi.waitFor(fn, { timeout: 15_000, interval: 10 });
const instantSleep = async () => new Promise<void>((r) => setTimeout(r, 1));
const TOKEN = `ipa_${"T".repeat(43)}`;
const RUN: RunParams = { id: "22222222-2222-4222-8222-222222222222", mode: "quick", location: "Brugge", area: null, industry: null, threshold: 70, count: 5, excludeResearched: true, attempt: 1 };

const res = (over: Partial<ProcResult> = {}): ProcResult => ({ code: 0, stdout: "", stderr: "", timedOut: false, truncated: false, spawnError: null, ...over });

/** A scripted stand-in for the codex executable. `exec` decides what a structured call answers; `hang` waits until the call is aborted. */
function fakeCodex(o: { version?: string | null; login?: number; exec?: (prompt: string) => { json?: unknown; raw?: Partial<ProcResult> }; hang?: boolean } = {}) {
  const calls: string[][] = [];
  const help = "Usage: codex exec\n  --output-schema <FILE>\n  --output-last-message <FILE>\n  --sandbox <MODE>\n  --skip-git-repo-check\n  --ephemeral\n  --model <MODEL>\n  --cd <DIR>\n  --color <COLOR>";
  let aborted = 0;
  const runner: ProcRunner = async (_bin, args, opts) => {
    calls.push(args);
    if (o.version === null) return res({ code: null, spawnError: "ENOENT" });
    if (args[0] === "--version") return res({ stdout: `codex-cli ${o.version ?? "0.166.0"}\n` });
    if (args[0] === "exec" && args[1] === "--help") return res({ stdout: help });
    if (args[0] === "login" && args[1] === "status") return res({ code: o.login ?? 0, stdout: o.login ? "" : "Logged in using ChatGPT" });
    if (args[0] === "doctor") return res({ code: 1 });
    if (args[0] === "exec") {
      if (o.hang) {
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) return resolve();
          opts.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        aborted++;
        return res({ code: null, aborted: true });
      }
      const r = o.exec ? o.exec(opts.stdin) : { json: { ok: true } };
      const out = args.indexOf("--output-last-message");
      if (r.json !== undefined && out >= 0) writeFileSync(args[out + 1], JSON.stringify(r.json));
      return res(r.raw ?? {});
    }
    return res({ code: 1 });
  };
  return { runner, calls, aborted: () => aborted };
}

/** Answers every business of a batch with a plausible assessment (the pipeline's own checks still apply). */
function answer(prompt: string) {
  const businesses = JSON.parse(prompt.split("\n").at(-1)!) as Array<{ ref: string; observations: Array<{ id: string }> }>;
  const cat = (score: number, obs: string[]) => ({ score, reason: "Observed from the data provided.", observations: obs });
  return { assessments: businesses.map((b) => ({ ref: b.ref, scores: { business_fit: cat(22, []), website_need: cat(20, b.observations.slice(0, 1).map((o) => o.id)), conversion_gap: cat(12, b.observations.slice(0, 1).map((o) => o.id)), service_opportunity: cat(12, []), local_relevance: cat(8, []), contactability: cat(0, []) }, summary: "A modernisation opportunity.", opportunity: "Website redesign" })) };
}

type FakeApiOpts = { heartbeat?: () => Promise<{ ok: true; device: string }>; claims?: Array<RunParams | null | Error> };
function fakeApi(o: FakeApiOpts = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let claimN = 0;
  const api = {
    heartbeat: async (b: Record<string, unknown>) => (calls.push(["heartbeat", b]), o.heartbeat ? await o.heartbeat() : { ok: true as const, device: "Ian-PC" }),
    claim: async () => {
      calls.push(["claim", {}]);
      const next = o.claims?.[claimN++] ?? null;
      if (next instanceof Error) throw next;
      return next;
    },
    context: async () => ({ ok: true as const, run: { threshold: 70, mode: "quick", count: 5 }, prospects: [], decided: [], seen: [] }),
    progress: async (b: Record<string, unknown>) => (calls.push(["progress", b]), { ok: true as const, cancel: false }),
    result: async (b: Record<string, unknown>) => (calls.push(["result", b]), { ok: true as const, inserted: (b.candidates as unknown[]).length, skipped_known: 0, rejected: 0 }),
    fail: async (b: Record<string, unknown>) => (calls.push(["fail", b]), { ok: true as const }),
  };
  return { api: api as unknown as AgentApi, calls, of: (n: string) => calls.filter(([x]) => x === n).map(([, b]) => b) };
}

function make(api: AgentApi, runner: ProcRunner, over: Partial<ServiceDeps> & { h?: string } = {}) {
  const h = over.h ?? home();
  const created: string[] = [];
  const service = new ProspectAgentService({
    home: h,
    loadConfig: () => ({ ...DEFAULT_CONFIG, pollSeconds: 2 }),
    loadToken: async () => TOKEN,
    createApi: (base) => (created.push(base), api),
    runner,
    source: new MockBusinessSource(),
    log: quiet,
    noLock: true,
    workerOverrides: { sleep: instantSleep, heartbeatMs: 5 },
    ...over,
  });
  return { service, h, created };
}

const running = async (s: ProspectAgentService) => {
  expect(await s.start()).toEqual({ ok: true });
  await wf(() => expect(s.getState().worker).toBe("running"));
};

/* ---------------------------------- start, state, stop ---------------------------------- */

describe("ProspectAgentService: start, state and stop", () => {
  it("starts the worker, reports structured state, and exposes no token and no filesystem path", async () => {
    const f = fakeApi();
    const { service, h } = make(f.api, fakeCodex().runner);
    expect(service.getState().worker).toBe("stopped");
    await running(service);
    await wf(() => expect(service.getState().codex.state).toBe("ready"));
    const s = service.getState();
    expect(s).toMatchObject({ worker: "running", crm: { state: "connected", device: "Ian-PC" }, codex: { state: "ready", version: "0.166.0" }, activeRun: null });
    expect(s.crm.lastHeartbeat).toBeGreaterThan(0);
    expect(f.of("heartbeat")[0]).toMatchObject({ codexVersion: "0.166.0", codexState: "ready" });
    const json = JSON.stringify(s);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("ipa_");
    expect(json).not.toContain(h);
    expect(deriveOverall(s).level).not.toBe("green"); // business data is not installed in this temp home: partly ready, said plainly
    expect(deriveOverall(s)).toMatchObject({ label: "Partly ready", detail: "Business data missing" });
    await service.stop();
    expect(service.getState()).toMatchObject({ worker: "stopped", crm: { state: "unknown" } });
  });

  it("prevents a double start: simultaneous starts share one worker, a start while running is refused", async () => {
    const f = fakeApi();
    const { service, created } = make(f.api, fakeCodex().runner);
    const [a, b, c] = await Promise.all([service.start(), service.start(), service.start()]);
    expect([a, b, c]).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(created).toHaveLength(1);
    await wf(() => expect(service.getState().worker).toBe("running"));
    expect(await service.start()).toMatchObject({ ok: false, reason: "already_running" });
    expect(created).toHaveLength(1);
    await service.stop();
    // And it can be started again afterwards.
    expect(await service.start()).toEqual({ ok: true });
    expect(created).toHaveLength(2);
    await service.stop();
  });

  it("does not start without a stored token and says setup is required", async () => {
    const { service } = make(fakeApi().api, fakeCodex().runner, { loadToken: async () => null });
    expect(await service.start()).toMatchObject({ ok: false, reason: "not_configured" });
    expect(service.getState()).toMatchObject({ worker: "stopped", lastError: { kind: "not_configured" } });
    expect(deriveOverall({ ...service.getState(), setup: { configured: false, crmHost: "" } })).toMatchObject({ level: "amber", label: "Setup required" });
  });

  it("stopping an idle worker is immediate and reports the stop as an event", async () => {
    const { service } = make(fakeApi().api, fakeCodex().runner);
    const events: string[] = [];
    service.onEvent((e) => events.push(e.type));
    await running(service);
    expect(await service.stop()).toEqual({ ok: true });
    expect(events).toContain("worker_stopped");
    expect(await service.stop()).toEqual({ ok: true }); // stopping a stopped agent is harmless
  });

  it("a heartbeat that answers after the worker has stopped does not bring the old state back", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const f = fakeApi({ heartbeat: async () => { if (++calls > 1) await gate; return { ok: true as const, device: "Ian-PC" }; } });
    const { service } = make(f.api, fakeCodex().runner);
    await running(service);
    await wf(() => expect(calls).toBeGreaterThan(1)); // a later heartbeat is now in flight
    await service.stop();
    const stopped = service.getState();
    expect(stopped).toMatchObject({ worker: "stopped", crm: { state: "unknown" } });
    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(service.getState().crm).toEqual(stopped.crm); // the late answer changed nothing
    expect(service.getState().worker).toBe("stopped");
  });

  it("a revoked device (token rejected) ends in an error state with a plain message, and the lock is released", async () => {
    const h = home();
    const f = fakeApi({ heartbeat: async () => { throw new AgentApiError("unauthorized", "x", 401); } });
    const { service } = make(f.api, fakeCodex().runner, { h, noLock: false });
    await service.start();
    await wf(() => expect(service.getState().worker).toBe("error"));
    const s = service.getState();
    expect(s).toMatchObject({ crm: { state: "rejected" }, lastError: { kind: "crm_rejected" } });
    expect(deriveOverall(s)).toMatchObject({ level: "red", label: "Error" });
    expect(readLock(h)).toBeNull();
  });
});

/* ------------------------------------- one worker per user ------------------------------------- */

describe("one worker per Windows user", () => {
  it("a second service (the command line next to the tray app) cannot start while the first runs, and can after it stops", async () => {
    const h = home();
    const a = make(fakeApi().api, fakeCodex().runner, { h, noLock: false, owner: "desktop" });
    const b = make(fakeApi().api, fakeCodex().runner, { h, noLock: false, owner: "cli" });
    // Both are in this one process, so the second sees the lock as its own; simulate a different live owner.
    await running(a.service);
    const real = readLock(h)!;
    expect(real).toMatchObject({ pid: process.pid, owner: "desktop" });
    writeFileSync(join(h, "agent.lock"), JSON.stringify({ ...real, pid: process.ppid || 1, owner: "desktop" }));
    expect(await b.service.start()).toMatchObject({ ok: false, reason: "locked" });
    expect(b.service.getState()).toMatchObject({ worker: "stopped", lastError: { kind: "already_running_elsewhere" } });
    await a.service.stop();
    rmSync(join(h, "agent.lock"), { force: true });
    expect(await b.service.start()).toEqual({ ok: true });
    await b.service.stop();
    expect(existsSync(join(h, "agent.lock"))).toBe(false);
  });

  it("takes over a lock left by a process that no longer exists, and never takes one from a live process", () => {
    const h = home();
    mkdirSync(h, { recursive: true });
    writeFileSync(join(h, "agent.lock"), JSON.stringify({ pid: 4242, startedAt: 1, owner: "cli" }));
    const live = acquireLock("desktop", { home: h, isAlive: () => true });
    expect(live).toMatchObject({ ok: false, holder: { pid: 4242, owner: "cli" } });
    const stale = acquireLock("desktop", { home: h, isAlive: () => false });
    expect(stale.ok).toBe(true);
    expect(readLock(h)).toMatchObject({ pid: process.pid, owner: "desktop" });
    if (stale.ok) stale.release();
    expect(readLock(h)).toBeNull();
  });

  it("two simultaneous acquisitions cannot both win (exclusive create)", () => {
    const h = home();
    const first = acquireLock("a", { home: h, isAlive: () => true });
    expect(first.ok).toBe(true);
    // Same process id counts as ours; a different live id is refused.
    writeFileSync(join(h, "agent.lock"), JSON.stringify({ pid: 777, startedAt: 1, owner: "x" }));
    expect(acquireLock("b", { home: h, isAlive: (p) => p === 777 }).ok).toBe(false);
  });
});

/* --------------------------------------- readiness --------------------------------------- */

describe("readiness: CRM, Codex, business data are separate", () => {
  it("CRM offline: the worker keeps running and retrying, the status says so, and it recovers", async () => {
    let offline = true;
    const f = fakeApi({ heartbeat: async () => { if (offline) throw new AgentApiError("network", "offline"); return { ok: true as const, device: "Ian-PC" }; } });
    const { service } = make(f.api, fakeCodex().runner);
    await service.start();
    await wf(() => expect(service.getState().crm.state).toBe("offline"));
    expect(service.getState().worker).toBe("running");
    expect(deriveOverall(service.getState())).toMatchObject({ level: "amber", label: "Offline — retrying" });
    offline = false;
    await wf(() => expect(service.getState().crm.state).toBe("connected"));
    await service.stop();
  });

  it("Codex not signed in: the CRM is still Connected, Codex says sign-in required, and no run is claimed", async () => {
    const f = fakeApi();
    const { service } = make(f.api, fakeCodex({ login: 1 }).runner);
    await service.start();
    await wf(() => expect(service.getState().codex.state).toBe("not_authenticated"));
    const s = service.getState();
    expect(s.crm.state).toBe("connected");
    expect(deriveOverall(s).detail).toContain("Codex sign-in required");
    await new Promise((r) => setTimeout(r, 30));
    expect(f.of("claim")).toHaveLength(0);
    await service.stop();
  });

  it("Codex not installed is reported as such", async () => {
    const { service } = make(fakeApi().api, fakeCodex({ version: null }).runner);
    await service.start();
    await wf(() => expect(service.getState().codex.state).toBe("not_installed"));
    expect(deriveOverall(service.getState()).detail).toContain("Codex not installed");
    await service.stop();
  });

  it("overall status: colour never stands alone, and every state has words", () => {
    const base = (over: Partial<AgentSnapshot>): AgentSnapshot => ({ ...new ProspectAgentService({ home: home(), log: quiet, noLock: true, loadConfig: () => DEFAULT_CONFIG }).getState(), ...over });
    const ready = { ready: true, source: "Geofabrik Belgium", dataDate: "2026-11-05T00:00:00Z", ageDays: 1, freshness: "fresh" as const, businesses: 100, health: "ok" as const };
    const crm = { state: "connected" as const, device: "Ian-PC", lastHeartbeat: 1 };
    const codex = { state: "ready" as const, version: "0.166.0", note: null, checkedAt: 1, pausedUntil: null };
    const all = base({ worker: "running", crm, codex, businessData: ready, setup: { configured: true, crmHost: "ianverlinden.com" } });
    expect(deriveOverall(all)).toMatchObject({ level: "green", label: "Connected" });
    expect(deriveOverall({ ...all, worker: "stopped" })).toMatchObject({ level: "gray", label: "Stopped" });
    expect(deriveOverall({ ...all, worker: "starting" })).toMatchObject({ level: "amber", label: "Starting…" });
    expect(deriveOverall({ ...all, worker: "stopping" })).toMatchObject({ level: "amber", label: "Stopping…" });
    expect(deriveOverall({ ...all, worker: "error", lastError: { kind: "start_failed", message: "The agent stopped with an error.", at: 1 } })).toMatchObject({ level: "red" });
    expect(deriveOverall({ ...all, crm: { ...crm, state: "offline" } })).toMatchObject({ level: "amber", label: "Offline — retrying" });
    expect(deriveOverall({ ...all, crm: { ...crm, state: "rejected" } })).toMatchObject({ level: "red" });
    expect(deriveOverall({ ...all, codex: { ...codex, state: "usage_limit" } })).toMatchObject({ level: "amber", label: "Codex usage limit reached" });
    expect(deriveOverall({ ...all, businessData: { ...ready, ready: false, health: "missing" } })).toMatchObject({ label: "Partly ready", detail: "Business data missing" });
  });
});

/* ----------------------------------- an active run ----------------------------------- */

describe("an active run: stopping never kills it silently", () => {
  it("asks first; \"stop anyway\" ends the Codex process at once and the run is reported as cancelled (not abandoned, not failed)", async () => {
    const f = fakeApi({ claims: [RUN] });
    const codex = fakeCodex({ hang: true });
    const { service } = make(f.api, codex.runner);
    await running(service);
    await wf(() => expect(service.getState().activeRun).not.toBeNull());
    expect(service.getState().activeRun).toMatchObject({ modeLabel: "Quick Find", location: "Brugge" });
    await wf(() => expect(codex.calls.some((a) => a[0] === "exec" && a[1] !== "--help")).toBe(true));
    // Without confirmation nothing is stopped.
    expect(await service.stop()).toMatchObject({ ok: false, reason: "run_active" });
    expect(service.getState()).toMatchObject({ worker: "running" });
    expect(service.getState().activeRun).not.toBeNull();
    expect(codex.aborted()).toBe(0);
    // Confirmed: Codex is ended and the run is told to the CRM as cancelled.
    expect(await service.stop({ mode: "force" })).toEqual({ ok: true });
    expect(codex.aborted()).toBe(1);
    expect(service.getState()).toMatchObject({ worker: "stopped", activeRun: null });
    expect(f.of("result")).toHaveLength(1);
    expect(f.of("result")[0]).toMatchObject({ final: { status: "cancelled" } });
    expect(f.of("fail")).toHaveLength(0);
  });

  it("the active run shows real progress and no candidate details", async () => {
    const f = fakeApi({ claims: [RUN] });
    const { service } = make(f.api, fakeCodex({ hang: true }).runner);
    await running(service);
    await wf(() => expect(service.getState().activeRun?.stage).toMatch(/Qualifying|Analyz|Checking/));
    const json = JSON.stringify(service.getState().activeRun);
    expect(json).not.toMatch(/@|company|email|phone/i);
    await service.stop({ mode: "force" });
  });

  it("reports a finished run as an event (for a notification) but a stop by the person is not announced as a failure", async () => {
    const f = fakeApi({ claims: [RUN] });
    const { service } = make(f.api, fakeCodex({ exec: (p) => ({ json: answer(p) }) }).runner);
    const events: Array<{ type: string; status?: string; candidates?: number }> = [];
    service.onEvent((e) => events.push(e));
    await running(service);
    await wf(() => expect(events.some((e) => e.type === "run_finished")).toBe(true));
    expect(events.find((e) => e.type === "run_finished")).toMatchObject({ status: "completed" });
    expect(service.getState().lastRun).toMatchObject({ status: "completed" });
    await service.stop();
  });

  it("progress numbers come from the real counters: websites analysed out of those that passed the duplicate and cooldown checks", () => {
    expect(progressOf("Analyzing 8 websites…", { raw_found: 12, duplicates_removed: 3, skipped_cooldown: 1, analyzed: 3 })).toEqual({ done: 3, total: 8 });
    expect(progressOf("Finding businesses…", { raw_found: 12 })).toEqual({ done: null, total: null });
    expect(progressOf("Analyzing 2 websites…", { raw_found: 0 })).toEqual({ done: null, total: null });
    expect(progressOf("Qualifying candidates…", { raw_found: 5, analyzed: 9 })).toEqual({ done: 5, total: 5 });
  });
});

/* --------------------------------------- usage limit --------------------------------------- */

describe("Codex usage limit", () => {
  it("is shown clearly, the agent stays online, and no further run is claimed until Codex works again", async () => {
    const f = fakeApi({ claims: [RUN, RUN, RUN] });
    const { service } = make(f.api, fakeCodex({ exec: () => ({ raw: { code: 1, stderr: "You've hit your usage limit. Try again in 3 hours." } }) }).runner);
    await running(service);
    await wf(() => expect(service.getState().codex.state).toBe("usage_limit"));
    const s = service.getState();
    expect(s.worker).toBe("running");
    expect(s.crm.state).toBe("connected");
    expect(s.codex.pausedUntil).toBeGreaterThan(Date.now());
    expect(deriveOverall(s)).toMatchObject({ level: "amber", label: "Codex usage limit reached" });
    const claims = f.of("claim").length;
    await new Promise((r) => setTimeout(r, 40));
    expect(f.of("claim").length).toBe(claims); // paused: nothing more is accepted
    expect(f.of("fail")[0]).toMatchObject({ kind: "codex_usage_limit" });
    await service.stop();
  });
});

/* ---------------------------------------- Test Codex ---------------------------------------- */

describe("Test Codex", () => {
  const outcome = async (codex: ReturnType<typeof fakeCodex>) => {
    const { service } = make(fakeApi().api, codex.runner);
    return { service, result: await service.testCodex() };
  };

  it("ready: runs the real structured test and reports the version", async () => {
    const { result, service } = await outcome(fakeCodex());
    expect(result).toMatchObject({ state: "ready", message: "Codex ready", version: "0.166.0" });
    expect(service.getState()).toMatchObject({ codex: { state: "ready", version: "0.166.0" }, tasks: { codexTest: { state: "idle", result: { state: "ready" } } } });
  });
  it("sign-in required", async () => {
    expect((await outcome(fakeCodex({ login: 1 }))).result).toMatchObject({ state: "sign_in_required", message: "Codex sign-in required" });
  });
  it("not installed", async () => {
    expect((await outcome(fakeCodex({ version: null }))).result).toMatchObject({ state: "not_installed", message: "Codex not installed" });
  });
  it("usage limit reached", async () => {
    const { result, service } = await outcome(fakeCodex({ exec: () => ({ raw: { code: 1, stderr: "usage limit reached" } }) }));
    expect(result).toMatchObject({ state: "usage_limit", message: "Usage limit reached" });
    expect(service.getState().codex.state).toBe("usage_limit");
  });
  it("test failed when the answer has the wrong shape or the call fails", async () => {
    expect((await outcome(fakeCodex({ exec: () => ({ json: { nope: 1 } }) }))).result).toMatchObject({ state: "failed" });
    expect((await outcome(fakeCodex({ exec: () => ({ raw: { code: 2, stderr: "boom" } }) }))).result).toMatchObject({ state: "failed" });
  });
  it("never puts raw Codex output or a path into the result", async () => {
    const { result } = await outcome(fakeCodex({ exec: () => ({ raw: { code: 2, stderr: "secret-ish stderr C:\\Users\\ian\\x" } }) }));
    expect(JSON.stringify(result)).not.toMatch(/secret-ish|C:\\/);
  });
  it("a second test while one runs does not start another", async () => {
    const codex = fakeCodex({ hang: true });
    const { service } = make(fakeApi().api, codex.runner);
    const first = service.testCodex();
    await wf(() => expect(service.getState().tasks.codexTest.state).toBe("running"));
    const second = await service.testCodex();
    expect(second.state).toBe("failed");
    expect(second.message).toMatch(/already running/);
    // The scripted exec never answers; the real call is bounded by its own timeout. Leave it: the test process exits.
    void first;
  });
});

/* ---------------------------------------- business data ---------------------------------------- */

describe("Update business data", () => {
  it("reports the real stages in order and ends ready; the main state holds no path", async () => {
    const stages: string[] = [];
    const { service, h } = make(fakeApi().api, fakeCodex().runner, {
      updateBusinessData: async (d) => {
        for (const st of [{ stage: "checking" }, { stage: "downloading", bytes: 50, total: 200 }, { stage: "verifying", detail: "download" }, { stage: "building", percent: 40 }, { stage: "done", outcome: "updated" }] as UpdateStage[]) {
          d.onStage?.(st);
          const t = service.getState().tasks.businessUpdate;
          stages.push(`${t.state}:${t.label}${t.percent !== null ? `:${t.percent}` : ""}`);
        }
        return { outcome: "up_to_date", status: (await import("../tools/prospect-agent/src/osm/data-manager")).businessDataStatus(h) };
      },
    });
    const r = await service.updateBusinessData();
    expect(r).toMatchObject({ ok: true, outcome: "up_to_date" });
    expect(stages).toEqual(["running:Checking current data…", "running:Downloading Belgium OSM…:25", "running:Verifying checksum…", "running:Building index…:40", "idle:Ready"]);
    expect(service.getState().tasks.businessUpdate).toMatchObject({ state: "idle", label: "Ready" });
    expect(JSON.stringify(service.getState())).not.toContain(h);
  });

  it("refuses while a run is active or another update is running", async () => {
    const f = fakeApi({ claims: [RUN] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { service, h } = make(f.api, fakeCodex({ hang: true }).runner, { updateBusinessData: async () => { await gate; return { outcome: "failed", message: "x", status: (await import("../tools/prospect-agent/src/osm/data-manager")).businessDataStatus(h) }; } });
    await running(service);
    await wf(() => expect(service.getState().activeRun).not.toBeNull());
    expect(await service.updateBusinessData()).toMatchObject({ ok: false, reason: "run_active" });
    await service.stop({ mode: "force" });
    const first = service.updateBusinessData();
    expect(await service.updateBusinessData()).toMatchObject({ ok: false, reason: "already_running" });
    release();
    expect(await first).toMatchObject({ ok: false, reason: "failed" });
  });

  it("a failed update says so in plain words and keeps the technical text out of the state", async () => {
    const { service, h } = make(fakeApi().api, fakeCodex().runner, { updateBusinessData: async () => ({ outcome: "failed", message: "Could not reach Geofabrik (ECONNRESET at 10.0.0.1)", status: (await import("../tools/prospect-agent/src/osm/data-manager")).businessDataStatus(h) }) });
    const r = await service.updateBusinessData();
    expect(r).toMatchObject({ ok: false, reason: "failed" });
    expect(service.getState().lastError).toMatchObject({ kind: "source_error", message: "Business source update failed" });
    expect(JSON.stringify(service.getState())).not.toContain("10.0.0.1");
  });

  it("the real update emits checking, downloading with progress, verifying, building, installing and done (stubbed network and index builder)", async () => {
    const h = home();
    const stages: UpdateStage[] = [];
    const out = await updateBusinessData({
      home: h,
      force: true,
      minBusinesses: 1,
      onStage: (s) => stages.push(s),
      remote: async () => ({ url: "https://example.test/x.pbf", sizeBytes: 100, lastModified: "Wed, 04 Nov 2026 21:21:00 GMT", etag: null, md5: "a".repeat(32) }),
      download: async ({ dest, onProgress }) => {
        writeFileSync(dest, "pbf");
        onProgress?.(40, 100);
        return { bytes: 100, md5: "a".repeat(32), verified: true };
      },
      build: ({ outPath, log }) => {
        const db = new DatabaseSync(outPath);
        db.exec("create table t (x)");
        db.close();
        log?.("pass 1/2: 50%");
        log?.("pass 2/2: 100%");
        return { businesses: 5, places: 1, indexBytes: 10, seconds: 1, dataDate: "2026-11-04T21:21:00.000Z" } as never;
      },
    });
    expect(out.outcome).toBe("updated");
    expect(stages.map((s) => s.stage)).toEqual(["checking", "downloading", "downloading", "verifying", "building", "building", "building", "verifying", "installing", "done"]);
    expect(stages.filter((s) => s.stage === "building").map((s) => (s as { percent: number }).percent)).toEqual([0, 25, 100]);
    expect(stages.at(-1)).toEqual({ stage: "done", outcome: "updated" });
    // A UI callback that throws cannot break the update.
    const again = await updateBusinessData({ home: h, force: true, minBusinesses: 1, onStage: () => { throw new Error("ui"); }, remote: async () => ({ url: "u", sizeBytes: null, lastModified: null, etag: null, md5: null }), download: async ({ dest }) => (writeFileSync(dest, "p"), { bytes: 1, md5: "b", verified: false }), build: ({ outPath }) => { const d = new DatabaseSync(outPath); d.exec("create table t (x)"); d.close(); return { businesses: 5, places: 1, indexBytes: 1, seconds: 0, dataDate: null } as never; } });
    expect(again.outcome).toBe("updated");
  });
});

/* ------------------------------------------ diagnostics ------------------------------------------ */

describe("diagnostics and secrets", () => {
  it("copied diagnostics are scrubbed of tokens and bearer values even if one leaks into an error message", () => {
    const { service } = make(fakeApi().api, fakeCodex().runner);
    const state: AgentSnapshot = { ...service.getState(), lastError: { kind: "start_failed", message: `failed with ${TOKEN} and Authorization: Bearer ${"q".repeat(40)} and sk-${"z".repeat(30)}`, at: 1 } };
    const text = formatDiagnostics(state, { crmEndpoint: "https://ianverlinden.com", codexExecutable: "C:\\Users\\ianve\\AppData\\Roaming\\npm\\codex.cmd", extra: { Note: `again ${TOKEN}` } });
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("q".repeat(40));
    expect(text).not.toContain("z".repeat(30));
    expect(text).toContain("Agent version:");
    expect(text).toContain("CRM endpoint:    https://ianverlinden.com");
    expect(text).toContain("Codex executable:");
    expect(text).toContain("[redacted]");
  });

  it("the service's own diagnostics carry the fields asked for and nothing secret", () => {
    const { service } = make(fakeApi().api, fakeCodex().runner);
    const text = service.diagnostics({ "Log folder": "C:\\logs" });
    for (const label of ["Agent version", "Codex:", "CRM endpoint", "Last heartbeat", "Business index date", "Business count", "Last error"]) expect(text).toContain(label);
    expect(text).not.toMatch(/ipa_[A-Za-z0-9]{10}|Bearer\s+\S{16}|OPENAI|service_role/i);
  });

  it("the snapshot never contains secrets even after a full run with a token present", async () => {
    const f = fakeApi({ claims: [RUN] });
    const { service } = make(f.api, fakeCodex({ exec: (p) => ({ json: answer(p) }) }).runner);
    const seen: string[] = [];
    service.onState((s) => seen.push(JSON.stringify(s)));
    await running(service);
    await wf(() => expect(service.getState().lastRun).not.toBeNull());
    await service.stop();
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.join("\n")).not.toContain(TOKEN);
    expect(seen.join("\n")).not.toMatch(/ipa_|Bearer|api[_-]?key/i);
  });

  it("opens the CRM on its own host: crm.<domain>/prospecting, and crm.localhost in development", () => {
    expect(crmPageUrl("https://ianverlinden.com")).toBe("https://crm.ianverlinden.com/prospecting");
    expect(crmPageUrl("https://ianverlinden.com/", "/settings")).toBe("https://crm.ianverlinden.com/settings");
    expect(crmPageUrl("https://crm.ianverlinden.com")).toBe("https://crm.ianverlinden.com/prospecting");
    expect(crmPageUrl("http://localhost:3000")).toBe("http://crm.localhost:3000/prospecting");
    expect(crmPageUrl("nonsense")).toBe("https://crm.ianverlinden.com/prospecting");
  });
});

/* --------------------------------------- crash recovery --------------------------------------- */

describe("crash recovery: no zombie Codex", () => {
  it("ends a recorded child only when its owner is gone AND it is the same process (creation time), never on a recycled id", () => {
    const entry = { pid: 100, parentPid: 50, startedAt: 1_000_000 };
    expect(shouldReap(entry, { ownerAlive: false, createdAt: 1_000_400 })).toBe(true);
    expect(shouldReap(entry, { ownerAlive: true, createdAt: 1_000_400 })).toBe(false);
    expect(shouldReap(entry, { ownerAlive: false, createdAt: 9_999_999 })).toBe(false); // a different process reused the id
    expect(shouldReap(entry, { ownerAlive: false, createdAt: null })).toBe(false);
  });

  it("reaps the orphans of a crashed parent and forgets them; leaves live ones and its own", () => {
    const h = home();
    writeFileSync(join(h, "children.json"), JSON.stringify([{ pid: 100, parentPid: 50, startedAt: 5000 }, { pid: 101, parentPid: 51, startedAt: 5000 }, { pid: 102, parentPid: 52, startedAt: 5000 }, { pid: 103, parentPid: process.pid, startedAt: 5000 }]));
    const killed: number[] = [];
    const ended = reapOrphans({ home: h, isAlive: (pid) => new Set([100, 101, 103, 51]).has(pid), createdAt: (pid) => (pid === 100 ? 5100 : 777), kill: (pid) => void killed.push(pid) });
    expect(ended).toBe(1);
    expect(killed).toEqual([100]);
    const left = readChildren(h).map((e) => e.pid);
    expect(left).toContain(103);
    expect(left).toContain(101); // owner alive: kept
    expect(left).not.toContain(100);
    expect(left).not.toContain(102); // already gone
  });

  it("registers a real child while it runs and forgets it afterwards; aborting kills it (real process)", async () => {
    const h = home();
    const saved = process.env.PROSPECT_AGENT_HOME;
    process.env.PROSPECT_AGENT_HOME = h;
    try {
      const ctrl = new AbortController();
      const run = runProcess(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { cwd: h, stdin: "", timeoutMs: 60_000, maxBytes: 1000, signal: ctrl.signal });
      await wf(() => expect(readChildren(h)).toHaveLength(1));
      expect(readChildren(h)[0]).toMatchObject({ parentPid: process.pid });
      ctrl.abort();
      const r = await run;
      expect(r.aborted).toBe(true);
      expect(readChildren(h)).toHaveLength(0);
      registerChild(4321, h);
      unregisterChild(4321, h);
      expect(readChildren(h)).toHaveLength(0);
    } finally {
      if (saved === undefined) delete process.env.PROSPECT_AGENT_HOME;
      else process.env.PROSPECT_AGENT_HOME = saved;
    }
  }, 40_000);
});

describe("the CLI still exists and its entry points are intact", () => {
  it("package.json keeps the prospect-agent script, and cli.ts still handles start, status, doctor, test-codex and update-business-data", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["prospect-agent"]).toContain("tools/prospect-agent/src/cli.ts");
    const cli = readFileSync(join(process.cwd(), "tools", "prospect-agent", "src", "cli.ts"), "utf8");
    for (const cmd of ["start", "status", "doctor", "test-codex", "update-business-data"]) expect(cli).toContain(`cmd === "${cmd}"`);
    // The CLI must not carry worker logic of its own any more: it goes through the service.
    expect(cli).not.toContain("startWorker");
    expect(cli).toContain("ProspectAgentService");
  });
});
