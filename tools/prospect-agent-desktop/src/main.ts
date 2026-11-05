import { spawn } from "node:child_process";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, screen, session, shell, Tray, type IpcMainInvokeEvent } from "electron";
import { resolveExecutableCached } from "../../prospect-agent/src/codex";
import { loadConfig } from "../../prospect-agent/src/config";
import { createLogger } from "../../prospect-agent/src/logger";
import { agentHome } from "../../prospect-agent/src/paths";
import { crmPageUrl, deriveOverall, ProspectAgentService } from "../../prospect-agent/src/service";
import { codexLoginCommand } from "./codex-login";
import { claimSingleInstance } from "./instance";
import { CH, CRM_PAGES, type CrmPage, type View } from "./ipc";
import { NotificationGate, notificationFor } from "./notify-policy";
import { applySettingChange, loadSettings, sanitizeBounds, saveSettings, WINDOW, type DesktopSettings } from "./settings";
import { trayIconName, trayMenu, trayTooltip } from "./tray-model";
import { threadedUpdate } from "./update-runner";

/**
 * Ian Prospect Agent: a small Windows tray application around ProspectAgentService (the same service the command line uses). It contains no
 * worker logic. It runs as the current Windows user with no administrator rights, keeps the CRM connection token where it always was (Windows
 * DPAPI, read only by the service) and never handles that token itself.
 */
const APP_NAME = "Ian Prospect Agent";
const APP_ID = "com.ianverlinden.prospect-agent";
const hiddenStart = process.argv.includes("--hidden");

const home = agentHome();
// Electron's own caches live under the agent folder (per user, Local), not in Roaming.
app.setPath("userData", join(home, "desktop", "electron"));
app.setName(APP_NAME);
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

const log = createLogger();
let settings: DesktopSettings = loadSettings(home);
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const service = new ProspectAgentService({ owner: "desktop", log, updateBusinessData: threadedUpdate(join(__dirname, "update-worker.cjs")) });
const gate = new NotificationGate();

/* ------------------------------------------ view ------------------------------------------ */

const loginItemOptions = () => ({ path: process.execPath, args: ["--hidden"] });
const autostartAvailable = () => process.platform === "win32" && app.isPackaged;
const autostartActual = () => {
  try {
    return autostartAvailable() && app.getLoginItemSettings(loginItemOptions()).openAtLogin;
  } catch {
    return false;
  }
};

function buildView(): View {
  const snapshot = service.getState();
  const config = loadConfig();
  return {
    snapshot,
    overall: deriveOverall(snapshot),
    settings,
    autostartAvailable: autostartAvailable(),
    autostartActual: autostartActual(),
    diagnostics: service.diagnostics({
      "Desktop app": app.getVersion(),
      Electron: process.versions.electron,
      Node: process.versions.node,
      "Log folder": join(home, "logs"),
      "Business data folder": join(home, "data", "osm"),
      "Start app with Windows": settings.startAppWithWindows ? `on (Windows: ${autostartActual() ? "registered" : "not registered"})` : "off",
      "Start agent automatically": settings.startAgentAutomatically ? "on" : "off",
      "CRM page": crmPageUrl(config.crmUrl),
    }),
  };
}

let pushTimer: NodeJS.Timeout | null = null;
function schedulePush() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    refreshTray();
    if (win && !win.isDestroyed() && win.isVisible()) win.webContents.send(CH.view, buildView());
  }, 150);
}

/* ------------------------------------------ window ------------------------------------------ */

