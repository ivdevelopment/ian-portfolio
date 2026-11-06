import { join } from "node:path";
import { rmSync } from "node:fs";
import type { BusinessSource } from "../../../src/lib/prospecting/providers/types";
import { AgentApi, type Counters } from "./api-client";
import { reapOrphans } from "./children";
import { diagnose, execStructured, KIND_MESSAGES, resolveExecutableCached, runProcess, supportedFlags, type CodexState, type FailureKind, type ProcRunner } from "./codex";
import { TEST_SCHEMA } from "./codex-provider";
import { loadConfig, type AgentConfig } from "./config";
import { acquireLock, type LockResult } from "./lock";
import { createLogger, redact, type Logger } from "./logger";
import { businessDataStatus, statusLine, updateBusinessData, type BusinessDataStatus, type UpdateDeps, type UpdateResult, type UpdateStage } from "./osm/data-manager";
import { agentHome } from "./paths";
import { loadToken, tokenExists } from "./secret-store";
import { AGENT_VERSION } from "./version";
import { startWorker, type WorkerDeps, type WorkerHandle, type WorkerHooks } from "./worker";

/**
 * ProspectAgentService: the single implementation of "run the agent". The command line (`prospect-agent start|status|doctor|test-codex|
 * update-business-data`) and the Windows tray application both call it; neither contains worker logic of its own. The service owns the worker
 * loop (worker.ts, unchanged in behaviour), the one-worker-per-user lock, the state a UI shows, and the three on-demand actions.
 *
 * Everything a UI needs is in `getState()`: plain, JSON-safe data. It never contains the connection token, Codex credentials, request bodies,
 * candidate details or filesystem paths (paths appear only in `diagnostics()`).
 */

export type WorkerState = "stopped" | "starting" | "running" | "stopping" | "error";
export type CrmState = "unknown" | "connected" | "offline" | "rejected";
export type CodexReadiness = "unknown" | CodexState | "usage_limit";
export type ServiceErrorKind = "not_configured" | "already_running_elsewhere" | "crm_rejected" | "start_failed" | FailureKind;

export type ActiveRun = { id: string; mode: string; modeLabel: string; location: string; stage: string; done: number | null; total: number | null; startedAt: number };
export type UpdateProgress = { state: "idle" | "running"; stage: UpdateStage["stage"] | null; label: string; percent: number | null; bytes: number | null; total: number | null };
export type CodexTestOutcome = { state: "ready" | "sign_in_required" | "not_installed" | "usage_limit" | "failed"; message: string; version: string | null; ms: number | null };

export type AgentSnapshot = {
  agentVersion: string;
  worker: WorkerState;
  setup: { configured: boolean; crmHost: string };
  crm: { state: CrmState; device: string | null; lastHeartbeat: number | null };
  codex: { state: CodexReadiness; version: string | null; note: string | null; checkedAt: number | null; pausedUntil: number | null };
  businessData: { ready: boolean; source: string; dataDate: string | null; ageDays: number | null; freshness: BusinessDataStatus["freshness"]; businesses: number; health: "ok" | "aging" | "stale" | "missing" };
  activeRun: ActiveRun | null;
  lastRun: { finishedAt: number; status: string; candidates: number; kind: FailureKind | null } | null;
  lastError: { kind: ServiceErrorKind; message: string; at: number } | null;
  tasks: { codexTest: { state: "idle" | "running"; result: CodexTestOutcome | null }; businessUpdate: UpdateProgress };
};

export type ServiceEvent =
  | { type: "run_finished"; status: string; candidates: number; kind: FailureKind | null; message: string | null }
  | { type: "worker_stopped"; reason: "stopped" | "unauthorized" };

export type ServiceDeps = {
  home?: string;
  loadConfig?: () => AgentConfig;
  loadToken?: () => Promise<string | null>;
  createApi?: (base: string, token: string) => AgentApi;
  runner?: ProcRunner;
  source?: BusinessSource;
  log?: Logger;
  now?: () => number;
  /** Replaced by tests; the desktop app runs the (blocking) index build off the main thread. */
  updateBusinessData?: (deps: UpdateDeps) => Promise<UpdateResult>;
  workerOverrides?: Partial<WorkerDeps>;
  /** Who is starting the worker, for the lock ("cli" or "desktop"). */
  owner?: string;
  /** Tests only: do not take the one-worker lock or look for orphaned processes. */
  noLock?: boolean;
  startTimeoutMs?: number;
};

