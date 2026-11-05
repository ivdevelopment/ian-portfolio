import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_CONFIG } from "../tools/prospect-agent/src/config";
import { createLogger } from "../tools/prospect-agent/src/logger";
import { deriveOverall, ProspectAgentService, type AgentSnapshot } from "../tools/prospect-agent/src/service";
import { codexLoginCommand } from "../tools/prospect-agent-desktop/src/codex-login";
import { claimSingleInstance } from "../tools/prospect-agent-desktop/src/instance";
import { NotificationGate, notificationFor } from "../tools/prospect-agent-desktop/src/notify-policy";
import { applySettingChange, DEFAULT_SETTINGS, loadSettings, sanitizeBounds, saveSettings, WINDOW } from "../tools/prospect-agent-desktop/src/settings";
import { trayIconName, trayMenu, trayTooltip } from "../tools/prospect-agent-desktop/src/tray-model";

const desktop = join(process.cwd(), "tools", "prospect-agent-desktop");
const read = (...p: string[]) => readFileSync(join(desktop, ...p), "utf8");
// The view-model is plain JavaScript (it also runs in the window), so its result is deliberately loosely typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Described = Record<string, any>;
const model = createRequire(import.meta.url)(join(desktop, "renderer", "model.js")) as { describe(view: unknown, now?: number): Described };

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "pad-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const base = (over: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  ...new ProspectAgentService({ home: tmp(), log: createLogger({ file: false, sink: () => undefined }), noLock: true, loadConfig: () => DEFAULT_CONFIG }).getState(),
  setup: { configured: true, crmHost: "ianverlinden.com" },
  worker: "running",
  crm: { state: "connected", device: "Ian-PC", lastHeartbeat: 1_000_000 },
  codex: { state: "ready", version: "0.166.0", note: null, checkedAt: 1, pausedUntil: null },
  businessData: { ready: true, source: "Geofabrik Belgium", dataDate: "2026-11-05T21:21:00Z", ageDays: 0, freshness: "fresh", businesses: 116078, health: "ok" },
  ...over,
});
const view = (s: AgentSnapshot, settings = DEFAULT_SETTINGS, extra: Record<string, unknown> = {}) => ({ snapshot: s, overall: deriveOverall(s), settings, autostartAvailable: true, autostartActual: false, diagnostics: "", ...extra });

/* ------------------------------------------ settings ------------------------------------------ */

describe("desktop settings", () => {
  it("both start-up choices are OFF by default, and they are two separate switches", () => {
    expect(DEFAULT_SETTINGS).toEqual({ startAppWithWindows: false, startAgentAutomatically: false, bounds: null });
    expect(loadSettings(tmp())).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips, survives a broken file, and keeps only booleans for the switches", () => {
    const h = tmp();
    saveSettings(h, { startAppWithWindows: true, startAgentAutomatically: false, bounds: { x: 10, y: 20, width: 460, height: 680 } });
    expect(loadSettings(h)).toEqual({ startAppWithWindows: true, startAgentAutomatically: false, bounds: { x: 10, y: 20, width: 460, height: 680 } });
    writeFileSync(join(h, "desktop", "settings.json"), "{ not json");
    expect(loadSettings(h)).toEqual(DEFAULT_SETTINGS);
    writeFileSync(join(h, "desktop", "settings.json"), JSON.stringify({ startAppWithWindows: "yes", startAgentAutomatically: 1 }));
    expect(loadSettings(h)).toMatchObject({ startAppWithWindows: false, startAgentAutomatically: false });
  });

  it("the window can change only the two known switches, only to a boolean", () => {
    expect(applySettingChange(DEFAULT_SETTINGS, "startAgentAutomatically", true)).toMatchObject({ startAgentAutomatically: true, startAppWithWindows: false });
    expect(applySettingChange(DEFAULT_SETTINGS, "bounds", true)).toBeNull();
    expect(applySettingChange(DEFAULT_SETTINGS, "startAppWithWindows", "true")).toBeNull();
    expect(applySettingChange(DEFAULT_SETTINGS, "__proto__", true)).toBeNull();
  });

  it("a remembered window position is used only if it is still on a connected display and a sane size", () => {
    const screen = [{ x: 0, y: 0, width: 1920, height: 1040 }];
    expect(sanitizeBounds({ x: 100, y: 100, width: 460, height: 680 }, screen)).toEqual({ x: 100, y: 100, width: 460, height: 680 });
    expect(sanitizeBounds({ x: 5000, y: 100, width: 460, height: 680 }, screen)).toBeNull(); // that monitor is gone
    expect(sanitizeBounds({ x: 100, y: 100, width: 5000, height: 10 }, screen)).toMatchObject({ width: WINDOW.maxWidth, height: WINDOW.minHeight });
    expect(sanitizeBounds({ x: "a", y: 1, width: 1, height: 1 }, screen)).toBeNull();
    expect(sanitizeBounds(null, screen)).toBeNull();
    expect(WINDOW.width).toBeGreaterThanOrEqual(420);
    expect(WINDOW.width).toBeLessThanOrEqual(500);
  });
});

