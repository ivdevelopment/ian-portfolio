#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * A stand-in for the `codex` executable, for developing and testing the agent WITHOUT Codex or a ChatGPT sign-in. It speaks just enough of the
 * CLI the agent uses (--version, exec --help, login status, exec with the prompt on stdin and the answer written to --output-last-message).
 * FAKE_CODEX_MODE or the file fake-codex.mode: ok (default) | usage | unauth | garbage | slow. It never talks to any network and never reads any credential.
 */
const fs = require("node:fs");
// The agent gives Codex an allow-listed environment, so the mode can also come from a file next to this script (fake-codex.mode).
const modeFile = require("node:path").join(__dirname, "fake-codex.mode");
const mode = process.env.FAKE_CODEX_MODE || (fs.existsSync(modeFile) ? fs.readFileSync(modeFile, "utf8").trim() : "ok");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli 0.0.0-fake"); process.exit(0); }
if (args[0] === "exec" && args[1] === "--help") {
  console.log("Usage: codex exec [OPTIONS] [PROMPT]\n  --output-schema <FILE>\n  --output-last-message <FILE>\n  --sandbox <MODE>\n  --skip-git-repo-check\n  --ephemeral\n  --model <MODEL>\n  --cd <DIR>\n  --color <COLOR>");
  process.exit(0);
}
if (args[0] === "login" && args[1] === "status") { if (mode === "unauth") process.exit(1); console.log("Logged in using ChatGPT (fake)"); process.exit(0); }
if (args[0] === "doctor") { console.log("fake codex doctor: ok"); process.exit(0); }
if (args[0] === "exec") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (input += c));
  process.stdin.on("end", () => {
    if (mode === "usage") { console.error("You've reached your usage limit. Try again later."); process.exit(1); }
    if (mode === "unauth") { console.error("Not logged in. Run codex login."); process.exit(1); }
    const out = args.indexOf("--output-last-message");
    const respond = (text) => { if (out >= 0) fs.writeFileSync(args[out + 1], text); else process.stdout.write(text); process.exit(0); };
    if (mode === "garbage") respond("this is not json");
    const businesses = JSON.parse(input.trim().split("\n").at(-1));
    if (!Array.isArray(businesses)) respond(JSON.stringify({ ok: true }));
    const cat = (score, obs) => ({ score, reason: "Observed from the data provided.", observations: obs });
    const delay = mode === "slow" ? 4000 : 0;
    setTimeout(() => respond(JSON.stringify({ assessments: businesses.map((b) => {
      const o = b.observations.slice(0, 1).map((x) => x.id);
      return { ref: b.ref, scores: { business_fit: cat(22, []), website_need: cat(o.length ? 20 : 0, o), conversion_gap: cat(o.length ? 12 : 0, o), service_opportunity: cat(12, []), local_relevance: cat(8, []), contactability: cat(0, []) }, summary: "A modernisation opportunity based on the observations provided.", opportunity: "Website redesign + quote request flow" };
    }) })), delay);
  });
} else process.exit(1);
