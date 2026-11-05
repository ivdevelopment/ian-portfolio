import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The one place that runs Codex CLI. Codex owns authentication and everything about talking to ChatGPT; this module only starts the official
 * binary, hands it a prompt on stdin and reads the final structured answer from a file. It never reads Codex's credential files, never copies
 * a token and never calls any ChatGPT or OpenAI address itself.
 *
 * Process safety: the executable and every argument are passed as an ARRAY (no shell string); the only values that vary are validated tokens
 * (model, effort) and file paths we created; the prompt travels over stdin. The child gets a small allow-listed environment (no tokens of ours,
 * no Supabase keys). Output is capped; a stuck process is killed with its children.
 */
export type ProcResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean; spawnError: string | null };
export type ProcRunner = (cmd: string, args: string[], opts: { cwd: string; stdin: string; timeoutMs: number; maxBytes: number }) => Promise<ProcResult>;

import { FAILURE_KINDS, FAILURE_MESSAGES, type FailureKind } from "../../../src/lib/prospecting/agent/messages";
export { FAILURE_KINDS };
export type { FailureKind };

export const LIMITS = { maxStreamBytes: 200_000, maxResultBytes: 200_000 } as const;

const ENV_ALLOW = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "TEMP", "TMP", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "CODEX_HOME", "USERNAME", "LANG", "TERM"];
export function childEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of ENV_ALLOW) if (env[key] !== undefined) out[key] = env[key];
  return out;
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
      const { cmd, args: argv, verbatim } = resolveCommand(bin, args);
      child = spawn(cmd, argv, { cwd: opts.cwd, shell: false, windowsHide: true, windowsVerbatimArguments: verbatim, env: childEnv() as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
    } catch (error) {
      return resolve({ code: null, stdout: "", stderr: "", timedOut: false, truncated: false, spawnError: (error as NodeJS.ErrnoException).code ?? "spawn" });
    }
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let spawnError: string | null = null;
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
      killTree(child.pid);
      resolve({ code, stdout, stderr, timedOut, truncated, spawnError });
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
};
export type ExecResult = { ok: true; value: unknown; ms: number; exitCode: number } | { ok: false; kind: FailureKind; message: string; ms: number; exitCode: number | null };

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
  const r = await run(o.bin, args, { cwd: o.dir, stdin: o.prompt, timeoutMs: o.timeoutMs, maxBytes: LIMITS.maxStreamBytes });
  const ms = Date.now() - started;
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
