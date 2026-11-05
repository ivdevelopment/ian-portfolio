import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The tray application's own preferences (not secrets): the two start-up choices and where the window was last. They are kept apart on purpose:
 *   startAppWithWindows      the tray app opens, hidden in the tray, when this Windows user signs in
 *   startAgentAutomatically  whenever the app opens, the agent (the worker) is started too
 * Both are OFF until the person turns them on.
 */
export type Bounds = { x: number; y: number; width: number; height: number };
export type DesktopSettings = { startAppWithWindows: boolean; startAgentAutomatically: boolean; bounds: Bounds | null };
export const DEFAULT_SETTINGS: DesktopSettings = { startAppWithWindows: false, startAgentAutomatically: false, bounds: null };

export const WINDOW = { width: 460, height: 680, minWidth: 400, minHeight: 520, maxWidth: 680, maxHeight: 1000 } as const;

const file = (home: string) => join(home, "desktop", "settings.json");

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** A saved window position is only used if it is a sane size and still lands on a connected display. */
export function sanitizeBounds(value: unknown, displays: readonly Bounds[]): Bounds | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const nums = ["x", "y", "width", "height"].map((k) => Number(v[k]));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = nums;
  const width = clamp(Math.round(w), WINDOW.minWidth, WINDOW.maxWidth);
  const height = clamp(Math.round(h), WINDOW.minHeight, WINDOW.maxHeight);
  // At least a 100 x 60 piece of the title area must be visible on some display.
  const visible = displays.some((d) => x + width - 100 > d.x && x + 100 < d.x + d.width && y + 60 < d.y + d.height && y > d.y - 20);
  return visible ? { x: Math.round(x), y: Math.round(y), width, height } : null;
}

export function loadSettings(home: string): DesktopSettings {
  try {
    if (!existsSync(file(home))) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(readFileSync(file(home), "utf8")) as Record<string, unknown>;
    return { startAppWithWindows: v.startAppWithWindows === true, startAgentAutomatically: v.startAgentAutomatically === true, bounds: v.bounds && typeof v.bounds === "object" ? (v.bounds as Bounds) : null };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(home: string, settings: DesktopSettings): void {
  try {
    mkdirSync(join(home, "desktop"), { recursive: true });
    const tmp = `${file(home)}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
    renameSync(tmp, file(home));
  } catch {
    /* preferences are a convenience: failing to save must never stop the app */
  }
}

/** Only the two known switches can be changed from the window, and only to a boolean. */
export function applySettingChange(current: DesktopSettings, key: unknown, value: unknown): DesktopSettings | null {
  if ((key !== "startAppWithWindows" && key !== "startAgentAutomatically") || typeof value !== "boolean") return null;
  return { ...current, [key]: value };
}