/* -------------------------------------------- tray -------------------------------------------- */

describe("system tray", () => {
  it("has exactly the menu that was asked for, in order", () => {
    const s = base();
    const labels = trayMenu(s, deriveOverall(s)).map((m) => (m.separator ? "—" : m.label));
    expect(labels).toEqual(["Ian Prospect Agent", "Status: Connected", "—", "Open", "Start Agent", "Stop Agent", "Open CRM", "—", "Exit"]);
  });

  it("Start is available only when stopped and set up; Stop only when running; the header lines are not clickable", () => {
    const item = (s: AgentSnapshot, id: string) => trayMenu(s, deriveOverall(s)).find((m) => m.id === id)!;
    expect(item(base({ worker: "running" }), "start").enabled).toBe(false);
    expect(item(base({ worker: "running" }), "stop").enabled).toBe(true);
    expect(item(base({ worker: "stopped" }), "start").enabled).toBe(true);
    expect(item(base({ worker: "stopped" }), "stop").enabled).toBe(false);
    expect(item(base({ worker: "starting" }), "start").enabled).toBe(false);
    expect(item(base({ worker: "starting" }), "stop").enabled).toBe(false);
    expect(item(base({ worker: "stopped", setup: { configured: false, crmHost: "" } }), "start").enabled).toBe(false);
    expect(item(base({ worker: "error" }), "start").enabled).toBe(true);
    const s = base();
    expect(trayMenu(s, deriveOverall(s)).slice(0, 2).every((m) => m.enabled === false)).toBe(true);
  });

  it("the icon follows green / amber / red / gray, and the tooltip carries the words as well", () => {
    expect(trayIconName(deriveOverall(base()))).toBe("tray-green");
    expect(trayIconName(deriveOverall(base({ businessData: { ...base().businessData, ready: false, health: "missing" } })))).toBe("tray-amber");
    expect(trayIconName(deriveOverall(base({ worker: "error" })))).toBe("tray-red");
    expect(trayIconName(deriveOverall(base({ worker: "stopped" })))).toBe("tray-gray");
    expect(trayTooltip(deriveOverall(base()))).toBe("Ian Prospect Agent — Connected");
    expect(trayTooltip(deriveOverall(base({ crm: { state: "offline", device: null, lastHeartbeat: null } })))).toBe("Ian Prospect Agent — Offline — retrying");
  });
});

/* ----------------------------------------- notifications ----------------------------------------- */

