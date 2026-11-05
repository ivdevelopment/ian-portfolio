import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerChild, unregisterChild } from "./children";

/**
 * The one place that runs Codex CLI. Codex owns authentication and everything about talking to ChatGPT; this module only starts the official
 * binary, hands it a prompt on stdin and reads the final structured answer from a file. It never reads Codex's credential files, never copies
 * a token and never calls any ChatGPT or OpenAI address itself.
 *
 * Process safety: the executable and every argument are passed as an ARRAY (no shell string); the only values that vary are validated tokens
 * (model, effort) and file paths we created; the prompt travels over stdin. The child gets a small allow-listed environment (no tokens of ours,
 * no Supabase keys). Output is capped; a stuck process is killed with its children.
 */
export type ProcResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean; spawnError: string | null; /** The caller's AbortSignal fired and the process tree was killed. */ aborted?: boolean };
export type ProcRunner = (cmd: string, args: string[], opts: { cwd: string; stdin: string; timeoutMs: number; maxBytes: number; signal?: AbortSignal }) => Promise<ProcResult>;

import { FAILURE_KINDS, FAILURE_MESSAGES, type FailureKind } from "../../../src/lib/prospecting/agent/messages";
export { FAILURE_KINDS };
export type { FailureKind };

export const LIMITS = { maxStreamBytes: 200_000, maxResultBytes: 200_000 } as const;

/**
 * What Codex gets from the parent environment: the Windows/user basics it needs to start and find its own sign-in (PATH/PATHEXT, SystemRoot,
 * ComSpec, USERPROFILE/HOME, APPDATA/LOCALAPPDATA, TEMP/TMP, CODEX_HOME) and, only if already set, the proxy and certificate variables a
 * proxied network needs. Nothing else: no connection token, no Supabase key, no Vercel or project variable, no API key of any kind.
 * Windows variable names are case-insensitive, so each is copied once, under the spelling the parent used.
 */
const ENV_ALLOW = [
  "PATH", "PATHEXT", "SystemRoot", "SystemDrive", "windir", "ComSpec", "TEMP", "TMP", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
  "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "PROCESSOR_ARCHITECTURE", "OS", "USERNAME", "CODEX_HOME", "LANG", "TERM",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE",
] as const;
export function childEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const wanted = new Set(ENV_ALLOW.map((k) => k.toLowerCase()));
  const out: Record<string, string | undefined> = {};
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    const lower = key.toLowerCase();
    if (value === undefined || !wanted.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    out[key] = value;
  }
  return out;
}

/* --------------------------- finding the Codex executable --------------------------- */

/**
 * `spawn("codex")` cannot work on Windows: CreateProcess does not apply PATHEXT, and an npm install of Codex provides `codex.cmd` (plus an
 * extensionless script), never `codex.exe`. So the executable is resolved first, with the PARENT environment (where.exe), to an absolute path:
 * a native `.exe` is preferred, then the `.cmd`/`.bat` shim (started through cmd.exe, see resolveCommand). The extensionless file is a
 * shell script and is ignored. The result is then started with the restricted environment above.
 */
const EXT_RANK = [".exe", ".cmd", ".bat"] as const;
const BARE_NAME = /^[A-Za-z0-9._-]{1,60}$/;

export type ResolveDeps = { platform?: NodeJS.Platform; env?: Record<string, string | undefined>; where?: (name: string, env: Record<string, string | undefined>) => string[]; exists?: (path: string) => boolean };

const whereExe = (name: string, env: Record<string, string | undefined>): string[] => {
  const r = spawnSync("where.exe", [name], { encoding: "utf8", windowsHide: true, timeout: 10_000, env: env as NodeJS.ProcessEnv });
  return r.status === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
};

