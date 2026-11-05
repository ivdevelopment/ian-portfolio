import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { AgentApi, AgentApiError } from "./api-client";
import { diagnose, KIND_MESSAGES, resolveExecutableCached } from "./codex";
import { loadConfig, saveConfig, validateCrmUrl } from "./config";
import { createLogger } from "./logger";
import { agentHome } from "./paths";
import { forgetToken, loadToken, saveToken } from "./secret-store";
import { ProspectAgentService } from "./service";
import { MockBusinessSource } from "../../../src/lib/prospecting/providers/mock";
import { CompositeBusinessSource } from "./discovery-source";
import { businessDataStatus, statusLine } from "./osm/data-manager";
import { SOURCE_NAME } from "./osm/geofabrik";
import type { LocalOsmBusinessSource } from "./osm/local-osm-source";

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
    console.log("Ian Prospect Agent\n\n  prospect-agent setup       connect this PC to the CRM\n  prospect-agent start       run the agent (Ctrl+C to stop)\n  prospect-agent update-business-data   download/refresh the local Belgium business data [--force]\n  prospect-agent discover    dry-run a local business search [--location Brugge --area \"Brugge + 30 km\" --industry bike --count 5]\n  prospect-agent status      show configuration and Codex readiness\n  prospect-agent test-codex  tiny structured Codex call\n  prospect-agent doctor      diagnostics\n  prospect-agent forget      remove the stored token\n");
    return 0;
  }

  if (cmd === "update-business-data") {
    const force = argv.includes("--force");
    console.log(`Checking Geofabrik (${SOURCE_NAME}) for the current Belgium extract...`);
    const res = await new ProspectAgentService({ log, noLock: true }).updateBusinessData({ force, log: (m) => console.log(`  ${m}`) });
    if (!res.ok) {
      console.error(`
${res.message}`);
      return 1;
    }
    if (res.result.outcome === "up_to_date") {
      console.log(`
The local business data is already the newest version (${statusLine(res.result.status)}). Use --force to rebuild the index anyway.`);
      return 0;
    }
    if (res.result.outcome !== "updated") return 1;
    const r = res.result;
    const s = r.status;
    console.log(`
Local business data is ready.
  Source:        ${s.source}
  Data date:     ${s.dataDate ?? "unknown"}
  Businesses:    ${s.businesses.toLocaleString("en")} indexed (${s.places.toLocaleString("en")} places for search centres)
  Download:      ${r.reusedExtract ? "reused the extract already on disk" : `${(r.downloadedBytes / 1e6).toFixed(0)} MB in ${r.downloadSeconds} s`}
  Index size:    ${(s.indexBytes / 1e6).toFixed(0)} MB (import took ${r.build.seconds} s)
  Attribution:   ${s.attribution}`);
    return 0;
  }

  if (cmd === "discover") {
    // A dry run of discovery only: no Codex, no CRM, nothing is stored. Prints what the local index returns for a search.
    const arg = (name: string, fallback: string | null) => {
      const i = argv.indexOf(`--${name}`);
      return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
    };
    const location = arg("location", "Brugge") as string;
    const area = arg("area", `${location} + 30 km`);
    const industry = arg("industry", null);
    const count = Math.min(20, Math.max(1, Number(arg("count", "5")) || 5));
    const mode = arg("mode", "quick") as "quick";
    const source = new CompositeBusinessSource({ allowOverpass: config.overpassFallback, local: { priorities: config.discoveryPriorities }, log: (m) => console.log(`  ${m}`) });
    const started = Date.now();
    try {
      const found = await source.discover({ mode, location, area, industry, threshold: 70, count, excludeResearched: true });
      const ms = Date.now() - started;
      const report = (source.local as LocalOsmBusinessSource).last;
      console.log(`Source: ${source.used}  ·  ${found.length} businesses  ·  ${ms} ms${report ? `  ·  ${report.inRadius} in range (${report.radiusKm} km, centre via ${report.centreVia})` : ""}`);
      if (report?.pool && report.inRange) {
        const labels = report.pool.bandLabels;
        const fmt = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(", ") || "none";
        console.log(`In range (eligible): ${report.inRadius}   by distance: ${labels.map((l, i) => `${l} ${report.inRange!.bands[i]}`).join(" | ")}`);
        console.log(`Left out as non-commercial (public / non-profit by OSM tags): ${report.inRange.excludedNonCommercial}`);
        console.log(`Eligible by class: ${fmt(report.inRange.commercial)}`);
        console.log(`Preselected: ${report.pool.bands.reduce((a, b) => a + b, 0)}   by distance: ${labels.map((l, i) => `${l} ${report.pool!.bands[i]}`).join(" | ")}   (min ${report.pool.distance.min} km, median ${report.pool.distance.median} km, p90 ${report.pool.distance.p90} km, max ${report.pool.distance.max} km)`);
        console.log(`Preselected by class: ${fmt(report.pool.commercial)}`);
        console.log(`Categories: ${fmt(report.pool.categories)}`);
        console.log(`With website listed: ${report.pool.withWebsite}, without: ${report.pool.withoutWebsite}`);
      } else {
        console.log(`With website listed: ${found.filter((b) => b.websiteUrl).length}, without: ${found.filter((b) => !b.websiteUrl).length}`);
      }
      for (const b of found.slice(0, 40)) console.log(`  ${(b.distanceKm ?? 0).toFixed(1).padStart(5)} km  ${b.companyName.slice(0, 40).padEnd(40)} ${(b.category ?? "").padEnd(24)} ${b.city ?? ""}  ${b.websiteUrl ?? "(no website listed)"}`);
      return 0;
    } catch (e) {
      console.error(e instanceof Error ? e.message : "Discovery failed.");
      return 1;
    }
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
    const service = new ProspectAgentService({ log, noLock: true });
    const token = await loadToken();
    const state = await service.refresh();
    const d = state.codex;
    console.log(`Business data: ${statusLine(businessDataStatus())}`);
    console.log(`Home:    ${agentHome()}
CRM:    ${config.crmUrl}
Token:   ${token ? "stored" : "not set (run setup)"}
Model:   ${config.model ?? "Codex default"}
Effort:  quick=${config.effortQuick}, deep=${config.effortDeep}
Codex:   ${d.state}${d.version ? ` (${d.version})` : ""}${d.note ? ` - ${d.note}` : ""}
Exe:     ${resolveExecutableCached(config.codexBin) ?? "not found"}`);
    return d.state === "ready" && token ? 0 : 1;
  }

  if (cmd === "doctor") {
    const r = await new ProspectAgentService({ log, noLock: true }).doctor();
    const bd = r.businessData;
    const d = r.codex;
    console.log(`Business data
  Installed:          ${bd.indexReady ? "yes" : "no"}
  Source:             ${bd.source}
  Data date:          ${bd.dataDate ?? "unknown"}${bd.ageDays !== null ? ` (${bd.ageDays} ${bd.ageDays === 1 ? "day" : "days"} old, ${bd.freshness})` : ""}
  Index ready:        ${bd.indexReady ? "yes" : "no"}
  Businesses indexed: ${bd.businesses.toLocaleString("en")}
  Attribution:        ${bd.attribution}${bd.indexReady ? "" : `
  ${statusLine(bd)}`}
`);
    console.log(`Agent check: ${d.state}${d.version ? ` (codex ${d.version})` : ""}${d.note ? `
  ${d.note}` : ""}
  Executable: ${d.executable ?? "not found"}`);
    if (d.state === "not_installed") console.log("  Install Codex CLI: npm install -g @openai/codex   (or the installer from the Codex docs), then run: codex");
    if (d.state === "not_authenticated") console.log("  Sign in: run `codex` and choose Sign in with ChatGPT.");
    console.log(r.codexSummary !== null ? `\ncodex doctor:\n${r.codexSummary}` : "\n`codex doctor --summary` is not available in this Codex version (nothing was changed).");
    return d.state === "ready" ? 0 : 1;
  }

  if (cmd === "test-codex") {
    const service = new ProspectAgentService({ log, noLock: true });
    const out = await service.testCodex();
    if (out.state === "ready") {
      console.log(`Codex ${out.version ?? ""} works: headless exec, ChatGPT sign-in and structured output are fine (${out.ms} ms).
Executable: ${resolveExecutableCached(config.codexBin) ?? "?"}`);
      return 0;
    }
    console.error(`${out.message}`);
    return 1;
  }

  if (cmd === "start") {
    // Development only: PROSPECT_AGENT_SOURCE=sample uses invented businesses, and only while talking to a LOCAL CRM (never the real one).
    const sample = process.env.PROSPECT_AGENT_SOURCE === "sample" && /^http:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:|$)/.test(config.crmUrl);
    if (process.env.PROSPECT_AGENT_SOURCE === "sample" && !sample) log.warn("PROSPECT_AGENT_SOURCE=sample is ignored: it only works against a local CRM (never the real one)");
    const service = new ProspectAgentService({ log, owner: "cli", source: sample ? new MockBusinessSource() : undefined });
    const started = await service.start();
    if (!started.ok) {
      console.error(started.reason === "not_configured" ? "No connection token. Run: prospect-agent setup" : started.message);
      return 1;
    }
    let signals = 0;
    const onSignal = () => {
      signals++;
      if (signals > 1) process.exit(130);
      log.info("stopping: finishing the current step, then exiting (press Ctrl+C again to force)");
      void service.stop({ mode: "graceful" });
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    const reason = await new Promise<"stopped" | "unauthorized">((resolve) => {
      service.onEvent((e) => e.type === "worker_stopped" && resolve(e.reason));
    });
    return reason === "unauthorized" ? 2 : 0;
  }

  console.error(`Unknown command "${cmd}". ${KIND_MESSAGES.agent_error ? "Run: prospect-agent help" : ""}`);
  return 1;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
  console.error(e instanceof Error ? e.message : "The agent stopped unexpectedly.");
  process.exit(1);
});