describe("notifications", () => {
  it("only a finished or failed search and a rejected device are announced, in fixed words", () => {
    expect(notificationFor({ type: "run_finished", status: "completed", candidates: 5, kind: null, message: null })).toMatchObject({ title: "Prospect search completed", body: "5 candidates ready for review", action: "open_crm" });
    expect(notificationFor({ type: "run_finished", status: "completed", candidates: 1, kind: null, message: null })?.body).toBe("1 candidate ready for review");
    expect(notificationFor({ type: "run_finished", status: "completed", candidates: 0, kind: null, message: null })?.body).toBe("No new candidates this time.");
    expect(notificationFor({ type: "run_finished", status: "failed", candidates: 0, kind: "codex_usage_limit", message: "x" })).toMatchObject({ title: "Prospect search failed", body: "Open the agent for details.", action: "open_window" });
    expect(notificationFor({ type: "worker_stopped", reason: "unauthorized" })).toMatchObject({ title: "Agent disconnected" });
  });

  it("never announces a stop the person asked for, a cancelled run, or anything routine", () => {
    expect(notificationFor({ type: "worker_stopped", reason: "stopped" })).toBeNull();
    expect(notificationFor({ type: "run_finished", status: "cancelled", candidates: 2, kind: null, message: null })).toBeNull();
    expect(notificationFor({ type: "run_finished", status: "abandoned", candidates: 0, kind: null, message: null })).toBeNull();
  });

  it("is rate limited: one of each kind per 30 s, one of any kind per 5 s", () => {
    const g = new NotificationGate();
    expect(g.allow("run_done", 100_000)).toBe(true);
    expect(g.allow("run_done", 101_000)).toBe(false);
    expect(g.allow("run_failed", 102_000)).toBe(false); // any-kind spacing
    expect(g.allow("run_failed", 106_000)).toBe(true);
    expect(g.allow("run_done", 131_000)).toBe(true);
  });
});

/* ------------------------------------------ single instance ------------------------------------------ */

