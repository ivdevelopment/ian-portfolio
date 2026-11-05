import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentHome } from "./paths";

/**
 * One worker per Windows user. The worker owns the Codex process and claims runs, so a second one (the command line next to the tray app, or two
 * tray apps) must not start. The lock is a tiny file holding the owner's process id; it is taken with an exclusive create, so two starts racing
 * cannot both win, and a lock whose owner is gone (a crash, a power cut) is taken over automatically. It contains no secret.
 */
export type LockInfo = { pid: number; startedAt: number; owner: string };

const lockFile = (home: string) => join(home, "agent.lock");

const defaultAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

export function readLock(home = agentHome()): LockInfo | null {
  try {
    const v = JSON.parse(readFileSync(lockFile(home), "utf8")) as LockInfo;
    return v && Number.isInteger(v.pid) && typeof v.owner === "string" ? v : null;
  } catch {
    return null;
  }
}

export type LockResult = { ok: true; release: () => void } | { ok: false; holder: LockInfo };

export function acquireLock(owner: string, opts: { home?: string; isAlive?: (pid: number) => boolean; now?: () => number } = {}): LockResult {
  const home = opts.home ?? agentHome();
  const alive = opts.isAlive ?? defaultAlive;
  const now = opts.now ?? Date.now;
  mkdirSync(home, { recursive: true });
  const info: LockInfo = { pid: process.pid, startedAt: now(), owner };
  const release = () => {
    // Only remove a lock that is still ours.
    if (readLock(home)?.pid === process.pid) rmSync(lockFile(home), { force: true });
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(lockFile(home), JSON.stringify(info), { flag: "wx" });
      return { ok: true, release };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const holder = readLock(home);
    if (holder && holder.pid !== process.pid && alive(holder.pid)) return { ok: false, holder };
    // Ours from an earlier start in this process, unreadable, or left by a process that is gone: take it over.
    rmSync(lockFile(home), { force: true });
  }
  const holder = readLock(home);
  return { ok: false, holder: holder ?? { pid: 0, startedAt: 0, owner: "unknown" } };
}
