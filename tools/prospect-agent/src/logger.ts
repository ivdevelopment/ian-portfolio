import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { agentHome } from "./paths";

/**
 * Local log: run id, stage, durations, counts, the Codex exit code. Never anything secret: every line passes through `redact`, which removes
 * connection tokens and anything shaped like a bearer token, and callers only ever pass counts and identifiers, not request bodies.
 */
const MAX_LOG_BYTES = 1_000_000;

export function redact(text: string): string {
  return text.replace(/ipa_[A-Za-z0-9_-]{20,}/g, "ipa_[redacted]").replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[redacted]").replace(/\b(sk|rk)-[A-Za-z0-9_-]{16,}/g, "[redacted]");
}

export type Logger = { info(message: string, fields?: Record<string, unknown>): void; warn(message: string, fields?: Record<string, unknown>): void; error(message: string, fields?: Record<string, unknown>): void };

export function createLogger(opts: { file?: boolean; sink?: (line: string) => void } = {}): Logger {
  const dir = join(agentHome(), "logs");
  const file = join(dir, "agent.log");
  const write = (level: string, message: string, fields?: Record<string, unknown>) => {
    const extra = fields ? ` ${Object.entries(fields).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")}` : "";
    const line = redact(`${new Date().toISOString()} ${level} ${message}${extra}`);
    (opts.sink ?? ((l: string) => console.log(l)))(line);
    if (opts.file === false) return;
    try {
      mkdirSync(dir, { recursive: true });
      if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) renameSync(file, join(dir, "agent.old.log"));
      appendFileSync(file, `${line}\n`);
    } catch {
      /* logging must never stop the agent */
    }
  };
  return { info: (m, f) => write("INFO", m, f), warn: (m, f) => write("WARN", m, f), error: (m, f) => write("ERROR", m, f) };
}
