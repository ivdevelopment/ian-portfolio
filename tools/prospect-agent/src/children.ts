import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentHome } from "./paths";

/**
 * Crash safety for the processes the agent starts (Codex and the cmd.exe that wraps its npm shim). While one runs, its id and start time are
 * written to a small file. If the agent (or the desktop app around it) is killed without cleaning up, the next start finds entries whose owner is
 * gone and ends those process trees. A process is only ended when its operating-system creation time matches the recorded start, so a recycled
 * process id can never take down an unrelated program. The file holds numbers only: no tokens, no command lines, no prompts.
 */
export type ChildEntry = { pid: number; parentPid: number; startedAt: number };

const file = (home: string) => join(home, "children.json");

export function readChildren(home = agentHome()): ChildEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(file(home), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is ChildEntry => !!e && typeof e === "object" && Number.isInteger((e as ChildEntry).pid) && Number.isInteger((e as ChildEntry).parentPid) && Number.isFinite((e as ChildEntry).startedAt));
  } catch {
    return [];
  }
}

function writeChildren(entries: ChildEntry[], home: string): void {
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(file(home), JSON.stringify(entries), "utf8");
  } catch {
    /* bookkeeping must never stop a run */
  }
}

export function registerChild(pid: number | undefined, home = agentHome()): void {
  if (!pid) return;
  writeChildren([...readChildren(home).filter((e) => e.pid !== pid), { pid, parentPid: process.pid, startedAt: Date.now() }], home);
}

export function unregisterChild(pid: number | undefined, home = agentHome()): void {
  if (!pid || !existsSync(file(home))) return;
  writeChildren(readChildren(home).filter((e) => e.pid !== pid), home);
}

/** Pure decision: may this recorded child be ended now? Owner gone, process alive, and the same process that was recorded. */
export function shouldReap(entry: ChildEntry, probe: { ownerAlive: boolean; createdAt: number | null }, toleranceMs = 15_000): boolean {
  if (probe.ownerAlive || probe.createdAt === null) return false;
  return Math.abs(probe.createdAt - entry.startedAt) <= toleranceMs;
}

export type ReapDeps = {
  home?: string;
  isAlive?: (pid: number) => boolean;
  createdAt?: (pid: number) => number | null;
  kill?: (pid: number) => void;
};

const defaultAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Creation time (ms since epoch) of a running process, or null when it is not running. Windows only. */
function defaultCreatedAt(pid: number): number | null {
  if (process.platform !== "win32") return null;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$p = Get-Process -Id ${Math.trunc(pid)} -ErrorAction SilentlyContinue; if ($p) { [DateTimeOffset]::new($p.StartTime).ToUnixTimeMilliseconds() }`], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
  const n = Number(r.stdout.trim());
  return r.status === 0 && Number.isFinite(n) && n > 0 ? n : null;
}

const defaultKill = (pid: number) => {
  spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
};

/** Ends children left behind by a parent that no longer exists. Returns how many were ended. Never throws. */
export function reapOrphans(deps: ReapDeps = {}): number {
  const home = deps.home ?? agentHome();
  const alive = deps.isAlive ?? defaultAlive;
  const created = deps.createdAt ?? defaultCreatedAt;
  const kill = deps.kill ?? defaultKill;
  let ended = 0;
  const keep: ChildEntry[] = [];
  for (const entry of readChildren(home)) {
    try {
      if (entry.parentPid === process.pid) {
        keep.push(entry);
        continue;
      }
      const ownerAlive = alive(entry.parentPid);
      if (!alive(entry.pid)) continue; // already gone: just drop the entry
      if (shouldReap(entry, { ownerAlive, createdAt: created(entry.pid) })) {
        kill(entry.pid);
        ended++;
      } else if (ownerAlive) keep.push(entry);
    } catch {
      /* an entry that cannot be checked is dropped */
    }
  }
  writeChildren(keep, home);
  return ended;
}
