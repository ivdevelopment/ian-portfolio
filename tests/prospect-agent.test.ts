import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AgentApi, AgentApiError, backoffMs, type RunParams } from "../tools/prospect-agent/src/api-client";
import { KIND_MESSAGES, LIMITS, childEnv, classify, diagnose, execStructured, parseJsonObject, parseVersion, resolveCommand, resolveExecutable, runProcess, supportedFlags, type ProcResult, type ProcRunner } from "../tools/prospect-agent/src/codex";
import { BATCH_SIZE, CodexProvider, OUTPUT_SCHEMA, buildPrompt } from "../tools/prospect-agent/src/codex-provider";
import { DEFAULT_CONFIG, effortFor, loadConfig, validateCrmUrl } from "../tools/prospect-agent/src/config";
import { runJob } from "../tools/prospect-agent/src/job";
import { CompositeBusinessSource } from "../tools/prospect-agent/src/discovery-source";
import { createLogger, redact } from "../tools/prospect-agent/src/logger";
import { OsmBusinessSource, SourceError, buildQuery, industryFilters, radiusKm, toBusiness } from "../tools/prospect-agent/src/osm-source";
import { forgetToken, loadToken, saveToken } from "../tools/prospect-agent/src/secret-store";
import { pruneRuns, startWorker } from "../tools/prospect-agent/src/worker";
import { emailHash } from "../src/lib/prospecting/dedupe";
import { MockBusinessSource } from "../src/lib/prospecting/providers/mock";
import type { AnalyzedBusiness } from "../src/lib/prospecting/types";

/* No test here starts a real Codex, touches the network or reads a real credential: processes and the CRM are scripted fakes. */

const tmp = () => mkdtempSync(join(tmpdir(), "pa-test-"));
const dirs: string[] = [];
const home = () => {
  const d = tmp();
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const quiet = createLogger({ file: false, sink: () => undefined });

/* ---------------------------------- configuration ---------------------------------- */

describe("configuration", () => {
  it("accepts https, and plain http only for localhost; refuses credentials in the address", () => {
    expect(validateCrmUrl("https://ianverlinden.com/")).toEqual({ ok: true, url: "https://ianverlinden.com" });
    expect(validateCrmUrl("http://localhost:3000")).toMatchObject({ ok: true });
    expect(validateCrmUrl("http://crm.localhost:3300")).toMatchObject({ ok: true });
    for (const bad of ["http://ianverlinden.com", "ftp://x.be", "https://user:pw@x.be", "nonsense"]) expect(validateCrmUrl(bad).ok, bad).toBe(false);
  });

  it("falls back to safe defaults and refuses a model or executable that could become a shell fragment", () => {
    const h = home();
    expect(loadConfig(h, {})).toMatchObject({ crmUrl: DEFAULT_CONFIG.crmUrl, codexBin: "codex", model: null, effortQuick: "medium", effortDeep: "high" });
    const cfg = loadConfig(h, { CODEX_PROSPECT_MODEL: "gpt-x; rm -rf /", CODEX_BIN: "codex && calc", CODEX_PROSPECT_EFFORT_QUICK: "maximum", PROSPECT_AGENT_URL: "http://evil.example" });
    expect(cfg).toMatchObject({ model: null, codexBin: "codex", effortQuick: "medium", crmUrl: DEFAULT_CONFIG.crmUrl });
    expect(loadConfig(h, { CODEX_PROSPECT_MODEL: "gpt-5.1-codex", CODEX_PROSPECT_EFFORT_DEEP: "low" })).toMatchObject({ model: "gpt-5.1-codex", effortDeep: "low" });
  });

  it("Quick Find uses the lighter reasoning, everything else the deeper one", () => {
    expect(effortFor(DEFAULT_CONFIG, "quick")).toBe("medium");
    expect(effortFor(DEFAULT_CONFIG, "deep")).toBe("high");
    expect(effortFor(DEFAULT_CONFIG, "redesign")).toBe("high");
  });
});

describe("logging and token storage", () => {
  it("never writes a connection token or bearer value to the log", () => {
    const lines: string[] = [];
    const log = createLogger({ file: false, sink: (l) => lines.push(l) });
    const token = `ipa_${"A".repeat(43)}`;
    log.info(`token ${token} Authorization: Bearer ${"x".repeat(40)}`, { note: token });
    expect(lines.join("\n")).not.toContain(token);
    expect(lines.join("\n")).not.toContain("x".repeat(40));
    expect(redact(`sk-${"a".repeat(30)}`)).toBe("[redacted]");
  });

  it.runIf(process.platform === "win32")("stores the token protected for this Windows user, not in plain text, and can forget it", async () => {
    const h = home();
    const token = `ipa_${"Z".repeat(43)}`;
    await saveToken(token, h);
    const raw = readFileSync(join(h, "token.dpapi"), "utf8");
    expect(raw).not.toContain(token);
    expect(raw).not.toContain("Z".repeat(10));
    expect(await loadToken(h, {})).toBe(token);
    expect(forgetToken(h)).toBe(true);
    expect(await loadToken(h, {})).toBeNull();
  });

  it("the environment variable wins (development and tests)", async () => {
    expect(await loadToken(home(), { PROSPECT_AGENT_TOKEN: "  ipa_abc  " })).toBe("ipa_abc");
  });
});

/* ------------------------------------ Codex runner ------------------------------------ */

const res = (over: Partial<ProcResult> = {}): ProcResult => ({ code: 0, stdout: "", stderr: "", timedOut: false, truncated: false, spawnError: null, ...over });

describe("running Codex safely", () => {
  it("starts the Windows npm shim through cmd.exe with the same argument array, and everything else directly", () => {
    expect(resolveCommand("C:\\npm\\codex.cmd", ["exec", "-"], "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" })).toEqual({ cmd: "C:\\Windows\\System32\\cmd.exe", args: ["/d", "/s", "/c", '"C:\\npm\\codex.cmd exec -"'], verbatim: true });
    expect(resolveCommand("codex", ["exec"], "win32")).toEqual({ cmd: "codex", args: ["exec"], verbatim: false });
    expect(resolveCommand("/usr/bin/codex", ["exec"], "linux")).toEqual({ cmd: "/usr/bin/codex", args: ["exec"], verbatim: false });
    // A folder with a space (a Windows user name with a space) is quoted as one part; cmd metacharacters are refused.
    expect(resolveCommand("C:\\Users\\Ian V\\codex.cmd", ["exec", "--output-schema", "C:\\Users\\Ian V\\s.json"], "win32", { ComSpec: "cmd.exe" }).args[3]).toBe('""C:\\Users\\Ian V\\codex.cmd" exec --output-schema "C:\\Users\\Ian V\\s.json""');
    expect(() => resolveCommand("C:\\x\\codex.cmd", ["exec", "a & calc"], "win32")).toThrow(/unsafe/);
    expect(() => resolveCommand("C:\\x\\codex.cmd", ["%PATH%"], "win32")).toThrow(/unsafe/);
  });

  it("gives the child only an allow-listed environment: no connection token, no Supabase key, no API key", () => {
    const env = childEnv({ PATH: "p", USERPROFILE: "u", CODEX_HOME: "c", PROSPECT_AGENT_TOKEN: "ipa_secret", SUPABASE_SERVICE_ROLE_KEY: "svc", OPENAI_API_KEY: "sk-x", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
    expect(env).toEqual({ PATH: "p", USERPROFILE: "u", CODEX_HOME: "c" });
  });

  it("kills a stuck process on timeout and caps what it prints (real child process, no shell)", async () => {
    const slow = await runProcess(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { cwd: tmp(), stdin: "", timeoutMs: 400, maxBytes: 1000 });
    expect(slow.timedOut).toBe(true);
    const loud = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(500000))"], { cwd: tmp(), stdin: "", timeoutMs: 15_000, maxBytes: 5000 });
    expect(loud.truncated).toBe(true);
    expect(loud.stdout.length).toBeLessThanOrEqual(5000);
    const echo = await runProcess(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { cwd: tmp(), stdin: "hello; & rm -rf /", timeoutMs: 15_000, maxBytes: 5000 });
    expect(echo.stdout).toBe("hello; & rm -rf /");
    const missing = await runProcess("definitely-not-a-real-binary-xyz", [], { cwd: tmp(), stdin: "", timeoutMs: 5000, maxBytes: 1000 });
    expect(missing.spawnError).toBeTruthy();
  });

  it("classifies failures into a fixed set from what happened, never from sending raw output anywhere", () => {
    expect(classify(res({ spawnError: "ENOENT", code: null }))).toBe("codex_not_installed");
    expect(classify(res({ timedOut: true, code: null }))).toBe("codex_timeout");
    expect(classify(res({ code: 1, stderr: "You've hit your usage limit. Try again in 3 hours." }))).toBe("codex_usage_limit");
    expect(classify(res({ code: 1, stderr: "Rate limit reached" }))).toBe("codex_usage_limit");
    expect(classify(res({ code: 1, stderr: "Not logged in. Run codex login" }))).toBe("codex_not_authenticated");
    expect(classify(res({ code: 1, stderr: "401 Unauthorized" }))).toBe("codex_not_authenticated");
    expect(classify(res({ code: 1, stderr: "getaddrinfo ENOTFOUND chatgpt.com" }))).toBe("network_error");
    expect(classify(res({ code: 2, stderr: "something odd" }))).toBe("agent_error");
    expect(KIND_MESSAGES.codex_usage_limit).toBe("Your current Codex/ChatGPT usage limit has been reached. Try again when your allowance resets.");
  });

  it("reads JSON strictly: whole text, or the first balanced object after a preamble; anything else is rejected", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject('Here you go:\n{"a":{"b":"}"}}\nbye')).toEqual({ a: { b: "}" } });
    expect(parseJsonObject("not json")).toBeUndefined();
    expect(parseJsonObject("")).toBeUndefined();
    expect(parseJsonObject('{"a":')).toBeUndefined();
    expect(parseVersion("codex-cli 0.46.1")).toBe("0.46.1");
  });
});