describe("single instance", () => {
  const fakeApp = (lock: boolean) => {
    const handlers: Array<() => void> = [];
    return { app: { requestSingleInstanceLock: () => lock, on: (_e: "second-instance", fn: () => void) => void handlers.push(fn), quit: vi.fn() }, handlers };
  };

  it("the first instance carries on and is told when a second one is started (to show its window)", () => {
    const { app, handlers } = fakeApp(true);
    const show = vi.fn();
    expect(claimSingleInstance(app, show)).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    handlers[0]();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("a second instance quits at once, without registering anything: no second app, no second worker", () => {
    const { app, handlers } = fakeApp(false);
    const show = vi.fn();
    expect(claimSingleInstance(app, show)).toBe(false);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(handlers).toHaveLength(0);
  });
});

/* ------------------------------------------- Codex login ------------------------------------------- */

describe("Open Codex Login", () => {
  it("opens a visible terminal running `codex login`, quoting a path with spaces", () => {
    const c = codexLoginCommand("C:\\Users\\ianve\\AppData\\Roaming\\npm\\codex.cmd", "cmd.exe")!;
    expect(c.cmd).toBe("cmd.exe");
    expect(c.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(c.args[3]).toBe('"start "Codex sign-in" cmd.exe /d /k "C:\\Users\\ianve\\AppData\\Roaming\\npm\\codex.cmd login""');
    expect(codexLoginCommand("C:\\Program Files\\Codex\\codex.exe")!.args[3]).toContain('"C:\\Program Files\\Codex\\codex.exe" login');
  });

  it("refuses an unknown path or one with shell metacharacters, and never builds a command from user text", () => {
    expect(codexLoginCommand(null)).toBeNull();
    for (const bad of ['C:\\x\\codex.cmd" & calc', "C:\\x\\a%PATH%.cmd", "C:\\x\\a^b.cmd", "C:\\x\\a|b.cmd", "C:\\x\\a\nb.cmd"]) expect(codexLoginCommand(bad), bad).toBeNull();
  });
});

/* ---------------------------------------------- the window ---------------------------------------------- */

describe("status window content", () => {
  const d = (s: AgentSnapshot, settings = DEFAULT_SETTINGS, now = 1_012_000) => model.describe(view(s, settings), now);

  it("shows the suggested layout: status, CRM, Codex with version, business data with date and count, worker", () => {
    const m = d(base());
    expect(m).toMatchObject({ headline: "Connected", level: "green", setupRequired: false });
    expect(m.crm).toMatchObject({ text: "Connected", tone: "ok", sub: "Last heartbeat 12 s ago" });
    expect(m.codex).toMatchObject({ text: "Ready · 0.166.0", tone: "ok" });
    expect(m.data).toMatchObject({ title: "Belgium OSM", lines: ["Updated: 5 Nov 2026", "116,078 businesses"], health: "Index health: OK" });
    expect(m.worker).toMatchObject({ text: "Running", tone: "ok" });
  });

  it("start/stop buttons follow the worker state and cannot be double-clicked while starting or stopping", () => {
    expect(d(base({ worker: "stopped" })).buttons).toMatchObject({ start: { label: "Start Agent", disabled: false }, stop: { disabled: true } });
    expect(d(base({ worker: "starting" })).buttons).toMatchObject({ start: { label: "Starting…", disabled: true }, stop: { disabled: true }, test: { disabled: true } });
    expect(d(base({ worker: "running" })).buttons).toMatchObject({ start: { disabled: true }, stop: { label: "Stop Agent", disabled: false } });
    expect(d(base({ worker: "stopping" })).buttons).toMatchObject({ stop: { label: "Stopping…", disabled: true } });
    expect(d(base({ worker: "stopped", setup: { configured: false, crmHost: "" } })).buttons.start.disabled).toBe(true);
  });

  it("first-time state: setup required, with the three steps' actions available", () => {
    const m = d(base({ worker: "stopped", setup: { configured: false, crmHost: "" }, businessData: { ...base().businessData, ready: false, health: "missing", businesses: 0, dataDate: null } }));
    expect(m.setupRequired).toBe(true);
    expect(m.headline).toBe("Setup required");
    expect(m.data).toMatchObject({ title: "Not installed", installed: false });
    expect(read("renderer", "index.html")).toMatch(/Connect this device from CRM Settings[\s\S]*Sign in to Codex with ChatGPT[\s\S]*Install business data/);
  });

  it("CRM and Codex are reported separately: CRM offline does not say Codex is down, and the other way round", () => {
    const off = d(base({ crm: { state: "offline", device: null, lastHeartbeat: null } }));
    expect(off.crm).toMatchObject({ text: "Offline", sub: "Retrying…", tone: "warn" });
    expect(off.codex.text).toBe("Ready · 0.166.0");
    const noCodex = d(base({ codex: { state: "not_authenticated", version: "0.166.0", note: null, checkedAt: 1, pausedUntil: null } }));
    expect(noCodex.crm.text).toBe("Connected");
    expect(noCodex.codex).toMatchObject({ text: "Sign-in required", login: true });
    expect(d(base({ codex: { state: "not_installed", version: null, note: null, checkedAt: 1, pausedUntil: null } })).codex.text).toBe("Not installed");
    expect(d(base({ codex: { state: "usage_limit", version: "0.166.0", note: null, checkedAt: 1, pausedUntil: 9 } })).codex).toMatchObject({ text: "Usage limit reached", sub: "Try again when your ChatGPT allowance resets." });
    expect(d(base({ crm: { state: "rejected", device: null, lastHeartbeat: null } })).crm.text).toBe("Rejected");
    expect(d(base({ worker: "stopped" })).crm).toMatchObject({ text: "Not connected" });
  });

  it("partial readiness is explicit: agent running, Business data missing", () => {
    const m = d(base({ businessData: { ...base().businessData, ready: false, health: "missing", businesses: 0, dataDate: null } }));
    expect(m).toMatchObject({ level: "amber", headline: "Partly ready", detail: "Business data missing" });
    expect(m.crm.text).toBe("Connected");
    expect(m.codex.text).toContain("Ready");
  });

  it("shows the active search with real progress and nothing about candidates", () => {
    const m = d(base({ activeRun: { id: "r", mode: "quick", modeLabel: "Quick Find", location: "Brugge", stage: "Analyzing 8 websites…", done: 3, total: 8, startedAt: 1 } }));
    expect(m.active).toEqual({ title: "Quick Find · Brugge", stage: "Analyzing 8 websites…", progressText: "3 / 8", percent: 38 });
    expect(m.buttons.update.disabled).toBe(true); // the data cannot be swapped under a running search
    expect(m.detail).toContain("in progress");
  });

  it("Test Codex shows each state in the specified words", () => {
    const t = (result: unknown, state = "idle") => d(base({ tasks: { ...base().tasks, codexTest: { state: state as "idle", result: result as never } } })).test;
    expect(t(null, "running")).toEqual({ text: "Testing…", tone: "warn" });
    expect(t({ state: "ready", message: "Codex ready", version: "0.166.0", ms: 1800 })).toEqual({ text: "Codex ready · 0.166.0 (1.8 s)", tone: "ok" });
    expect(t({ state: "sign_in_required", message: "", version: null, ms: null })?.text).toBe("Codex sign-in required");
    expect(t({ state: "not_installed", message: "", version: null, ms: null })?.text).toBe("Codex not installed");
    expect(t({ state: "usage_limit", message: "", version: null, ms: null })?.text).toBe("Usage limit reached");
    expect(t({ state: "failed", message: "", version: null, ms: null })?.text).toBe("Test failed");
    expect(d(base({ tasks: { ...base().tasks, codexTest: { state: "running", result: null } } })).buttons.test).toEqual({ label: "Testing…", disabled: true });
  });

  it("Update business data shows the real stage, and real download progress when it is known", () => {
    const u = (over: Record<string, unknown>) => d(base({ tasks: { ...base().tasks, businessUpdate: { state: "running", stage: "downloading", label: "Downloading Belgium OSM…", percent: 25, bytes: 175e6, total: 700e6, ...over } as never } })).update;
    expect(u({})).toEqual({ visible: true, label: "Downloading Belgium OSM…", percent: 25, detail: "175 MB of 700 MB" });
    expect(u({ stage: "building", label: "Building index…", percent: 60, bytes: null, total: null })).toMatchObject({ label: "Building index…", percent: 60, detail: null });
    expect(u({ stage: "verifying", label: "Verifying checksum…", percent: null, bytes: null, total: null }).percent).toBeNull(); // unknown: shown as an indeterminate bar, never a fake number
    expect(d(base()).update.visible).toBe(false);
    expect(d(base({ tasks: { ...base().tasks, businessUpdate: { state: "idle", stage: null, label: "Update failed", percent: null, bytes: null, total: null } } })).updateNote).toBe("Business source update failed");
  });

  it("start-up checkboxes reflect both switches; Start with Windows says it needs the installed app when it cannot work", () => {
    expect(d(base(), { startAppWithWindows: true, startAgentAutomatically: false, bounds: null }).settings).toMatchObject({ startAppWithWindows: true, startAgentAutomatically: false, autostartAvailable: true, autostartNote: null });
    const dev = model.describe({ ...view(base()), autostartAvailable: false }, 1);
    expect(dev.settings).toMatchObject({ autostartAvailable: false, autostartNote: "Available in the installed app." });
    const html = read("renderer", "index.html");
    expect(html).toContain("Start app with Windows");
    expect(html).toContain("Start agent automatically");
  });

  it("no word the window shows contains a filesystem path, a token or a secret", () => {
    const states = [base(), base({ worker: "error", lastError: { kind: "start_failed", message: "The agent stopped with an error.", at: 1 } }), base({ worker: "stopped" })];
    for (const s of states) expect(JSON.stringify(d(s))).not.toMatch(/[A-Za-z]:\\|ipa_|Bearer|token/i);
  });
});

/* --------------------------------------------- security --------------------------------------------- */

describe("desktop app: security and reuse", () => {
  const main = read("src", "main.ts");

  it("the window is sandboxed with context isolation, no Node, no navigation, no new windows, no permissions", () => {
    expect(main).toMatch(/contextIsolation: true/);
    expect(main).toMatch(/sandbox: true/);
    expect(main).toMatch(/nodeIntegration: false/);
    expect(main).toMatch(/webSecurity: true/);
    expect(main).toContain('on("will-navigate", (e) => e.preventDefault())');
    expect(main).toContain('setWindowOpenHandler(() => ({ action: "deny" }))');
    expect(main).toContain("setPermissionRequestHandler");
    expect(read("renderer", "index.html")).toContain("Content-Security-Policy");
    expect(read("renderer", "index.html")).toMatch(/default-src 'none'; script-src 'self'; style-src 'self'/);
  });

  it("closing the window hides it to the tray; only Exit ends the app, and Exit confirms when a run is active", () => {
    expect(main).toMatch(/w\.on\("close", \(e\) => \{\s*if \(!quitting\) \{\s*e\.preventDefault\(\);\s*w\.hide\(\);/);
    expect(main.match(/app\.exit\(0\)/g)).toHaveLength(1);
    expect(main).toMatch(/async function exitApp\(\)[\s\S]*activeRun[\s\S]*confirmStopIfRunActive/);
    expect(main).toContain("Stopping now may interrupt it.");
    expect(main).toContain('buttons: ["Cancel", "Stop anyway"]');
  });

  it("the app reuses the service: no worker, job, Codex or token code of its own, and it never reads the token", () => {
    expect(main).toContain("ProspectAgentService");
    for (const forbidden of ["startWorker", "runJob", "execStructured", "secret-store", "loadToken", "saveToken", "AgentApi", "token.dpapi", "auth.json", "OPENAI"]) expect(main, forbidden).not.toContain(forbidden);
    for (const f of readdirSync(join(desktop, "src"))) {
      const src = read("src", f);
      expect(src, f).not.toMatch(/ipa_|Bearer|api[_-]?key|\.codex[\\/]/i);
      expect(src, f).not.toContain("process.env.PROSPECT_AGENT_TOKEN");
    }
  });

  it("the page writes with textContent only, keeps no secret in storage, and loads nothing from the network", () => {
    const js = read("renderer", "app.js") + read("renderer", "model.js");
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|WebSocket/);
    expect(read("renderer", "index.html")).not.toMatch(/https?:\/\/(?!www\.w3)/);
    expect(read("renderer", "styles.css")).not.toMatch(/url\(\s*['"]?https?:/);
  });

  it("the window can only ask for fixed actions: the CRM pages are a closed list and the URL is built in the main process", () => {
    const ipc = read("src", "ipc.ts");
    expect(ipc).toContain('CRM_PAGES: readonly CrmPage[] = ["prospecting", "settings"]');
    expect(main).toContain("if (!CRM_PAGES.includes(page)) return;");
    expect(main).toContain("fromOurWindow");
    const preload = read("src", "preload.ts");
    expect(preload).toContain("exposeInMainWorld");
    expect(preload).not.toMatch(/shell|openExternal|require\(/);
  });

  it("start with Windows is a per-user login item that opens the app hidden, never a registry write of ours", () => {
    expect(main).toContain("openAtLogin: settings.startAppWithWindows");
    expect(main).toContain('args: ["--hidden"]');
    expect(main).not.toMatch(/Registry|reg add|HKLM|HKCU/);
  });

  it("is not distributed: no update server, no publish target, no public URL baked in", () => {
    const pkg = read("package.json");
    expect(pkg).not.toMatch(/"publish"|autoUpdater|electron-updater|github\.com|s3:/);
    expect(read("src", "main.ts")).not.toMatch(/autoUpdater|electron-updater/);
  });

  it("generated output (node_modules, dist, release, installers) is ignored by Git", () => {
    const ig = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    for (const p of ["/tools/prospect-agent-desktop/node_modules/", "/tools/prospect-agent-desktop/dist/", "/tools/prospect-agent-desktop/release/"]) expect(ig).toContain(p);
  });

  it("the committed source has no binary installer or oversized file", () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (n === "node_modules" || n === "dist" || n === "release" ? [] : statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
    for (const f of walk(desktop)) {
      expect(f).not.toMatch(/\.(exe|msi|dll|zip|7z|nupkg)$/i);
      expect(statSync(f).size, f).toBeLessThan(200_000);
    }
    void mkdirSync;
  });
});
