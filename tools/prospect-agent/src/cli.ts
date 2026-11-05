import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { AgentApi, AgentApiError } from "./api-client";
import { diagnose, execStructured, KIND_MESSAGES, parseVersion, runProcess, supportedFlags } from "./codex";
import { TEST_SCHEMA } from "./codex-provider";
import { loadConfig, saveConfig, validateCrmUrl } from "./config";
import { createLogger } from "./logger";
import { agentHome } from "./paths";
import { forgetToken, loadToken, saveToken } from "./secret-store";
import { MockBusinessSource } from "../../../src/lib/prospecting/providers/mock";
import { OsmBusinessSource } from "./osm-source";
import { startWorker } from "./worker";

/**
 * Ian Prospect Agent. Commands:
 *   start        run the worker (Ctrl+C stops it cleanly)
 *   setup        store the CRM address and the connection token (token is protected with Windows DPAPI)
 *   status       what is configured and whether Codex is ready
 *   test-codex   one tiny structured Codex call: proves install, ChatGPT sign-in, headless exec and structured output work
 *   doctor       Codex's own read-only diagnostics (`codex doctor --summary`) plus this agent's checks
 *   forget       remove the stored connection token from this PC
 * Codex is signed in with `codex` -> "Sign in with ChatGPT". This agent never reads, copies or sends Codex credentials.
 */
const TOKEN_RE = /^ipa_[A-Za-z0-9_-]{43}$/;

function ask(question: string, hidden = false): Promise<string> {
  const muted = { on: false };
  const out = new Writable({ write(chunk, _enc, cb) { if (!muted.on) process.stdout.write(chunk); cb(); } });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    process.stdout.write(question);
    muted.on = hidden;
    rl.question("", (answer) => {
      muted.on = false;
      if (hidden) process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0] ?? "help";
  const config = loadConfig();
  const log = createLogger();

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log("Ian Prospect Agent\n\n  prospect-agent setup       connect this PC to the CRM\n  prospect-agent start       run the agent (Ctrl+C to stop)\n  prospect-agent status      show configuration and Codex readiness\n  prospect-agent test-codex  tiny structured Codex call\n  prospect-agent doctor      diagnostics\n  prospect-agent forget      remove the stored token\n");
    return 0;
  }

  if (cmd === "forget") {
    console.log(forgetToken() ? "The stored connection token was removed from this PC." : "No stored token found.");
    return 0;
  }

  if (cmd === "setup") {
    const current = await ask(`CRM address [${config.crmUrl}]: `);
    const url = validateCrmUrl(current || config.crmUrl);
    if (!url.ok) {
      console.error(url.error);
      return 1;
    }
    const token = await ask("Connection token (from CRM > Settings > Local Prospect Agent; input is hidden): ", true);
    if (!TOKEN_RE.test(token)) {
      console.error("That does not look like a connection token (it starts with ipa_).");
      return 1;
    }
    const d = await diagnose(config.codexBin);
    try {
      const hello = await new AgentApi(url.url, token).heartbeat({ codexVersion: d.version, codexState: d.state, failureKind: null });
      await saveToken(token);
      saveConfig({ crmUrl: url.url });
      console.log(`Connected as "${hello.device}". The token is stored protected for this Windows user.`);
      console.log(d.state === "ready" ? `Codex ${d.version ?? ""} is ready.` : `Codex is not ready yet: ${d.note}`);
      return 0;
    } catch (e) {
      console.error(e instanceof AgentApiError ? e.message : "Could not connect.");
      return 1;
    }
  }

  if (cmd === "status") {
    const token = await loadToken();
    const d = await diagnose(config.codexBin);
    console.log(`Home:    ${agentHome()}\nCRM:     ${config.crmUrl}\nToken:   ${token ? "stored" : "not set (run setup)"}\nModel:   ${config.model ?? "Codex default"}\nEffort:  quick=${config.effortQuick}, deep=${config.effortDeep}\nCodex:   ${d.state}${d.version ? ` (${d.version})` : ""}${d.note ? ` - ${d.note}` : ""}`);
    return d.state === "ready" && token ? 0 : 1;
  }

  if (cmd === "doctor") {
    const d = await diagnose(config.codexBin);
    console.log(`Agent check: ${d.state}${d.version ? ` (codex ${d.version})` : ""}${d.note ? `\n  ${d.note}` : ""}`);
    if (d.state === "not_installed") console.log("  Install Codex CLI: npm install -g @openai/codex   (or the installer from the Codex docs), then run: codex");
    if (d.state === "not_authenticated") console.log("  Sign in: run `codex` and choose Sign in with ChatGPT.");
    const r = await runProcess(config.codexBin, ["doctor", "--summary"], { cwd: process.cwd(), stdin: "", timeoutMs: 60_000, maxBytes: 50_000 });
    console.log(r.code === 0 ? `\ncodex doctor:\n${r.stdout.trim()}` : "\n`codex doctor --summary` is not available in this Codex version (nothing was changed).");
    return d.state === "ready" ? 0 : 1;
  }

  if (cmd === "test-codex") {
    const d = await diagnose(config.codexBin);
    if (d.state !== "ready") {
      console.error(`Codex is not ready: ${d.note ?? d.state}`);
      return 1;
    }
    const flags = await supportedFlags(config.codexBin);
    const res = await execStructured({ bin: config.codexBin, dir: `${agentHome()}/runs/test-${Date.now()}`, prompt: 'Return the JSON object {"ok": true}. Do not run any commands.', schema: TEST_SCHEMA as unknown as Record<string, unknown>, model: config.model, effort: "low", timeoutMs: 120_000, flags });
    if (res.ok && (res.value as { ok?: unknown })?.ok === true) {
      console.log(`Codex ${d.version ?? ""} works: headless exec, ChatGPT sign-in and structured output are fine (${res.ms} ms).`);
      return 0;
    }
    console.error(res.ok ? "Codex answered, but not with the expected structure." : `${res.message} (${res.kind})`);
    return 1;
  }

  if (cmd === "start") {
    const token = await loadToken();
    if (!token) {
      console.error("No connection token. Run: prospect-agent setup");
      return 1;
    }
    const api = new AgentApi(config.crmUrl, token);
    log.info("agent starting", { crm: config.crmUrl, codex: config.codexBin, model: config.model ?? "default", node: process.version, version: parseVersion(process.version) ?? "" });
    // Development only: PROSPECT_AGENT_SOURCE=sample uses invented businesses, and only while talking to a LOCAL CRM (never the real one).
    const sample = process.env.PROSPECT_AGENT_SOURCE === "sample" && /^http:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:|$)/.test(config.crmUrl);
    if (process.env.PROSPECT_AGENT_SOURCE === "sample" && !sample) log.warn("PROSPECT_AGENT_SOURCE=sample is ignored: it only works against a local CRM");
    const handle = startWorker({ api, config, log, source: sample ? new MockBusinessSource() : new OsmBusinessSource() });
    let signals = 0;
    const onSignal = () => {
      signals++;
      if (signals > 1) process.exit(130);
      log.info("stopping: finishing the current step, then exiting (press Ctrl+C again to force)");
      handle.stop();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    const result = await handle.done;
    log.info("agent stopped", { reason: result });
    return result === "unauthorized" ? 2 : 0;
  }

  console.error(`Unknown command "${cmd}". ${KIND_MESSAGES.agent_error ? "Run: prospect-agent help" : ""}`);
  return 1;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
  console.error(e instanceof Error ? e.message : "The agent stopped unexpectedly.");
  process.exit(1);
});