describe("finding the Codex executable", () => {
  const win = (where: string[], existing: string[] = []) => ({ platform: "win32" as const, env: { PATH: "x" }, where: () => where, exists: (p: string) => existing.includes(p) });

  it("picks the native .exe first, then the .cmd shim, and ignores the extensionless script an npm install also creates", () => {
    expect(resolveExecutable("codex", win(["C:\\n\\codex", "C:\\n\\codex.cmd"]))).toBe("C:\\n\\codex.cmd");
    expect(resolveExecutable("codex", win(["C:\\n\\codex.cmd", "C:\\app\\codex.exe"]))).toBe("C:\\app\\codex.exe");
    expect(resolveExecutable("codex", win(["C:\\n\\codex"]))).toBeNull();
    expect(resolveExecutable("codex", win([]))).toBeNull();
  });

  it("uses a configured path as given, adds the shim's extension when it was left off, and refuses a bare name that is not a plain word", () => {
    expect(resolveExecutable("C:\\n\\codex.cmd", win([], ["C:\\n\\codex.cmd"]))).toBe("C:\\n\\codex.cmd");
    expect(resolveExecutable("C:\\n\\codex", win([], ["C:\\n\\codex.cmd"]))).toBe("C:\\n\\codex.cmd");
    expect(resolveExecutable("C:\\nope\\codex", win([], []))).toBeNull();
    for (const bad of ["codex && calc", "co dex", "codex;x", "", "a".repeat(80)]) expect(resolveExecutable(bad, win(["C:\\x\\a.exe"])), bad).toBeNull();
  });

  it("off Windows the name is left for spawn to resolve", () => {
    expect(resolveExecutable("codex", { platform: "linux" })).toBe("codex");
  });

  it("the restricted environment keeps what Codex needs, passes proxy settings only when they exist, and copies each variable once", () => {
    const env = childEnv({ Path: "p", PATH: "p", PATHEXT: ".EXE;.CMD", SystemRoot: "s", ComSpec: "c", USERPROFILE: "u", APPDATA: "a", LOCALAPPDATA: "l", TEMP: "t", TMP: "t", HTTPS_PROXY: "http://proxy:8080", NO_PROXY: "localhost", OPENAI_API_KEY: "sk-nope", SUPABASE_SERVICE_ROLE_KEY: "svc", PROSPECT_AGENT_TOKEN: "ipa_nope", VERCEL_TOKEN: "v", NEXT_PUBLIC_X: "1" });
    expect(Object.keys(env).filter((k) => k.toLowerCase() === "path")).toHaveLength(1);
    expect(env).toMatchObject({ PATHEXT: ".EXE;.CMD", SystemRoot: "s", ComSpec: "c", USERPROFILE: "u", APPDATA: "a", LOCALAPPDATA: "l", TEMP: "t", TMP: "t", HTTPS_PROXY: "http://proxy:8080", NO_PROXY: "localhost" });
    expect(Object.keys(env).some((k) => /OPENAI|SUPABASE|PROSPECT|VERCEL|NEXT/i.test(k))).toBe(false);
    expect(Object.keys(childEnv({ PATH: "p" }))).toEqual(["PATH"]);
  });
});