function createWindow(): BrowserWindow {
  const saved = sanitizeBounds(settings.bounds, screen.getAllDisplays().map((d) => d.workArea));
  const w = new BrowserWindow({
    ...(saved ?? {}),
    width: saved?.width ?? WINDOW.width,
    height: saved?.height ?? WINDOW.height,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    maxWidth: WINDOW.maxWidth,
    maxHeight: WINDOW.maxHeight,
    show: false,
    title: APP_NAME,
    backgroundColor: "#0b0f1d",
    autoHideMenuBar: true,
    icon: join(__dirname, "assets", "icon.png"),
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, devTools: !app.isPackaged, spellcheck: false },
  });
  w.removeMenu();
  void w.loadFile(join(__dirname, "renderer", "index.html"));
  // The window shows only its own page: no navigation, no new windows.
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // If the window's own process ends unexpectedly, say why (a fixed reason and exit code, nothing else) and offer a fresh window next time.
  w.webContents.on("render-process-gone", (_e, d) => log.error("window process ended", { reason: d.reason, exitCode: d.exitCode }));
  w.webContents.on("did-fail-load", (_e, code, description) => log.error("window failed to load", { code, description }));
  w.webContents.on("preload-error", (_e, _path, error) => log.error("window preload failed", { error: error.message.slice(0, 200) }));
  // Closing hides to the tray: the agent keeps running. Only Exit ends the app.
  w.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      w.hide();
    }
  });
  let saveTimer: NodeJS.Timeout | null = null;
  const remember = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (w.isDestroyed() || w.isMinimized() || w.isMaximized() || w.isFullScreen()) return;
      settings = { ...settings, bounds: w.getBounds() };
      saveSettings(home, settings);
    }, 500);
  };
  w.on("move", remember);
  w.on("resize", remember);
  w.on("show", () => {
    void service.refresh().then(schedulePush);
    schedulePush();
  });
  w.on("closed", () => {
    win = null;
  });
  return w;
}

function showWindow() {
  if (!win || win.isDestroyed()) win = createWindow();
  const w = win;
  const reveal = () => {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    // Windows does not let a background process take the foreground by itself; a second start by the person is exactly the case where it should.
    if (process.platform === "win32") app.focus({ steal: true });
    w.webContents.send(CH.view, buildView());
  };
  if (w.webContents.isLoading()) w.webContents.once("did-finish-load", reveal);
  else reveal();
}

/* ------------------------------------------- tray ------------------------------------------- */

const icons = new Map<string, Electron.NativeImage>();
function trayImage(name: string) {
  let img = icons.get(name);
  if (!img) {
    img = nativeImage.createFromPath(join(__dirname, "assets", `${name}.png`));
    const hi = nativeImage.createFromPath(join(__dirname, "assets", `${name}@2x.png`));
    if (!hi.isEmpty()) img.addRepresentation({ scaleFactor: 2, buffer: hi.toPNG() });
    icons.set(name, img);
  }
  return img;
}

async function confirmStopIfRunActive(): Promise<boolean> {
  const { response } = await dialog.showMessageBox({ type: "warning", title: APP_NAME, message: "A prospecting run is currently active.", detail: "Stopping now may interrupt it.", buttons: ["Cancel", "Stop anyway"], defaultId: 0, cancelId: 0, noLink: true });
  return response === 1;
}

async function stopAgentFromTray() {
  const first = await service.stop();
  if (first.ok) return;
  if (await confirmStopIfRunActive()) await service.stop({ mode: "force" });
}

function refreshTray() {
  if (!tray) return;
  const snapshot = service.getState();
  const overall = deriveOverall(snapshot);
  tray.setImage(trayImage(trayIconName(overall)));
  tray.setToolTip(trayTooltip(overall));
  const actions: Record<string, () => void> = {
    open: showWindow,
    start: () => void service.start(),
    stop: () => void stopAgentFromTray(),
    crm: () => openCrm("prospecting"),
    exit: () => void exitApp(),
  };
  tray.setContextMenu(
    Menu.buildFromTemplate(
      trayMenu(snapshot, overall).map((m) => (m.separator ? { type: "separator" as const } : { label: m.label, enabled: m.enabled !== false, click: m.id ? actions[m.id] : undefined })),
    ),
  );
}

