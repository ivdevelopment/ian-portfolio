import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentHome } from "./paths";
import { DEFAULT_PRIORITIES, type Group } from "./osm/categories";

/**
 * The agent's settings (not secrets). Stored in %LOCALAPPDATA%\IanProspectAgent\config.json; environment variables override them.
 *
 *   crmUrl            https address of the CRM's main application (the agent only ever makes OUTBOUND requests to it)
 *   codexBin          the Codex CLI executable (default: "codex" from PATH)
 *   model             CODEX_PROSPECT_MODEL: a model your plan supports; empty = Codex's own default
 *   effortQuick/Deep  reasoning effort per mode: low | medium | high
 */
export type AgentConfig = {
  crmUrl: string;
  codexBin: string;
  model: string | null;
  effortQuick: Effort;
  effortDeep: Effort;
  pollSeconds: number;
  /** Allow the public Overpass service as a fallback when the local business data is missing or very old. Off by default. */
  overpassFallback: boolean;
  /** Optional per-kind weights for "Any industry" searches (see osm/categories.ts DEFAULT_PRIORITIES). */
  discoveryPriorities: Partial<Record<Group, number>>;
};
export type Effort = "low" | "medium" | "high";

export const DEFAULT_CONFIG: AgentConfig = { crmUrl: "https://ianverlinden.com", codexBin: "codex", model: null, effortQuick: "medium", effortDeep: "high", pollSeconds: 5, overpassFallback: false, discoveryPriorities: {} };

function priorities(v: unknown): Partial<Record<Group, number>> {
  const out: Partial<Record<Group, number>> = {};
  if (v && typeof v === "object") for (const g of Object.keys(DEFAULT_PRIORITIES) as Group[]) {
    const n = Number((v as Record<string, unknown>)[g]);
    if (Number.isFinite(n) && n >= 0 && n <= 1000) out[g] = n;
  }
  return out;
}

const EFFORTS = new Set<Effort>(["low", "medium", "high"]);
/** Model and binary values end up as process arguments, so they are restricted to harmless characters. */
const SAFE_ARG = /^[A-Za-z0-9._:/\\ -]{1,200}$/;
const SAFE_MODEL = /^[A-Za-z0-9._:-]{1,80}$/;

/** HTTPS only; plain http is allowed solely for a loopback address (local development). */
export function validateCrmUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "That is not a valid address." };
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.hostname.endsWith(".localhost");
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) return { ok: false, error: "The CRM address must start with https:// (http:// is only allowed for localhost)." };
  if (u.username || u.password) return { ok: false, error: "The address cannot contain a username or password." };
  return { ok: true, url: u.origin };
}

export function loadConfig(home = agentHome(), env: Record<string, string | undefined> = process.env): AgentConfig {
  let file: Partial<Record<keyof AgentConfig, unknown>> = {};
  const path = join(home, "config.json");
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      /* a broken file falls back to the defaults; `setup` rewrites it */
    }
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const url = validateCrmUrl(str(env.PROSPECT_AGENT_URL) ?? str(file.crmUrl) ?? DEFAULT_CONFIG.crmUrl);
  const bin = str(env.CODEX_BIN) ?? str(file.codexBin) ?? DEFAULT_CONFIG.codexBin;
  const model = str(env.CODEX_PROSPECT_MODEL) ?? str(file.model);
  const effort = (v: unknown, fallback: Effort): Effort => (typeof v === "string" && EFFORTS.has(v as Effort) ? (v as Effort) : fallback);
  const poll = Number(env.PROSPECT_AGENT_POLL_SECONDS ?? file.pollSeconds);
  return {
    crmUrl: url.ok ? url.url : DEFAULT_CONFIG.crmUrl,
    codexBin: SAFE_ARG.test(bin) ? bin : DEFAULT_CONFIG.codexBin,
    model: model && SAFE_MODEL.test(model) ? model : null,
    effortQuick: effort(env.CODEX_PROSPECT_EFFORT_QUICK ?? file.effortQuick, DEFAULT_CONFIG.effortQuick),
    effortDeep: effort(env.CODEX_PROSPECT_EFFORT_DEEP ?? file.effortDeep, DEFAULT_CONFIG.effortDeep),
    pollSeconds: Number.isFinite(poll) && poll >= 2 && poll <= 120 ? poll : DEFAULT_CONFIG.pollSeconds,
    overpassFallback: env.PROSPECT_AGENT_OVERPASS_FALLBACK ? env.PROSPECT_AGENT_OVERPASS_FALLBACK === "1" : file.overpassFallback === true,
    discoveryPriorities: priorities(file.discoveryPriorities),
  };
}

export function saveConfig(patch: Partial<AgentConfig>, home = agentHome()): void {
  mkdirSync(home, { recursive: true });
  const path = join(home, "config.json");
  let current: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      /* overwritten below */
    }
  }
  writeFileSync(path, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}

/** Quick Find thinks less than a Deep Find; everything else follows Deep. */
export const effortFor = (config: AgentConfig, mode: string): Effort => (mode === "quick" ? config.effortQuick : config.effortDeep);