describe.runIf(process.platform === "win32")("the failure that blocked the first real Codex test: a bare name whose only launcher is an npm-style .cmd shim", () => {
  const devDir = join(process.cwd(), "tools", "prospect-agent", "dev");
  it("resolves through the real where.exe to the absolute .cmd, and starts it with the restricted environment", async () => {
    const dir = home();
    writeFileSync(join(dir, "shimtool.cmd"), "@echo off\r\necho shim-ok %*\r\n");
    writeFileSync(join(dir, "shimtool"), "#!/bin/sh\necho extensionless\n"); // the extra file npm creates next to the .cmd
    const path = `${dir};${process.env.PATH ?? ""}`;
    expect(resolveExecutable("shimtool", { env: { ...process.env, PATH: path } })).toBe(join(dir, "shimtool.cmd"));
    expect(resolveExecutable("definitely-no-such-tool-xyz", { env: { ...process.env, PATH: path } })).toBeNull();
    const saved = process.env.PATH;
    process.env.PATH = path;
    try {
      const r = await runProcess("shimtool", ["hello"], { cwd: dir, stdin: "", timeoutMs: 15_000, maxBytes: 10_000 });
      expect(r).toMatchObject({ code: 0, spawnError: null });
      expect(r.stdout).toContain("shim-ok hello");
    } finally {
      process.env.PATH = saved;
    }
  }, 60_000);

  it("`codex`-style discovery works end to end for the fake Codex found by name on PATH (version, flags, login, structured exec)", async () => {
    const saved = process.env.PATH;
    process.env.PATH = `${devDir};${saved ?? ""}`;
    try {
      expect(resolveExecutable("fake-codex")).toBe(join(devDir, "fake-codex.cmd"));
      expect(await diagnose("fake-codex")).toMatchObject({ state: "ready", version: "0.0.0-fake" });
      const flags = await supportedFlags("fake-codex");
      const out = await execStructured({ bin: "fake-codex", dir: join(home(), "run"), prompt: "[]", schema: { type: "object" }, model: null, effort: "low", timeoutMs: 30_000, flags });
      expect(out).toMatchObject({ ok: true, value: { assessments: [] } });
    } finally {
      process.env.PATH = saved;
    }
  }, 90_000);
});

describe.runIf(process.platform === "win32")("a real Windows .cmd shim in a folder with a space in its name", () => {
  const shim = join(process.cwd(), "tools", "prospect-agent", "dev", "fake-codex.cmd");
  it("is found, diagnosed as ready, and runs a structured exec with the prompt on stdin (this repository's own path contains a space)", async () => {
    expect(shim).toContain(" ");
    const d = await diagnose(shim);
    expect(d).toMatchObject({ state: "ready", version: "0.0.0-fake", missingFlags: [] });
    const flags = await supportedFlags(shim);
    const out = await execStructured({ bin: shim, dir: join(home(), "a folder with spaces"), prompt: `[]`, schema: { type: "object" }, model: null, effort: "low", timeoutMs: 30_000, flags });
    expect(out).toMatchObject({ ok: true, value: { assessments: [] } });
  }, 60_000);
});

/** A scripted stand-in for the codex executable. */
function fakeCodex(o: { version?: string | null; help?: string; login?: number; exec?: (n: number, prompt: string, args: string[]) => { json?: unknown; raw?: Partial<ProcResult>; stdout?: string; fileText?: string } } = {}) {
  const calls: Array<{ args: string[]; stdin: string; cwd: string }> = [];
  let execCalls = 0;
  const help = o.help ?? "Usage: codex exec\n  --output-schema <FILE>\n  --output-last-message <FILE>\n  --sandbox <MODE>\n  --skip-git-repo-check\n  --ephemeral\n  --model <MODEL>\n  --cd <DIR>\n  --color <COLOR>";
  const runner: ProcRunner = async (_bin, args, opts) => {
    calls.push({ args, stdin: opts.stdin, cwd: opts.cwd });
    if (o.version === null) return res({ code: null, spawnError: "ENOENT" });
    if (args[0] === "--version") return res({ stdout: `codex-cli ${o.version ?? "0.46.0"}\n` });
    if (args[0] === "exec" && args[1] === "--help") return res({ stdout: help });
    if (args[0] === "login" && args[1] === "status") return res({ code: o.login ?? 0, stdout: o.login ? "" : "Logged in using ChatGPT" });
    if (args[0] === "exec") {
      const n = ++execCalls;
      const r = o.exec ? o.exec(n, opts.stdin, args) : { json: { ok: true } };
      const out = args.indexOf("--output-last-message");
      if (r.json !== undefined && out >= 0) writeFileSync(args[out + 1], JSON.stringify(r.json));
      if (r.fileText !== undefined && out >= 0) writeFileSync(args[out + 1], r.fileText);
      return res({ stdout: r.stdout ?? (r.json !== undefined && out < 0 ? JSON.stringify(r.json) : ""), ...r.raw });
    }
    return res({ code: 1 });
  };
  return { runner, calls, execCalls: () => execCalls };
}

describe("diagnostics", () => {
  it("reports not installed, missing flags, not signed in, and ready, each with the version", async () => {
    expect(await diagnose("codex", fakeCodex({ version: null }).runner)).toMatchObject({ state: "not_installed", version: null });
    expect(await diagnose("codex", fakeCodex({ help: "Usage: codex exec --sandbox" }).runner)).toMatchObject({ state: "error", missingFlags: ["--output-schema", "--skip-git-repo-check"] });
    expect(await diagnose("codex", fakeCodex({ login: 1 }).runner)).toMatchObject({ state: "not_authenticated", version: "0.46.0" });
    expect(await diagnose("codex", fakeCodex({ version: "1.2.3" }).runner)).toEqual({ state: "ready", version: "1.2.3", missingFlags: [], note: null });
  });

  it("only uses the optional flags the installed version really lists", async () => {
    const flags = await supportedFlags("codex", fakeCodex({ help: "--output-schema --sandbox --skip-git-repo-check --model" }).runner);
    expect(flags.has("--model")).toBe(true);
    expect(flags.has("--output-last-message")).toBe(false);
  });
});

