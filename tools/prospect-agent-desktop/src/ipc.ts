import type { AgentSnapshot, CodexTestOutcome, Overall, StartResult, StopResult } from "../../prospect-agent/src/service";
import type { DesktopSettings } from "./settings";

/** The only messages between the window and the main process. The window can ask for these actions; it can never pass a URL, a path or a command. */
export const CH = {
  getView: "agent:get-view",
  view: "agent:view",
  start: "agent:start",
  stop: "agent:stop",
  testCodex: "codex:test",
  codexLogin: "codex:login",
  updateData: "data:update",
  openCrm: "crm:open",
  copyDiagnostics: "diag:copy",
  openLogs: "diag:logs",
  setSetting: "settings:set",
  hide: "window:hide",
} as const;

export type CrmPage = "prospecting" | "settings";
export const CRM_PAGES: readonly CrmPage[] = ["prospecting", "settings"];

export type View = {
  snapshot: AgentSnapshot;
  overall: Overall;
  settings: DesktopSettings;
  /** Start with Windows only works in the installed app, not when running from the repository. */
  autostartAvailable: boolean;
  /** Real state of the Windows login item (what Windows will do), not just the saved preference. */
  autostartActual: boolean;
  diagnostics: string;
};

export type RendererApi = {
  getView(): Promise<View>;
  onView(cb: (view: View) => void): () => void;
  start(): Promise<StartResult>;
  stop(force: boolean): Promise<StopResult>;
  testCodex(): Promise<CodexTestOutcome>;
  openCodexLogin(): Promise<{ ok: boolean }>;
  updateData(force: boolean): Promise<{ ok: boolean; message?: string }>;
  openCrm(page: CrmPage): Promise<void>;
  copyDiagnostics(): Promise<void>;
  openLogs(): Promise<void>;
  setSetting(key: "startAppWithWindows" | "startAgentAutomatically", value: boolean): Promise<void>;
  hide(): Promise<void>;
};