/** The absolute path to start for `bin`, or null when it cannot be found. Off Windows `bin` is returned as is (spawn resolves PATH itself). */
export function resolveExecutable(bin: string, deps: ResolveDeps = {}): string | null {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") return bin;
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const hasExt = /\.[A-Za-z0-9]{1,4}$/.test(bin);
  if (/[\\/]/.test(bin) || /^[A-Za-z]:/.test(bin)) {
    // A path the person configured: use it, adding the extension an npm shim would have when it was left off.
    if (hasExt && exists(bin)) return bin;
    for (const ext of EXT_RANK) if (exists(`${bin}${ext}`)) return `${bin}${ext}`;
    return exists(bin) ? bin : null;
  }
  if (!BARE_NAME.test(bin)) return null;
  const found = (deps.where ?? whereExe)(bin, env).filter((p) => EXT_RANK.some((ext) => p.toLowerCase().endsWith(ext)));
  for (const ext of EXT_RANK) {
    const hit = found.find((p) => p.toLowerCase().endsWith(ext));
    if (hit) return hit;
  }
  return null;
}

const resolvedCache = new Map<string, string | null>();
/** Resolution is cached per name for the life of the process (a diagnostics run asks several times). */
export function resolveExecutableCached(bin: string): string | null {
  if (!resolvedCache.has(bin)) resolvedCache.set(bin, resolveExecutable(bin));
  const hit = resolvedCache.get(bin) ?? null;
  if (hit === null) resolvedCache.delete(bin); // a failed lookup is retried next time (Codex may be installed while the agent runs)
  return hit;
}