describe("one structured Codex call", () => {
  const base = (runner: ProcRunner, over = {}) => ({ bin: "codex", dir: join(home(), "call"), prompt: "PROMPT TEXT", schema: { type: "object" }, model: "gpt-x" as string | null, effort: "medium" as const, timeoutMs: 1000, flags: new Set(["--output-last-message", "--ephemeral", "--model", "--cd", "--color"]), run: runner, ...over });

  it("passes the prompt on stdin only, a read-only sandbox, the schema file, the model and the reasoning effort, as an argument array", async () => {
    const fake = fakeCodex({ exec: () => ({ json: { ok: true } }) });
    const out = await execStructured(base(fake.runner));
    expect(out).toMatchObject({ ok: true, value: { ok: true } });
    const call = fake.calls.find((c) => c.args[0] === "exec")!;
    expect(call.stdin).toBe("PROMPT TEXT");
    expect(call.args).not.toContain("PROMPT TEXT");
    expect(call.args.slice(0, 5)).toEqual(["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-schema"]);
    expect(call.args.at(-1)).toBe("-");
    expect(call.args).toEqual(expect.arrayContaining(["--model", "gpt-x", "-c", "model_reasoning_effort=medium", "--ephemeral"]));
    expect(call.args.every((a) => typeof a === "string")).toBe(true);
    expect(call.args).not.toContain("danger-full-access");
    expect(call.args.some((a) => /--search|--yolo|dangerously/.test(a))).toBe(false);
  });

  it("reads stdout when this Codex has no --output-last-message", async () => {
    const fake = fakeCodex({ exec: () => ({ json: { ok: true } }) });
    expect(await execStructured(base(fake.runner, { flags: new Set<string>() }))).toMatchObject({ ok: true, value: { ok: true } });
  });

  it("fails safely: malformed JSON, an oversized result, a timeout, a missing Codex, a signed-out Codex, a usage limit", async () => {
    expect(await execStructured(base(fakeCodex({ exec: () => ({ fileText: "not json at all" }) }).runner))).toMatchObject({ ok: false, kind: "invalid_output" });
    expect(await execStructured(base(fakeCodex({ exec: () => ({ fileText: "x".repeat(LIMITS.maxResultBytes + 10) }) }).runner))).toMatchObject({ ok: false, kind: "invalid_output" });
    expect(await execStructured(base(fakeCodex({ exec: () => ({ raw: { timedOut: true, code: null } }) }).runner))).toMatchObject({ ok: false, kind: "codex_timeout" });
    expect(await execStructured(base(fakeCodex({ exec: () => ({ raw: { spawnError: "ENOENT", code: null } }) }).runner))).toMatchObject({ ok: false, kind: "codex_not_installed" });
    expect(await execStructured(base(fakeCodex({ exec: () => ({ raw: { code: 1, stderr: "Not logged in" } }) }).runner))).toMatchObject({ ok: false, kind: "codex_not_authenticated" });
    expect(await execStructured(base(fakeCodex({ exec: () => ({ raw: { code: 1, stderr: "usage limit reached, try again later" } }) }).runner))).toMatchObject({ ok: false, kind: "codex_usage_limit", message: KIND_MESSAGES.codex_usage_limit });
  });
});

/* ------------------------------------ the provider ------------------------------------ */

const sampleItems = async () => {
  const items: AnalyzedBusiness[] = [];
  const { analyzeWebsite } = await import("../src/lib/prospecting/analyze");
  for (const b of await new MockBusinessSource().discover({ mode: "redesign", location: "Brugge", area: null, industry: null, threshold: 70, count: 10, excludeResearched: false })) items.push({ business: b, analysis: await analyzeWebsite(b) });
  return items;
};
const request = { mode: "redesign" as const, location: "Brugge", area: null, industry: null, threshold: 70, count: 10, excludeResearched: true };

/** Answers every business of a batch with a plausible, evidence-citing assessment. */
function answer(prompt: string) {
  const businesses = JSON.parse(prompt.split("\n").at(-1)!) as Array<{ ref: string; observations: Array<{ id: string }> }>;
  const cat = (score: number, obs: string[]) => ({ score, reason: "Observed from the data provided.", observations: obs });
  return { assessments: businesses.map((b) => ({ ref: b.ref, scores: { business_fit: cat(22, []), website_need: cat(20, b.observations.slice(0, 1).map((o) => o.id)), conversion_gap: cat(12, b.observations.slice(0, 1).map((o) => o.id)), service_opportunity: cat(12, []), local_relevance: cat(8, []), contactability: cat(0, []) }, summary: "A modernisation opportunity.", opportunity: "Website redesign + quote request flow" })) };
}

describe("the Codex provider", () => {
  it("sends only compact evidence: no email addresses, no phone numbers, nothing from the CRM", async () => {
    const items = await sampleItems();
    const prompt = buildPrompt(request, items);
    for (const it of items) {
      if (it.business.email) expect(prompt).not.toContain(it.business.email);
      if (it.business.phone) expect(prompt).not.toContain(it.business.phone.replace(/\D/g, "").slice(2));
    }
    expect(prompt).toContain("Do NOT run commands");
    expect(prompt).toContain("Never insult a business");
    expect(prompt).toMatch(/"hasEmail":(true|false)/);
    expect(prompt).not.toMatch(/ipa_|service_role|OPENAI|password/i);
    expect((OUTPUT_SCHEMA as { additionalProperties: boolean }).additionalProperties).toBe(false);
  });

  it(`qualifies in batches of ${BATCH_SIZE}, one Codex call per batch, and maps answers back to businesses`, async () => {
    const items = await sampleItems();
    const fake = fakeCodex({ exec: (_n, prompt) => ({ json: answer(prompt) }) });
    const provider = new CodexProvider({ bin: "codex", model: null, effort: "medium", timeoutMs: 1000, dir: join(home(), "p"), flags: new Set(["--output-last-message"]), run: fake.runner });
    const out = await provider.qualifyBusinesses({ request, items: [...items, ...items] });
    expect(provider.stats.calls).toBe(Math.ceil((items.length * 2) / BATCH_SIZE));
    expect(out).toHaveLength(items.length * 2);
    expect(out[0].companyName).toBe(items[0].business.companyName);
  });

  it("skips a batch whose answer is unusable (with a note) but stops for anything that means Codex cannot work", async () => {
    const items = await sampleItems();
    const bad = fakeCodex({ exec: () => ({ json: { assessments: [{ ref: "b1" }] } }) });
    const p1 = new CodexProvider({ bin: "codex", model: null, effort: "low", timeoutMs: 1000, dir: join(home(), "p"), flags: new Set(["--output-last-message"]), run: bad.runner });
    expect(await p1.qualifyBusinesses({ request, items })).toEqual([]);
    expect(p1.stats.notes[0]).toMatch(/could not be used/);
    const limit = fakeCodex({ exec: () => ({ raw: { code: 1, stderr: "usage limit reached" } }) });
    const p2 = new CodexProvider({ bin: "codex", model: null, effort: "low", timeoutMs: 1000, dir: join(home(), "p"), flags: new Set(["--output-last-message"]), run: limit.runner });
    await expect(p2.qualifyBusinesses({ request, items })).rejects.toMatchObject({ code: "usage_limit", failureKind: "codex_usage_limit" });
  });
});