export const MODE_LABELS: Record<string, string> = { mail: "Mail Assistant", quick: "Quick Find", deep: "Deep Find", redesign: "Website Redesign", no_website: "No Website", web_app: "Web App", industry: "Industry Hunt" };

const UPDATE_LABELS: Record<UpdateStage["stage"], string> = {
  checking: "Checking current data…",
  verifying: "Verifying checksum…",
  downloading: "Downloading Belgium OSM…",
  building: "Building index…",
  installing: "Installing the new index…",
  done: "Ready",
};

/** The CRM page for a path: the CRM lives on its own host (crm.<domain>); local development uses crm.localhost. */
export function crmPageUrl(crmUrl: string, path = "/prospecting"): string {
  try {
    const u = new URL(crmUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.hostname.endsWith(".localhost");
    const host = local ? `crm.localhost${u.port ? `:${u.port}` : ""}` : u.hostname.startsWith("crm.") ? u.host : `crm.${u.host.replace(/^www\./, "")}`;
    return `${local ? "http" : "https"}://${host}${path}`;
  } catch {
    return `https://crm.ianverlinden.com${path}`;
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

function healthOf(bd: BusinessDataStatus): AgentSnapshot["businessData"]["health"] {
  if (!bd.indexReady) return "missing";
  return bd.freshness === "stale" ? "stale" : bd.freshness === "aging" ? "aging" : "ok";
}

export type Overall = { level: "green" | "amber" | "red" | "gray"; label: string; detail: string };

/**
 * The one-line status for the tray icon and the window. Colour is never the only signal: every state has its own words.
 * Green: running and everything is ready. Amber: partly ready, starting, stopping or setup needed. Red: an error. Gray: stopped.
 */
export function deriveOverall(s: AgentSnapshot): Overall {
  if (s.worker === "starting") return { level: "amber", label: "Starting…", detail: "Checking the connection, Codex and business data." };
  if (s.worker === "stopping") return { level: "amber", label: "Stopping…", detail: "Finishing the current step." };
  if (s.worker === "error") return { level: "red", label: "Error", detail: s.lastError?.message ?? "The agent stopped with an error." };
  if (s.worker === "stopped") {
    if (!s.setup.configured) return { level: "amber", label: "Setup required", detail: "Connect this device from CRM Settings." };
    return { level: "gray", label: "Stopped", detail: "The agent is not running." };
  }
  if (s.crm.state === "rejected") return { level: "red", label: "Error", detail: "The CRM rejected this device. It may have been revoked." };
  if (s.crm.state === "offline") return { level: "amber", label: "Offline — retrying", detail: "The CRM cannot be reached. The agent keeps trying." };
  const missing: string[] = [];
  if (s.codex.state === "usage_limit") missing.push("Codex usage limit reached");
  else if (s.codex.state !== "ready" && s.codex.state !== "unknown") missing.push(s.codex.state === "not_authenticated" ? "Codex sign-in required" : s.codex.state === "not_installed" ? "Codex not installed" : "Codex not ready");
  if (!s.businessData.ready) missing.push("Business data missing");
  if (missing.length > 0) return { level: "amber", label: s.codex.state === "usage_limit" ? "Codex usage limit reached" : "Partly ready", detail: missing.join(" · ") };
  if (s.crm.state === "unknown") return { level: "amber", label: "Connecting…", detail: "Waiting for the first answer from the CRM." };
  return { level: "green", label: "Connected", detail: s.activeRun ? "A prospecting run is in progress." : "Ready for prospecting runs." };
}

const initial = (home: string): AgentSnapshot => ({
  agentVersion: AGENT_VERSION,
  worker: "stopped",
  setup: { configured: tokenExists(home), crmHost: "" },
  crm: { state: "unknown", device: null, lastHeartbeat: null },
  codex: { state: "unknown", version: null, note: null, checkedAt: null, pausedUntil: null },
  businessData: { ready: false, source: "Geofabrik Belgium", dataDate: null, ageDays: null, freshness: "unknown", businesses: 0, health: "missing" },
  activeRun: null,
  lastRun: null,
  lastError: null,
  tasks: { codexTest: { state: "idle", result: null }, businessUpdate: { state: "idle", stage: null, label: "", percent: null, bytes: null, total: null } },
});

export type StartResult = { ok: true } | { ok: false; reason: "already_running" | "not_configured" | "locked" | "error"; message: string };
/** ask: refuse while a run is active (the caller confirms with the person). graceful: let the current step finish. force: end Codex now. */
export type StopMode = "ask" | "graceful" | "force";
export type StopResult = { ok: true } | { ok: false; reason: "run_active"; message: string };
export type DoctorReport = {
  codex: { state: CodexState; version: string | null; note: string | null; executable: string | null };
  businessData: BusinessDataStatus;
  tokenStored: boolean;
  crmUrl: string;
  /** Output of `codex doctor --summary`, or null when this Codex version does not have it. */
  codexSummary: string | null;
};

type Listener = (state: AgentSnapshot) => void;
type EventListener = (event: ServiceEvent) => void;

export class ProspectAgentService {
  private s: AgentSnapshot;
  private handle: WorkerHandle | null = null;
  private lock: LockResult | null = null;
  private starting: Promise<StartResult> | null = null;
  private stopping: Promise<StopResult> | null = null;
  private ended: Promise<void> | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly home: string;
  private readonly cfg: () => AgentConfig;

  constructor(private readonly deps: ServiceDeps = {}) {
    this.home = deps.home ?? agentHome();
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? createLogger();
    this.cfg = deps.loadConfig ?? (() => loadConfig(this.home));
    this.s = initial(this.home);
    this.s.setup.crmHost = hostOf(this.cfg().crmUrl);
    this.refreshBusinessData();
  }

  /* ------------------------------------- observing ------------------------------------- */

  getState(): AgentSnapshot {
    return structuredClone(this.s);
  }

  onState(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onEvent(fn: EventListener): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const fn of this.listeners) {
      try {
        fn(snapshot);
      } catch {
        /* a listener must never break the service */
      }
    }
  }

  private event(e: ServiceEvent): void {
    for (const fn of this.eventListeners) {
      try {
        fn(e);
      } catch {
        /* ignore */
      }
    }
  }

  private patch(change: (s: AgentSnapshot) => void): void {
    change(this.s);
    this.emit();
  }

  private setError(kind: ServiceErrorKind, message: string): void {
    this.s.lastError = { kind, message, at: this.now() };
  }

  /** The crm/codex/business-data fields can be re-read at any time; nothing here touches the network except the Codex check. */
  refreshBusinessData(): void {
    const bd = businessDataStatus(this.home, this.now());
    this.patch((s) => {
      s.businessData = { ready: bd.indexReady, source: bd.source, dataDate: bd.dataDate, ageDays: bd.ageDays, freshness: bd.freshness, businesses: bd.businesses, health: healthOf(bd) };
      s.setup.configured = tokenExists(this.home);
      s.setup.crmHost = hostOf(this.cfg().crmUrl);
    });
  }

  /** Re-check Codex (version, flags, ChatGPT sign-in). Only used while the worker is stopped: a running worker re-checks by itself. */
  async refresh(): Promise<AgentSnapshot> {
    this.refreshBusinessData();
    if (this.s.worker === "stopped" || this.s.worker === "error") {
      const d = await diagnose(this.cfg().codexBin, this.deps.runner);
      this.patch((s) => {
        s.codex = { ...s.codex, state: d.state, version: d.version, note: d.note, checkedAt: this.now() };
      });
    }
    return this.getState();
  }

  /* --------------------------------------- start ---------------------------------------- */

  start(): Promise<StartResult> {
    if (this.starting) return this.starting;
    if (this.s.worker !== "stopped" && this.s.worker !== "error") return Promise.resolve({ ok: false, reason: "already_running", message: "The agent is already running." });
    // Set synchronously so a double click cannot start two workers.
    this.s.worker = "starting";
    this.s.lastError = null;
    this.emit();
    const p = this.doStart().finally(() => {
      this.starting = null;
    });
    this.starting = p;
    return p;
  }

  private async doStart(): Promise<StartResult> {
    const fail = (reason: Exclude<StartResult, { ok: true }>["reason"], kind: ServiceErrorKind, message: string, worker: WorkerState = "stopped"): StartResult => {
      this.patch((s) => {
        s.worker = worker;
        this.setError(kind, message);
      });
      return { ok: false, reason, message };
    };
    try {
      const config = this.cfg();
      const token = await (this.deps.loadToken ?? (() => loadToken(this.home)))();
      if (!token) return fail("not_configured", "not_configured", "This device is not connected yet. Connect it from CRM Settings.");
      if (!this.deps.noLock) {
        const lock = acquireLock(this.deps.owner ?? "agent", { home: this.home });
        if (!lock.ok) return fail("locked", "already_running_elsewhere", "The agent is already running on this PC (from the command line or another window). Stop it there first.");
        this.lock = lock;
        const ended = reapOrphans({ home: this.home });
        if (ended > 0) this.log.warn("ended Codex processes left behind by an earlier crash", { count: ended });
      }
      this.refreshBusinessData();
      const bd = businessDataStatus(this.home, this.now());
      this.log.info("business data", { ready: bd.indexReady, source: bd.source, dataDate: bd.dataDate ?? "", businesses: bd.businesses, freshness: bd.freshness });
      if (!bd.indexReady && !this.deps.source) this.log.warn(statusLine(bd));
      this.log.info("agent starting", { crm: config.crmUrl, codex: config.codexBin, model: config.model ?? "default", version: AGENT_VERSION });
      const api = (this.deps.createApi ?? ((b, t) => new AgentApi(b, t)))(config.crmUrl, token);

      let firstBeat!: () => void;
      const beat = new Promise<void>((r) => (firstBeat = r));
      const hooks = this.hooks(firstBeat);
      const handle = startWorker({ api, config, log: this.log, runner: this.deps.runner, source: this.deps.source, home: this.home, hooks, ...this.deps.workerOverrides });
      this.handle = handle;
      this.ended = handle.done.then(
        (reason) => this.onWorkerEnded(reason),
        (e) => this.onWorkerCrashed(e),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([beat, this.ended, new Promise<void>((r) => (timer = setTimeout(r, this.deps.startTimeoutMs ?? 30_000)))]);
      if (timer) clearTimeout(timer);
      if (this.handle === handle && this.s.worker === "starting") this.patch((s) => (s.worker = "running"));
      return { ok: true };
    } catch (e) {
      this.log.error("agent could not start", { error: e instanceof Error ? e.constructor.name : "error" });
      this.releaseLock();
      return fail("error", "start_failed", "The agent could not start.", "error");
    }
  }

  private releaseLock(): void {
    if (this.lock?.ok) this.lock.release();
    this.lock = null;
  }

  private onWorkerEnded(reason: "stopped" | "unauthorized"): void {
    this.handle = null;
    this.releaseLock();
    this.log.info("agent stopped", { reason });
    this.patch((s) => {
      s.activeRun = null;
      s.codex.pausedUntil = null;
      if (reason === "unauthorized") {
        s.worker = "error";
        s.crm.state = "rejected";
        this.setError("crm_rejected", "The CRM rejected this device. It may have been revoked: connect it again from CRM Settings.");
      } else {
        s.worker = "stopped";
        s.crm.state = "unknown";
      }
    });
    this.event({ type: "worker_stopped", reason });
  }

  private onWorkerCrashed(e: unknown): void {
    this.handle = null;
    this.releaseLock();
    this.log.error("agent crashed", { error: e instanceof Error ? e.constructor.name : "error" });
    this.patch((s) => {
      s.activeRun = null;
      s.worker = "error";
      this.setError("start_failed", "The agent stopped with an error.");
    });
  }

  private hooks(firstBeat: () => void): WorkerHooks {
    // A heartbeat or claim that was still in flight when the worker stopped can answer afterwards; it must not bring the old state back.
    const live = () => this.handle !== null;
    return {
      onDiagnostics: (d) =>
        live() &&
        this.patch((s) => {
          s.codex = { ...s.codex, state: s.codex.state === "usage_limit" && d.state === "ready" ? "usage_limit" : d.state, version: d.version, note: d.note, checkedAt: this.now() };
        }),
      onHeartbeat: (o) => {
        if (!live()) return;
        this.patch((s) => {
          if (o.ok) {
            s.crm = { state: "connected", device: o.device, lastHeartbeat: this.now() };
            if (s.lastError?.kind === "start_failed") s.lastError = null;
          } else if (o.kind === "unauthorized") s.crm.state = "rejected";
          else s.crm.state = "offline";
        });
        firstBeat();
      },
      onClaim: (o) =>
        live() &&
        this.patch((s) => {
          if (o.ok && s.crm.state !== "rejected") s.crm.state = "connected";
          else if (!o.ok && o.kind !== "unauthorized") s.crm.state = "offline";
        }),
      onRunStart: (run) =>
        this.patch((s) => {
          s.activeRun = { id: run.id, mode: run.mode, modeLabel: MODE_LABELS[run.mode] ?? "Prospect search", location: run.location, stage: "Picked up", done: null, total: null, startedAt: this.now() };
        }),
      onRunProgress: (_run, p) =>
        this.patch((s) => {
          if (!s.activeRun) return;
          s.activeRun.stage = p.stage;
          const { done, total } = progressOf(p.stage, p.counters);
          s.activeRun.done = done;
          s.activeRun.total = total;
        }),
      onRunEnd: (_run, summary) => {
        const message = summary.kind ? KIND_MESSAGES[summary.kind] : null;
        this.patch((s) => {
          s.activeRun = null;
          s.lastRun = { finishedAt: this.now(), status: summary.status, candidates: summary.candidates, kind: summary.kind };
          if (summary.kind === "codex_usage_limit") s.codex.state = "usage_limit";
          if (summary.status === "failed" && summary.kind) this.setError(summary.kind, KIND_MESSAGES[summary.kind]);
        });
        if (summary.status !== "cancelled" && summary.status !== "abandoned") this.event({ type: "run_finished", status: summary.status, candidates: summary.candidates, kind: summary.kind, message });
      },
      onMailStart: (jobId) =>
        this.patch((s) => {
          s.activeRun = { id: jobId, mode: "mail", modeLabel: MODE_LABELS.mail, location: "", stage: "Generating draft…", done: null, total: null, startedAt: this.now() };
        }),
      onMailEnd: (_jobId, summary) =>
        this.patch((s) => {
          s.activeRun = null;
          if (summary.kind === "codex_usage_limit") s.codex.state = "usage_limit";
        }),
      onPause: (until) =>
        this.patch((s) => {
          s.codex.pausedUntil = until;
          if (until === null && s.codex.state === "usage_limit") s.codex.state = "unknown";
        }),
    };
  }

  /* ---------------------------------------- stop ---------------------------------------- */

  /**
   * Stops the worker. While a run is in progress nothing is killed silently: in mode "ask" the answer is `run_active` and the caller asks the
   * person. "graceful" lets the run stop between steps; "force" ends the running Codex process and the run is reported to the CRM as cancelled,
   * keeping what it had found.
   */
  stop(opts: { mode?: StopMode } = {}): Promise<StopResult> {
    if (this.stopping) return this.stopping;
    const p = this.doStop(opts).finally(() => {
      this.stopping = null;
    });
    this.stopping = p;
    return p;
  }

  private async doStop(opts: { mode?: StopMode }): Promise<StopResult> {
    const mode = opts.mode ?? "ask";
    if (this.starting) await this.starting;
    const handle = this.handle;
    if (!handle || (this.s.worker !== "running" && this.s.worker !== "starting")) return { ok: true };
    if (this.s.activeRun && mode === "ask") return { ok: false, reason: "run_active", message: "A prospecting run is currently active. Stopping now may interrupt it." };
    this.patch((s) => (s.worker = "stopping"));
    if (mode === "force") handle.abortRun();
    handle.stop();
    await this.ended;
    return { ok: true };
  }

  /** The app is closing: stop and wait, ending any run (the CRM is told it was cancelled). Never throws. */
  async shutdown(): Promise<void> {
    try {
      await this.stop({ mode: "force" });
    } catch {
      /* closing anyway */
    }
  }

  /* --------------------------------------- Codex ---------------------------------------- */

  async testCodex(): Promise<CodexTestOutcome> {
    if (this.s.tasks.codexTest.state === "running") return this.s.tasks.codexTest.result ?? { state: "failed", message: "A test is already running.", version: null, ms: null };
    this.patch((s) => (s.tasks.codexTest = { state: "running", result: null }));
    const finish = (result: CodexTestOutcome, codex?: Partial<AgentSnapshot["codex"]>) => {
      this.patch((s) => {
        s.tasks.codexTest = { state: "idle", result };
        if (codex) s.codex = { ...s.codex, ...codex, checkedAt: this.now() };
      });
      return result;
    };
    const config = this.cfg();
    let dir: string | null = null;
    try {
      const d = await diagnose(config.codexBin, this.deps.runner);
      if (d.state === "not_installed") return finish({ state: "not_installed", message: "Codex not installed", version: null, ms: null }, { state: "not_installed", version: null, note: d.note });
      if (d.state === "not_authenticated") return finish({ state: "sign_in_required", message: "Codex sign-in required", version: d.version, ms: null }, { state: "not_authenticated", version: d.version, note: d.note });
      if (d.state !== "ready") return finish({ state: "failed", message: d.note ?? "Test failed", version: d.version, ms: null }, { state: "error", version: d.version, note: d.note });
      const flags = await supportedFlags(config.codexBin, this.deps.runner);
      dir = join(this.home, "runs", `test-${this.now()}`);
      const res = await execStructured({ bin: config.codexBin, dir, prompt: 'Return the JSON object {"ok": true}. Do not run any commands.', schema: TEST_SCHEMA as unknown as Record<string, unknown>, model: config.model, effort: "low", timeoutMs: 120_000, flags, run: this.deps.runner });
      if (res.ok && (res.value as { ok?: unknown })?.ok === true) {
        this.handle?.resume();
        return finish({ state: "ready", message: "Codex ready", version: d.version, ms: res.ms }, { state: "ready", version: d.version, note: null, pausedUntil: null });
      }
      if (res.ok) return finish({ state: "failed", message: "Test failed: Codex answered, but not with the expected structure.", version: d.version, ms: res.ms });
      if (res.kind === "codex_usage_limit") return finish({ state: "usage_limit", message: "Usage limit reached", version: d.version, ms: res.ms }, { state: "usage_limit", version: d.version });
      if (res.kind === "codex_not_authenticated") return finish({ state: "sign_in_required", message: "Codex sign-in required", version: d.version, ms: res.ms }, { state: "not_authenticated", version: d.version });
      if (res.kind === "codex_not_installed") return finish({ state: "not_installed", message: "Codex not installed", version: null, ms: res.ms }, { state: "not_installed", version: null });
      return finish({ state: "failed", message: `Test failed: ${KIND_MESSAGES[res.kind]}`, version: d.version, ms: res.ms });
    } catch {
      return finish({ state: "failed", message: "Test failed", version: null, ms: null });
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }

  /* ----------------------------------- business data ------------------------------------ */

  async updateBusinessData(opts: { force?: boolean; log?: (message: string) => void } = {}): Promise<{ ok: true; outcome: "up_to_date" | "updated"; result: UpdateResult } | { ok: false; reason: "run_active" | "already_running" | "failed"; message: string; result?: UpdateResult }> {
    if (this.s.tasks.businessUpdate.state === "running") return { ok: false, reason: "already_running", message: "The business data is already being updated." };
    if (this.s.activeRun) return { ok: false, reason: "run_active", message: "A prospecting run is in progress. Update the business data when it has finished." };
    const stage = (st: UpdateStage) =>
      this.patch((s) => {
        const u = s.tasks.businessUpdate;
        u.state = st.stage === "done" ? "idle" : "running";
        u.stage = st.stage;
        u.label = st.stage === "verifying" && st.detail === "index" ? "Verifying index…" : UPDATE_LABELS[st.stage];
        u.percent = st.stage === "building" ? Math.round(st.percent) : st.stage === "downloading" && st.total ? Math.min(100, Math.round((st.bytes / st.total) * 100)) : null;
        u.bytes = st.stage === "downloading" ? st.bytes : null;
        u.total = st.stage === "downloading" ? st.total : null;
      });
    this.patch((s) => (s.tasks.businessUpdate = { state: "running", stage: "checking", label: UPDATE_LABELS.checking, percent: null, bytes: null, total: null }));
    try {
      const run = this.deps.updateBusinessData ?? updateBusinessData;
      const res = await run({ home: this.home, force: opts.force, onStage: stage, log: (m) => {
        this.log.info("business data", { message: m });
        opts.log?.(m);
      } });
      this.refreshBusinessData();
      this.patch((s) => (s.tasks.businessUpdate = { state: "idle", stage: null, label: res.outcome === "failed" ? "Update failed" : "Ready", percent: null, bytes: null, total: null }));
      if (res.outcome === "failed") {
        this.patch(() => this.setError("source_error", "Business source update failed"));
        this.log.warn("business data update failed", { message: res.message });
        return { ok: false, reason: "failed", message: res.message, result: res };
      }
      return { ok: true, outcome: res.outcome, result: res };
    } catch (e) {
      this.patch((s) => {
        s.tasks.businessUpdate = { state: "idle", stage: null, label: "Update failed", percent: null, bytes: null, total: null };
        this.setError("source_error", "Business source update failed");
      });
      return { ok: false, reason: "failed", message: e instanceof Error ? e.message : "Update failed" };
    }
  }

  /* --------------------------------------- reports --------------------------------------- */

  async doctor(): Promise<DoctorReport> {
    const config = this.cfg();
    const d = await diagnose(config.codexBin, this.deps.runner);
    const r = await (this.deps.runner ?? runProcess)(config.codexBin, ["doctor", "--summary"], { cwd: process.cwd(), stdin: "", timeoutMs: 60_000, maxBytes: 50_000 });
    return {
      codex: { state: d.state, version: d.version, note: d.note, executable: resolveExecutableCached(config.codexBin) },
      businessData: businessDataStatus(this.home, this.now()),
      tokenStored: tokenExists(this.home),
      crmUrl: config.crmUrl,
      codexSummary: r.code === 0 ? redact(r.stdout.trim()) : null,
    };
  }

  /** Text for "Copy diagnostics": safe to paste anywhere. See formatDiagnostics. */
  diagnostics(extra: Record<string, string | null> = {}): string {
    const config = this.cfg();
    return formatDiagnostics(this.getState(), { crmEndpoint: config.crmUrl, codexExecutable: resolveExecutableCached(config.codexBin), extra });
  }
}

/** done / total for the active run, from the real counters: websites analysed out of the ones that survived the duplicate and cooldown checks. */
export function progressOf(stage: string, c: Partial<Counters>): { done: number | null; total: number | null } {
  if (!/^(Analy|Check|Qualif)/i.test(stage)) return { done: null, total: null };
  const total = Math.max(0, (c.raw_found ?? 0) - (c.duplicates_removed ?? 0) - (c.skipped_cooldown ?? 0));
  if (total === 0) return { done: null, total: null };
  return { done: Math.min(c.analyzed ?? 0, total), total };
}

const fmtTime = (ms: number | null) => (ms ? new Date(ms).toISOString() : "never");

/**
 * The diagnostics block. Whatever is passed in, it is run through `redact` (connection tokens, bearer values, API-key shapes). It is built only
 * from the snapshot (which holds no secrets) plus the Codex executable path and the CRM address, never from files or the environment.
 */
export function formatDiagnostics(s: AgentSnapshot, o: { crmEndpoint: string; codexExecutable: string | null; extra?: Record<string, string | null> }): string {
  const lines = [
    "Ian Prospect Agent diagnostics",
    `Agent version:   ${s.agentVersion}`,
    `Worker:          ${s.worker}`,
    `CRM endpoint:    ${o.crmEndpoint}`,
    `CRM:             ${s.crm.state}${s.crm.device ? ` (device "${s.crm.device}")` : ""}`,
    `Last heartbeat:  ${fmtTime(s.crm.lastHeartbeat)}`,
    `Token stored:    ${s.setup.configured ? "yes" : "no"}`,
    `Codex:           ${s.codex.state}${s.codex.version ? ` ${s.codex.version}` : ""}${s.codex.note ? ` (${s.codex.note})` : ""}`,
    `Codex executable: ${o.codexExecutable ?? "not found"}`,
    `Business data:   ${s.businessData.ready ? "ready" : "missing"} (${s.businessData.source}, health ${s.businessData.health})`,
    `Business index date: ${s.businessData.dataDate ?? "unknown"}`,
    `Business count:  ${s.businessData.businesses}`,
    `Active run:      ${s.activeRun ? `${s.activeRun.modeLabel} - ${s.activeRun.stage}` : "none"}`,
    `Last run:        ${s.lastRun ? `${s.lastRun.status}, ${s.lastRun.candidates} candidates, at ${fmtTime(s.lastRun.finishedAt)}${s.lastRun.kind ? ` (${s.lastRun.kind})` : ""}` : "none"}`,
    `Last error:      ${s.lastError ? `${s.lastError.kind}: ${s.lastError.message} (${fmtTime(s.lastError.at)})` : "none"}`,
    ...Object.entries(o.extra ?? {}).map(([k, v]) => `${k}: ${v ?? "n/a"}`),
  ];
  return redact(lines.join("\n"));
}