/** On Windows the npm install of Codex is a `.cmd` shim, which cannot be spawned directly; it is started through cmd.exe with the same fixed arguments. */
export function resolveCommand(bin: string, args: string[], platform = process.platform, env: Record<string, string | undefined> = process.env): { cmd: string; args: string[]; verbatim: boolean } {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    // cmd.exe re-parses its command line, so it gets ONE verbatim string: the whole command wrapped in quotes, each part quoted only if it
    // contains a space. Any cmd metacharacter in a part is refused outright (our parts are fixed flags and paths we created, never user text).
    const parts = [bin, ...args];
    if (parts.some((p) => /["%^&|<>()!\r\n]/.test(p))) throw new Error("unsafe argument for cmd.exe");
    const quote = (p: string) => (/\s/.test(p) ? `"${p}"` : p);
    return { cmd: env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${parts.map(quote).join(" ")}"`], verbatim: true };
  }
  return { cmd: bin, args, verbatim: false };
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

export const runProcess: ProcRunner = (bin, args, opts) =>
  new Promise((resolve) => {
    let child;
    try {
      // Find the real file with the PARENT environment, then start it with the restricted one.
      const exe = resolveExecutableCached(bin);
      if (exe === null) return resolve({ code: null, stdout: "", stderr: "", timedOut: false, truncated: false, spawnError: "ENOENT" });
      const { cmd, args: argv, verbatim } = resolveCommand(exe, args);
      child = spawn(cmd, argv, { cwd: opts.cwd, shell: false, windowsHide: true, windowsVerbatimArguments: verbatim, env: childEnv() as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
    } catch (error) {
      return resolve({ code: null, stdout: "", stderr: "", timedOut: false, truncated: false, spawnError: (error as NodeJS.ErrnoException).code ?? "spawn" });
    }
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let spawnError: string | null = null;
    let aborted = false;
    // Children are remembered on disk while they run, so a crash of the parent cannot leave a Codex process behind unnoticed (see children.ts).
    registerChild(child.pid);
    const onAbort = () => {
      aborted = true;
      killTree(child.pid);
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const add = (which: "out" | "err", chunk: Buffer) => {
      const room = opts.maxBytes - (stdout.length + stderr.length);
      if (room <= 0) {
        truncated = true;
        return;
      }
      const text = chunk.toString("utf8", 0, Math.min(chunk.length, room));
      if (chunk.length > room) truncated = true;
      if (which === "out") stdout += text;
      else stderr += text;
    };
    child.stdout.on("data", (c: Buffer) => add("out", c));
    child.stderr.on("data", (c: Buffer) => add("err", c));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, opts.timeoutMs);
    child.on("error", (e) => {
      spawnError = (e as NodeJS.ErrnoException).code ?? "spawn";
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      killTree(child.pid);
      unregisterChild(child.pid);
      resolve({ code, stdout, stderr, timedOut, truncated, spawnError, ...(aborted ? { aborted } : {}) });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.stdin);
  });

/* ----------------------------- classifying failures ----------------------------- */

const NOT_AUTH = /not (currently )?(logged|signed) in|log ?in (is )?required|please (log|sign) ?in|run .?codex login|unauthori[sz]ed|401|invalid (auth|credentials)|authentication (failed|required)|token (expired|invalid)/i;
const USAGE = /usage limit|reached (your|the) .{0,30}limit|rate limit|quota|too many requests|429|try again (later|in|after)|limit (has been )?reached/i;

/** A fixed failure kind from what a finished process looked like. The raw text is never kept or sent anywhere. */
export function classify(r: ProcResult): FailureKind {
  if (r.spawnError === "ENOENT" || r.spawnError === "EINVAL") return "codex_not_installed";
  if (r.timedOut) return "codex_timeout";
  const text = `${r.stderr}\n${r.stdout}`.slice(0, 20_000);
  if (USAGE.test(text)) return "codex_usage_limit";
  if (NOT_AUTH.test(text)) return "codex_not_authenticated";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network (error|is unreachable)|could not resolve/i.test(text)) return "network_error";
  return "agent_error";
}

export const KIND_MESSAGES: Record<FailureKind, string> = FAILURE_MESSAGES;

/* ------------------------------ diagnostics ------------------------------ */

export type CodexState = "ready" | "not_installed" | "not_authenticated" | "error";
export type Diagnostics = { state: CodexState; version: string | null; missingFlags: string[]; note: string | null };

/** The `codex exec` flags this agent relies on. They are checked against the INSTALLED version's help text, not assumed. */
export const REQUIRED_EXEC_FLAGS = ["--output-schema", "--sandbox", "--skip-git-repo-check"] as const;
export const OPTIONAL_EXEC_FLAGS = ["--output-last-message", "--ephemeral", "--model", "--cd", "--color"] as const;

export function parseVersion(text: string): string | null {
  const m = /(\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.]+)?)/.exec(text);
  return m ? m[1] : null;
}

export async function diagnose(bin: string, run: ProcRunner = runProcess, cwd = process.cwd()): Promise<Diagnostics> {
  const base = { cwd, stdin: "", timeoutMs: 20_000, maxBytes: 100_000 };
  const v = await run(bin, ["--version"], base);
  if (v.spawnError || v.code !== 0) return { state: classify(v) === "codex_not_installed" ? "not_installed" : "error", version: null, missingFlags: [], note: v.spawnError ? KIND_MESSAGES.codex_not_installed : "codex --version failed" };
  const version = parseVersion(v.stdout + v.stderr);
  const help = await run(bin, ["exec", "--help"], base);
  const helpText = help.stdout + help.stderr;
  const missingFlags = help.code === 0 ? REQUIRED_EXEC_FLAGS.filter((f) => !helpText.includes(f)) : [...REQUIRED_EXEC_FLAGS];
  if (missingFlags.length > 0) return { state: "error", version, missingFlags, note: `The installed Codex does not support: ${missingFlags.join(", ")}. Update Codex CLI.` };
  const login = await run(bin, ["login", "status"], base);
  if (login.code !== 0) return { state: "not_authenticated", version, missingFlags: [], note: KIND_MESSAGES.codex_not_authenticated };
  return { state: "ready", version, missingFlags: [], note: null };
}

/** True when the installed `codex exec --help` lists the flag (used for the optional ones). */
export async function supportedFlags(bin: string, run: ProcRunner = runProcess, cwd = process.cwd()): Promise<Set<string>> {
  const help = await run(bin, ["exec", "--help"], { cwd, stdin: "", timeoutMs: 20_000, maxBytes: 100_000 });
  const text = help.stdout + help.stderr;
  return new Set([...REQUIRED_EXEC_FLAGS, ...OPTIONAL_EXEC_FLAGS].filter((f) => text.includes(f)));
}

/* ------------------------------ structured exec ------------------------------ */

export type ExecOptions = {
  bin: string;
  dir: string;
  prompt: string;
  /** A strict JSON Schema for the final answer. */
  schema: Record<string, unknown>;
  model: string | null;
  effort: "low" | "medium" | "high";
  timeoutMs: number;
  flags: ReadonlySet<string>;
  run?: ProcRunner;
  /** Aborting kills the Codex process tree at once (the agent was stopped). */
  signal?: AbortSignal;
};
export type ExecResult = { ok: true; value: unknown; ms: number; exitCode: number } | { ok: false; kind: FailureKind; message: string; ms: number; exitCode: number | null; aborted?: boolean };

/**
 * One headless Codex call: `codex exec` in a throwaway folder, read-only sandbox, schema-constrained final message. The prompt is passed on
 * stdin (`-`). The answer is read from the --output-last-message file when this Codex has it, otherwise from stdout (which carries only the
 * final message). Whatever comes back is untrusted: it is parsed here and validated by the caller.
 */
export async function execStructured(o: ExecOptions): Promise<ExecResult> {
  const run = o.run ?? runProcess;
  mkdirSync(o.dir, { recursive: true });
  const schemaFile = join(o.dir, "schema.json");
  const resultFile = join(o.dir, "result.json");
  writeFileSync(schemaFile, JSON.stringify(o.schema), "utf8");
  writeFileSync(join(o.dir, "prompt.txt"), o.prompt, "utf8");
  rmSync(resultFile, { force: true });

  const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-schema", schemaFile];
  if (o.flags.has("--output-last-message")) args.push("--output-last-message", resultFile);
  if (o.flags.has("--ephemeral")) args.push("--ephemeral");
  if (o.flags.has("--color")) args.push("--color", "never");
  if (o.flags.has("--cd")) args.push("--cd", o.dir);
  if (o.model) args.push("--model", o.model);
  // Unquoted on purpose: Codex reads a -c value as TOML when it can and as a plain string otherwise, and "low|medium|high" has no quotes to lose in cmd.exe.
  args.push("-c", `model_reasoning_effort=${o.effort}`, "-");

  const started = Date.now();
  const r = await run(o.bin, args, { cwd: o.dir, stdin: o.prompt, timeoutMs: o.timeoutMs, maxBytes: LIMITS.maxStreamBytes, signal: o.signal });
  const ms = Date.now() - started;
  if (r.aborted) return { ok: false, kind: "agent_error", message: "Stopped.", ms, exitCode: r.code, aborted: true };
  if (r.spawnError || r.timedOut || r.code !== 0) {
    const kind = classify(r);
    return { ok: false, kind, message: KIND_MESSAGES[kind], ms, exitCode: r.code };
  }
  let text = "";
  if (existsSync(resultFile)) {
    if (statSync(resultFile).size > LIMITS.maxResultBytes) return { ok: false, kind: "invalid_output", message: KIND_MESSAGES.invalid_output, ms, exitCode: r.code };
    text = readFileSync(resultFile, "utf8");
  } else if (!r.truncated) text = r.stdout;
  const parsed = parseJsonObject(text);
  if (parsed === undefined) return { ok: false, kind: "invalid_output", message: KIND_MESSAGES.invalid_output, ms, exitCode: r.code };
  return { ok: true, value: parsed, ms, exitCode: r.code ?? 0 };
}

/** The answer as JSON: the whole text, or the first balanced object in it (some versions print a short preamble). */
export function parseJsonObject(text: string): unknown | undefined {
  const t = text.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    /* fall through to the balanced-object search */
  }
  const start = t.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(t.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