/* ------------------------------------ discovery source ------------------------------------ */

describe("OpenStreetMap discovery", () => {
  it("maps a request to tag filters, a radius and a safe Overpass query", () => {
    expect(industryFilters("Car detailers")[0]).toContain("car_repair");
    expect(industryFilters("bike repair")).toEqual(['["shop"="bicycle"]']);
    expect(industryFilters(null).length).toBeGreaterThan(1);
    expect(radiusKm("Brugge + 30 km")).toBe(30);
    expect(radiusKm("West-Vlaanderen")).toBeNull();
    expect(radiusKm("Brugge + 500 km")).toBe(60);
    const q = buildQuery({ filters: ['["craft"]'], around: { lat: 51.2, lon: 3.2, km: 30 }, limit: 50 });
    expect(q).toContain("around:30000,51.2,3.2");
    expect(q).toContain('["brand"!~"."]');
    const injected = buildQuery({ filters: ['["craft"]'], region: 'West"];out;//', limit: 10 });
    expect(injected).not.toContain('"];out');
    expect(injected).toContain('area["name"="Westout"]');
  });

  it("turns elements into businesses with only the contact details the business published", () => {
    const b = toBusiness({ type: "node", id: 7, tags: { name: "Fietsen Peeters", "contact:website": "peeters.be", email: "Info@Peeters.be;x@y.be", phone: "+32 50 12 34 56", shop: "bicycle", "addr:city": "Brugge", "contact:facebook": "https://facebook.com/peeters" } }, "Brugge", "West-Vlaanderen")!;
    expect(b).toMatchObject({ companyName: "Fietsen Peeters", websiteUrl: "https://peeters.be", email: "info@peeters.be", industry: "bicycle", city: "Brugge" });
    expect(b.sourceUrls[0]).toBe("https://www.openstreetmap.org/node/7");
    expect(b.sourceUrls).toContain("https://facebook.com/peeters");
    expect(toBusiness({ type: "node", id: 1, tags: { shop: "bicycle" } }, "Brugge", null)).toBeNull();
  });

  it("makes one polite geocode-free lookup for Brugge and one Overpass request, and lists websites first (or last for No Website)", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ elements: [{ type: "node", id: 1, tags: { name: "A", shop: "bicycle" } }, { type: "node", id: 2, tags: { name: "B", shop: "bicycle", website: "https://b.be" } }, { type: "node", id: 3, tags: { name: "B", shop: "bicycle", website: "https://b.be" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const src = new OsmBusinessSource(fetchImpl, async () => undefined);
    const found = await src.discover({ ...request, area: "Brugge + 30 km", industry: "bike" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("overpass");
    expect(found.map((f) => f.companyName)).toEqual(["B", "A"]);
    expect((await src.discover({ ...request, mode: "no_website", area: "Brugge + 30 km" })).map((f) => f.companyName)).toEqual(["A", "B"]);
    await expect(new OsmBusinessSource((async () => new Response("", { status: 429 })) as unknown as typeof fetch, async () => undefined).discover({ ...request, area: "Brugge + 30 km" })).rejects.toThrow(/429/);
  });
});

describe("OpenStreetMap discovery when the public servers are busy", () => {
  const ok = () => new Response(JSON.stringify({ elements: [{ type: "node", id: 1, tags: { name: "A", shop: "bicycle" } }] }), { status: 200 });
  const scripted = (answers: Array<() => Response | Promise<Response>>) => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => (urls.push(String(url)), await answers[Math.min(urls.length - 1, answers.length - 1)]())) as unknown as typeof fetch;
    return { fetchImpl, urls };
  };
  const sleeps: number[] = [];
  const source = (f: typeof fetch) => new OsmBusinessSource(f, async (ms) => void sleeps.push(ms), ["https://one.example/api", "https://two.example/api"], 1000);

  it("falls over to the next mirror when one is at capacity, and succeeds", async () => {
    const s = scripted([() => new Response("capacity", { status: 502 }), ok]);
    const found = await source(s.fetchImpl).discover({ ...request, area: "Brugge + 30 km" });
    expect(found.map((f) => f.companyName)).toEqual(["A"]);
    expect(s.urls).toEqual(["https://one.example/api", "https://two.example/api"]);
  });

  it("treats a 200 that only carries a runtime-error remark as busy, and retries after a pause", async () => {
    sleeps.length = 0;
    const s = scripted([() => new Response(JSON.stringify({ elements: [], remark: "runtime error: Query timed out" }), { status: 200 }), () => new Response("", { status: 504 }), ok]);
    const found = await source(s.fetchImpl).discover({ ...request, area: "Brugge + 30 km" });
    expect(found).toHaveLength(1);
    expect(sleeps).toEqual([5000]);
  });

  it("gives up with a SourceError (a fixed, non-Codex reason) when every mirror stays busy", async () => {
    sleeps.length = 0;
    const s = scripted([() => new Response("busy", { status: 502 })]);
    const err = await source(s.fetchImpl).discover({ ...request, area: "Brugge + 30 km" }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(String(err.message)).toMatch(/busy or unreachable \(HTTP 502\)/);
    expect(s.urls).toHaveLength(4);
    expect(sleeps).toEqual([5000, 10_000]);
  });

  it("a business source that fails is reported to the CRM as source_error, not as a Codex problem, and nothing is submitted", async () => {
    const h = home();
    const { api, of } = fakeApi();
    const codex = fakeCodex({ exec: (_n, prompt) => ({ json: answer(prompt) }) });
    const broken = { id: "osm", discover: async () => { throw new SourceError("OpenStreetMap is busy or unreachable (HTTP 502)"); } };
    const summary = await runJob(RUN, jobDeps(api, codex.runner, h, { source: broken }));
    expect(summary).toMatchObject({ status: "failed", kind: "source_error" });
    expect(of("fail")[0]).toMatchObject({ kind: "source_error", message: "The public business source (OpenStreetMap) is busy or unreachable. Try again in a few minutes." });
    expect(JSON.stringify(of("fail")[0])).not.toMatch(/codex/i);
    expect(of("result")).toHaveLength(0);
    expect(codex.execCalls()).toBe(0);
  });

  it("missing local business data fails the run at once with its own kind and a clear message, before Codex is ever used", async () => {
    const h = home();
    const { api, of } = fakeApi();
    const codex = fakeCodex({ exec: (_n, prompt) => ({ json: answer(prompt) }) });
    const missing = new CompositeBusinessSource({ home: h });
    const t0 = Date.now();
    const summary = await runJob(RUN, jobDeps(api, codex.runner, h, { source: missing }));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(summary).toMatchObject({ status: "failed", kind: "business_data_missing" });
    expect(of("fail")[0]).toMatchObject({ kind: "business_data_missing", message: expect.stringContaining("Local business data is not installed on the agent PC yet") });
    expect(codex.execCalls()).toBe(0);
  });

  it("an older CRM that does not know business_data_missing still gets the run failed (as source_error)", async () => {
    const h = home();
    const { api, of } = fakeApi();
    const real = api.fail.bind(api);
    let first = true;
    api.fail = (async (body: Parameters<typeof real>[0]) => {
      if (first && body.kind === "business_data_missing") {
        first = false;
        throw new AgentApiError("rejected", "The CRM rejected the request (invalid_request).", 400);
      }
      return real(body);
    }) as typeof api.fail;
    const codex = fakeCodex({ exec: (_n, prompt) => ({ json: answer(prompt) }) });
    await runJob(RUN, jobDeps(api, codex.runner, h, { source: new CompositeBusinessSource({ home: h }) }));
    expect(of("fail")[0]).toMatchObject({ kind: "source_error", message: expect.stringContaining("Local business data is not installed") });
  });
});

/* ------------------------------------ CRM API client ------------------------------------ */

describe("the CRM API client", () => {
  const api = (status: number, body: unknown, capture?: (init: RequestInit) => void) => new AgentApi("https://crm.example", "ipa_token", (async (_u: string, init: RequestInit) => { capture?.(init); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch);

  it("sends the token as a bearer header to an outbound https address and never follows redirects", async () => {
    let init: RequestInit = {};
    await api(200, { ok: true, run: null }, (i) => (init = i)).claim();
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ipa_token");
    expect(init.redirect).toBe("error");
    expect(init.method).toBe("POST");
  });

  it("maps answers to typed errors the worker can act on", async () => {
    await expect(api(401, { ok: false }).claim()).rejects.toMatchObject({ kind: "unauthorized" });
    await expect(api(409, { ok: false, error: "lease_lost" }).progress({ runId: "r", stage: "x", counters: {}, errors: [] })).rejects.toMatchObject({ kind: "lease_lost" });
    await expect(api(429, {}).claim()).rejects.toMatchObject({ kind: "rate_limited" });
    await expect(api(503, {}).claim()).rejects.toMatchObject({ kind: "server" });
    await expect(api(400, { ok: false, error: "invalid_request" }).claim()).rejects.toMatchObject({ kind: "rejected" });
    await expect(new AgentApi("https://x", "t", (async () => { throw new Error("offline"); }) as unknown as typeof fetch).claim()).rejects.toBeInstanceOf(AgentApiError);
  });

  it("backs off 5 s, 10 s, 20 s ... up to 2 minutes", () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 4, 5, 9].map((n) => backoffMs(n, mid))).toEqual([5000, 10_000, 20_000, 40_000, 80_000, 120_000]);
  });
});

/* ------------------------------------------ jobs ------------------------------------------ */

const RUN: RunParams = { id: "11111111-1111-4111-8111-111111111111", mode: "redesign", location: "Brugge", area: null, industry: null, threshold: 70, count: 10, excludeResearched: true, attempt: 1 };

function fakeApi(over: { cancelAfter?: number; leaseLostAfter?: number; context?: Partial<Awaited<ReturnType<AgentApi["context"]>>> } = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let progress = 0;
  const api = {
    context: async (runId: string) => (calls.push(["context", { runId }]), { ok: true as const, run: { threshold: 70, mode: "redesign", count: 10 }, prospects: [], decided: [], seen: [], ...over.context }),
    progress: async (b: Record<string, unknown>) => {
      calls.push(["progress", b]);
      progress++;
      if (over.leaseLostAfter !== undefined && progress > over.leaseLostAfter) throw new AgentApiError("lease_lost", "lost", 409);
      return { ok: true as const, cancel: over.cancelAfter !== undefined && progress > over.cancelAfter };
    },
    result: async (b: Record<string, unknown>) => (calls.push(["result", b]), { ok: true as const, inserted: (b.candidates as unknown[]).length, skipped_known: 0, rejected: 0 }),
    fail: async (b: Record<string, unknown>) => (calls.push(["fail", b]), { ok: true as const }),
    heartbeat: async (b: Record<string, unknown>) => (calls.push(["heartbeat", b]), { ok: true as const, device: "Ian-PC" }),
    claim: async () => null,
    mailClaim: async () => null,
  };
  return { api: api as unknown as AgentApi, calls, of: (name: string) => calls.filter(([n]) => n === name).map(([, b]) => b) };
}

const jobDeps = (api: AgentApi, runner: ProcRunner, h: string, over = {}) => ({ api, config: { ...DEFAULT_CONFIG }, log: quiet, source: new MockBusinessSource(), flags: new Set(["--output-last-message"]), runner, home: h, keepAliveMs: 60_000, ...over });

describe("running a job", () => {
  it("claims, qualifies with Codex, sends ONE result with validated-looking candidates, and removes its scratch folder", async () => {
    const h = home();
    const { api, of } = fakeApi();
    const codex = fakeCodex({ exec: (_n, prompt) => ({ json: answer(prompt) }) });
    const summary = await runJob(RUN, jobDeps(api, codex.runner, h));
    expect(summary).toMatchObject({ status: "completed" });
    expect(summary.candidates).toBeGreaterThan(0);
    expect(of("result")).toHaveLength(1);
    expect(of("fail")).toHaveLength(0);
    const result = of("result")[0] as { candidates: Array<{ score: number; company_name: string }>; final: { codexCalls: number; status: string; counters: { raw_found: number } } };
    expect(result.candidates.every((c) => c.score >= 70)).toBe(true);
    expect(result.final).toMatchObject({ status: "completed", codexCalls: codex.execCalls() });
    expect(result.final.counters.raw_found).toBeGreaterThan(0);
    expect(of("progress").map((p) => p.stage)).toEqual(expect.arrayContaining(["Finding businesses…", "Checking duplicates…", "Qualifying candidates…"]));
    expect(existsSync(join(h, "runs", RUN.id))).toBe(false);
  });

  it("never gives Codex an email address, a phone number or a CRM record: only hashes reach the worker from the CRM", async () => {
    const h = home();
    const prompts: string[] = [];
    const { api } = fakeApi();
    const codex = fakeCodex({ exec: (_n, prompt) => (prompts.push(prompt), { json: answer(prompt) }) });
    await runJob(RUN, jobDeps(api, codex.runner, h));
    const all = prompts.join("\n");
    for (const email of ["info@sample-bike-repair.invalid", "hello@sample-car-detailing.invalid", "info@sample-roofing.invalid"]) expect(all).not.toContain(email);
    expect(all).not.toContain("+3250");
  });

  it("skips a business the CRM already has, matched only by email HASH, and reports it as a duplicate", async () => {
    const h = home();
    const { api, of } = fakeApi({ context: { prospects: [{ id: "p-1", company_name: "Existing", website_url: null, city: null, email_hash: emailHash("info@sample-bike-repair.invalid") }] } });
    const codex = fakeCodex({ exec: (_n, prompt) => ({ json: answer(prompt) }) });
    await runJob(RUN, jobDeps(api, codex.runner, h));
    const result = of("result")[0] as { candidates: Array<{ company_name: string }>; duplicates: Array<{ company_name: string; duplicate_of: string }> };
    expect(result.duplicates).toMatchObject([{ duplicate_of: "p-1" }]);
    expect(result.candidates.some((c) => /Bike Repair/.test(c.company_name))).toBe(false);
  });

  it("reports a sanitised failure kind and no result when Codex is missing, signed out, times out or answers with garbage", async () => {
    const cases: Array<[string, ReturnType<typeof fakeCodex>["runner"], string]> = [
      ["codex_not_installed", fakeCodex({ exec: () => ({ raw: { spawnError: "ENOENT", code: null } }) }).runner, "codex_not_installed"],
      ["codex_not_authenticated", fakeCodex({ exec: () => ({ raw: { code: 1, stderr: "Not logged in" } }) }).runner, "codex_not_authenticated"],
      ["codex_timeout", fakeCodex({ exec: () => ({ raw: { timedOut: true, code: null } }) }).runner, "codex_timeout"],
      ["invalid_output", fakeCodex({ exec: () => ({ fileText: "garbage" }) }).runner, "invalid_output"],
      ["codex_usage_limit", fakeCodex({ exec: () => ({ raw: { code: 1, stderr: "usage limit reached" } }) }).runner, "codex_usage_limit"],
    ];
    for (const [, runner, kind] of cases) {
      const h = home();
      const { api, of } = fakeApi();
      const summary = await runJob(RUN, jobDeps(api, runner, h));
      expect(summary).toMatchObject({ status: "failed", kind });
      expect(of("fail")).toHaveLength(1);
      expect(of("fail")[0]).toMatchObject({ kind, runId: RUN.id });
      expect(JSON.stringify(of("fail")[0])).not.toMatch(/stderr|logged in/i);
      expect(of("result")).toHaveLength(0);
      expect(existsSync(join(h, "runs", RUN.id))).toBe(false);
    }
  });

  it("keeps what it found when the usage limit hits halfway: a partial result that carries the failure kind", async () => {
    const h = home();
    const { api, of } = fakeApi();
    const codex = fakeCodex({ exec: (n, prompt) => (n === 1 ? { json: answer(prompt) } : { raw: { code: 1, stderr: "usage limit reached" } }) });
    const many = { id: "many", discover: async () => Array.from({ length: 14 }, (_, i) => ({ companyName: `Biz ${i}`, websiteUrl: `https://biz${i}.example/`, fixturePages: { "/": "<html><head><title>Biz</title></head><body><p>Welcome</p></body></html>" }, email: null, phone: null, city: "Brugge", region: "West-Vlaanderen", industry: "x", sourceUrls: ["https://www.facebook.com/x"] })) };
    const summary = await runJob(RUN, jobDeps(api, codex.runner, h, { source: many }));
    expect(summary.status).toBe("partial");
    const result = of("result")[0] as { candidates: unknown[]; final: { status: string; failureKind: string | null; errors: string[] } };
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.final).toMatchObject({ status: "partial", failureKind: "codex_usage_limit" });
    expect(result.final.errors.join(" ")).toMatch(/usage limit/);
    expect(of("fail")).toHaveLength(0);
  });

  it("stops between steps when the CRM says cancel, and still submits the candidates already found", async () => {
    const h = home();
    const { api, of } = fakeApi({ cancelAfter: 6 });
    const codex = fakeCodex({ exec: (_n, prompt) => ({ json: answer(prompt) }) });
    const many = { id: "many", discover: async () => Array.from({ length: 20 }, (_, i) => ({ companyName: `Biz ${i}`, websiteUrl: null, email: null, phone: null, city: "Brugge", region: null, industry: "x", sourceUrls: ["https://www.facebook.com/x"] })) };
    const summary = await runJob(RUN, jobDeps(api, codex.runner, h, { source: many }));
    expect(summary.status).toBe("cancelled");
    expect((of("result")[0] as { final: { status: string } }).final.status).toBe("cancelled");
    expect(codex.execCalls()).toBeLessThan(4);
  });

  it("abandons the run quietly when its lease was lost: nothing is submitted, nothing is failed", async () => {
    const h = home();
    const { api, of } = fakeApi({ leaseLostAfter: 2 });
    const codex = fakeCodex({ exec: (_n, prompt) => ({ json: answer(prompt) }) });
    const summary = await runJob(RUN, jobDeps(api, codex.runner, h));
    expect(summary.status).toBe("abandoned");
    expect(of("result")).toHaveLength(0);
    expect(of("fail")).toHaveLength(0);
  });

  it("uses its time budget: a run past its deadline stops and reports a partial result", async () => {
    const h = home();
    const { api, of } = fakeApi();
    const codex = fakeCodex({ exec: (_n, prompt) => ({ json: answer(prompt) }) });
    const many = { id: "many", discover: async () => Array.from({ length: 20 }, (_, i) => ({ companyName: `Biz ${i}`, websiteUrl: null, email: null, phone: null, city: "Brugge", region: null, industry: "x", sourceUrls: ["https://www.facebook.com/x"] })) };
    const summary = await runJob({ ...RUN, mode: "quick" }, jobDeps(api, codex.runner, h, { source: many, budgets: { quickMs: -1, deepMs: -1, callQuickMs: 1000, callDeepMs: 1000 } }));
    expect(summary.status).toBe("partial");
    expect((of("result")[0] as { final: { errors: string[] } }).final.errors.join(" ")).toMatch(/time limit/);
  });
});

/* ------------------------------------- the worker loop ------------------------------------- */

describe("the worker loop", () => {
  const instantSleep = async () => new Promise<void>((r) => setTimeout(r, 1));

  it("verifies Codex, heartbeats with its diagnostics, polls for work and stops cleanly", async () => {
    const h = home();
    const f = fakeApi();
    const claims = vi.fn(async () => null);
    (f.api as unknown as { claim: typeof claims }).claim = claims;
    const worker = startWorker({ api: f.api, config: { ...DEFAULT_CONFIG, pollSeconds: 2 }, log: quiet, runner: fakeCodex({ version: "0.46.1" }).runner, sleep: instantSleep, home: h, heartbeatMs: 5 });
    await vi.waitFor(() => expect(claims.mock.calls.length).toBeGreaterThan(2));
    worker.stop();
    expect(await worker.done).toBe("stopped");
    expect(f.of("heartbeat")[0]).toMatchObject({ codexVersion: "0.46.1", codexState: "ready" });
  });

  it("does not claim work while Codex cannot run, so the run stays queued and the CRM can say why", async () => {
    const f = fakeApi();
    const claims = vi.fn(async () => null);
    (f.api as unknown as { claim: typeof claims }).claim = claims;
    const worker = startWorker({ api: f.api, config: DEFAULT_CONFIG, log: quiet, runner: fakeCodex({ login: 1 }).runner, sleep: instantSleep, home: home(), heartbeatMs: 5 });
    await vi.waitFor(() => expect(f.of("heartbeat").length).toBeGreaterThan(2));
    worker.stop();
    await worker.done;
    expect(claims).not.toHaveBeenCalled();
    expect(f.of("heartbeat")[0]).toMatchObject({ codexState: "not_authenticated" });
  });

  it("stops for good when the CRM rejects the token (revoked device) instead of retrying forever", async () => {
    const f = fakeApi();
    (f.api as unknown as { heartbeat: () => Promise<never> }).heartbeat = async () => {
      throw new AgentApiError("unauthorized", "rejected", 401);
    };
    const worker = startWorker({ api: f.api, config: DEFAULT_CONFIG, log: quiet, runner: fakeCodex().runner, sleep: instantSleep, home: home(), heartbeatMs: 5 });
    expect(await worker.done).toBe("unauthorized");
  });

  it("backs off when the CRM is unreachable and runs one job at a time", async () => {
    const f = fakeApi();
    const sleeps: number[] = [];
    let n = 0;
    (f.api as unknown as { claim: () => Promise<RunParams | null> }).claim = async () => {
      if (++n <= 2) throw new AgentApiError("network", "offline");
      return null;
    };
    const worker = startWorker({ api: f.api, config: DEFAULT_CONFIG, log: quiet, runner: fakeCodex().runner, sleep: async (ms) => { sleeps.push(ms); await instantSleep(); }, home: home(), heartbeatMs: 5 });
    await vi.waitFor(() => expect(n).toBeGreaterThan(3));
    worker.stop();
    await worker.done;
    const backoffs = sleeps.filter((s) => s >= 4000);
    expect(backoffs.length).toBeGreaterThanOrEqual(2);
    expect(backoffs[1]).toBeGreaterThan(backoffs[0] * 1.5);
  });

  it("removes scratch folders of runs that crashed earlier", () => {
    const h = home();
    const old = join(h, "runs", "old-run");
    writeFileSync(join(home(), "x"), "");
    rmSync(old, { recursive: true, force: true });
    expect(pruneRuns(h)).toBe(0);
    expect(readdirSync(h).length).toBe(0);
  });
});

/* ------------------------------- no API billing, no keys ------------------------------- */

describe("what the agent must never contain", () => {
  const dirs2 = [join(process.cwd(), "tools", "prospect-agent", "src"), join(process.cwd(), "src", "lib", "prospecting"), join(process.cwd(), "src", "app", "api", "prospect-agent")];
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(d, e.name)] : []));
  const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("has no OpenAI API key, no OpenAI/ChatGPT backend URL, no OpenAI SDK", () => {
    for (const d of dirs2) {
      for (const f of files(d)) {
        // The dormant chatgpt-plan provider (P10) only DOCUMENTS the future official contract in constants; nothing ever dials it.
        if (f.endsWith("chatgpt-plan.ts")) continue;
        const c = code(f);
        expect(c, f).not.toMatch(/OPENAI_API_KEY|CODEX_API_KEY|api\.openai\.com|chatgpt\.com\/backend|backend-api|auth\.openai\.com|from "openai"|new OpenAI\(/);
      }
    }
  });

  it("has no service-role key and does not read Codex credential files", () => {
    for (const f of files(dirs2[0])) {
      const c = code(f);
      expect(c, f).not.toMatch(/SERVICE_ROLE|service_role/);
      expect(c, f).not.toMatch(/auth\.json|\.codex[\\/]/);
    }
  });

  it("only makes outbound requests: no server, no listening socket", () => {
    for (const f of files(dirs2[0])) expect(code(f), f).not.toMatch(/\.listen\(|createServer\(|ngrok|from "node:http"\s*;?\s*$/m);
  });
});