function createTray() {
  tray = new Tray(trayImage("tray-gray"));
  tray.on("click", () => (win && win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  tray.on("double-click", showWindow);
  refreshTray();
}

/* ---------------------------------------- actions ---------------------------------------- */

function openCrm(page: CrmPage) {
  if (!CRM_PAGES.includes(page)) return;
  const url = crmPageUrl(loadConfig().crmUrl, `/${page}`);
  void shell.openExternal(url); // always the CRM's own address: the window can only choose between two fixed pages
}

function openCodexLogin(): { ok: boolean } {
  const cmd = codexLoginCommand(resolveExecutableCached(loadConfig().codexBin), process.env.ComSpec);
  if (!cmd) return { ok: false };
  try {
    const child = spawn(cmd.cmd, cmd.args, { detached: true, stdio: "ignore", windowsVerbatimArguments: true, windowsHide: false });
    child.on("error", () => undefined);
    child.unref();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function applyLoginItem() {
  if (!autostartAvailable()) return;
  try {
    app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: settings.startAppWithWindows });
  } catch (e) {
    log.warn("could not change the Windows login item", { error: e instanceof Error ? e.constructor.name : "error" });
  }
}

async function exitApp() {
  if (quitting) return;
  if (service.getState().activeRun && !(await confirmStopIfRunActive())) return;
  quitting = true;
  try {
    await Promise.race([service.shutdown(), new Promise((r) => setTimeout(r, 30_000))]);
  } finally {
    log.info("desktop app exiting");
    tray?.destroy();
    app.exit(0);
  }
}

/* ------------------------------------------- IPC ------------------------------------------- */

/** Messages are accepted only from this app's own window. */
function fromOurWindow(e: IpcMainInvokeEvent): boolean {
  return !!win && !win.isDestroyed() && e.sender === win.webContents;
}
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>, fallback: R) {
  ipcMain.handle(channel, async (e, ...args) => (fromOurWindow(e) ? await fn(...(args as A)) : fallback));
}

function registerIpc() {
  handle(CH.getView, () => buildView(), buildView());
  handle(CH.start, () => service.start(), { ok: false as const, reason: "error" as const, message: "Not allowed." });
  handle(CH.stop, (force: unknown) => service.stop({ mode: force === true ? "force" : "ask" }), { ok: true as const });
  handle(CH.testCodex, () => service.testCodex(), { state: "failed" as const, message: "Not allowed.", version: null, ms: null });
  handle(CH.codexLogin, () => openCodexLogin(), { ok: false });
  handle(
    CH.updateData,
    async (force: unknown) => {
      const r = await service.updateBusinessData({ force: force === true });
      return r.ok ? { ok: true } : { ok: false, message: r.reason === "failed" ? "Business source update failed" : r.message };
    },
    { ok: false },
  );
  handle(CH.openCrm, (page: unknown) => openCrm(page as CrmPage), undefined);
  handle(CH.copyDiagnostics, () => clipboard.writeText(buildView().diagnostics), undefined);
  handle(CH.openLogs, () => void shell.openPath(join(home, "logs")), undefined);
  handle(
    CH.setSetting,
    (key: unknown, value: unknown) => {
      const next = applySettingChange(settings, key, value);
      if (!next) return;
      settings = next;
      saveSettings(home, settings);
      if (key === "startAppWithWindows") applyLoginItem();
      schedulePush();
    },
    undefined,
  );
  handle(CH.hide, () => win?.hide(), undefined);
}

/* -------------------------------------- notifications -------------------------------------- */

function notify(spec: { key: string; title: string; body: string; action: "open_crm" | "open_window" }) {
  if (!Notification.isSupported() || !gate.allow(spec.key, Date.now())) return;
  const n = new Notification({ title: spec.title, body: spec.body, icon: join(__dirname, "assets", "icon.png"), silent: false });
  n.on("click", () => (spec.action === "open_crm" ? openCrm("prospecting") : showWindow()));
  n.show();
}

/* --------------------------------------- start-up --------------------------------------- */

process.on("uncaughtException", (e) => log.error("desktop app error", { error: e instanceof Error ? e.constructor.name : "error" }));
process.on("unhandledRejection", () => log.error("desktop app error", { error: "unhandled rejection" }));

if (
  claimSingleInstance(app, () => {
    log.info("second start ignored: showing the window of the running app");
    showWindow();
  })
) {
  app.on("window-all-closed", () => undefined); // the tray keeps the app alive
  app.on("before-quit", (e) => {
    if (!quitting) {
      e.preventDefault();
      void exitApp();
    }
  });
  // Windows is signing out or shutting down: stop the worker and end any Codex process so none is left behind.
  app.on("session-end" as never, () => {
    quitting = true;
    void service.shutdown();
  });

  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    registerIpc();
    createTray();
    service.onState(schedulePush);
    service.onEvent((e) => {
      const spec = notificationFor(e);
      if (spec) notify(spec);
    });
    log.info("desktop app started", { version: app.getVersion(), packaged: app.isPackaged, hidden: hiddenStart });
    applyLoginItem();
    if (!hiddenStart) showWindow();
    if (settings.startAgentAutomatically && service.getState().setup.configured) void service.start();
    else void service.refresh().then(schedulePush);
    // While the agent is stopped nothing else re-checks Codex, so do it now and then.
    setInterval(() => void service.refresh().then(schedulePush), 5 * 60_000).unref();
  });
}
