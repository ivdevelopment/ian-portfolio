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
    // Mail Assistant (P10.5): a canned, rule-abiding draft chosen from the request's own context (action type and language). Development only.
    if (input.includes("You write ONE email draft")) {
      const ctx = JSON.parse(input.trim().split("\n").at(-1));
      const nl = ctx.language === "nl";
      const hi = ctx.prospect.contact_name ? (nl ? "Dag " : "Hi ") + ctx.prospect.contact_name.split(" ")[0] + "," : nl ? "Dag," : "Hi,";
      const sign = nl ? "Groeten,\nIan" : "Best,\nIan";
      const lastSubject = (ctx.history.find((h) => h.subject) || {}).subject;
      const re = (s) => (lastSubject ? (/^re:/i.test(lastSubject) ? lastSubject : "Re: " + lastSubject) : s);
      const hasPoint = ctx.observations && ctx.observations.points[0];
      const point = hasPoint ? (nl ? "Ik merkte dat de reservatie- of contactflow een stuk directer zou kunnen." : "I noticed the reservation or contact flow could be a bit more direct.") : nl ? "Ik help lokale zaken met hun website en reservaties." : "I help local businesses with their website and bookings.";
      const T = {
        first_outreach: [nl ? "Een kleine suggestie voor jullie site" : "A small idea for your site", nl ? point + " Ik heb daar een kleine suggestie voor, en toon ze graag als je interesse hebt." : point + " I have a small idea for it and would be happy to show it if you are interested."],
        follow_up: [re(nl ? "Een kleine suggestie voor jullie site" : "A small idea for your site"), ctx.action.is_final ? (nl ? "Ik kom nog een laatste keer terug op mijn vorige mail. Geen probleem als het niet past; je weet me te vinden." : "One last note on my earlier email. No problem if it is not a fit; you know where to find me.") : nl ? "Ik wou even terugkomen op mijn vorige mail. Als het iets is waar je over nadenkt, toon ik graag wat ik in gedachten had." : "Just following up on my earlier email. If it is something you are considering, I am happy to show what I had in mind."],
        reply: [re(nl ? "Je bericht" : "Your message"), nl ? "Bedankt voor je antwoord. Graag bespreek ik het verder; laat maar weten wanneer het je past, dan stem ik me daarop af." : "Thanks for getting back to me. I would be glad to discuss it further; let me know what suits you and I will adapt."],
        concept_follow_up: [re(nl ? "Het concept" : "The concept"), nl ? "Ik wou even terugkomen op het concept dat ik doorstuurde. Had je al de tijd om ernaar te kijken, of heb je vragen?" : "I wanted to quickly follow up on the concept I sent over. Did you get a chance to look at it, or do you have any questions?"],
        quote_follow_up: [re(nl ? "Offerte" : "Quote"), nl ? "Ik wou even nagaan of je al tijd had om de offerte te bekijken. Als er vragen zijn over de inhoud, bespreek ik die graag." : "I wanted to check whether you had time to go through the quote. If there are questions about the scope, I am happy to go over them."],
        meeting_follow_up: [re(nl ? "Ons gesprek" : "Our meeting"), nl ? "Bedankt voor het gesprek. Ik wou even afstemmen wat de volgende stap is voor jullie." : "Thanks for the meeting. I wanted to agree on the next step with you."],
      }[ctx.action.type] || ["x", "x"];
      // Tone (P10.5.1): canned variations so the presets visibly differ in local runs. Style only: the action and language are untouched.
      const tone = (ctx.tone && ctx.tone.preset) || "casual";
      const first = ctx.action.type === "first_outreach";
      if (tone === "very_short") T[1] = first ? (nl ? "Ik had een klein idee voor jullie site. Mag ik het eens tonen?" : "I had a small idea for your site. May I show you?") : nl ? "Even terugkomen op mijn vorige mail. Laat gerust iets weten." : "Just a quick follow-up on my earlier mail. Let me know.";
      else if (tone === "professional") T[1] = (nl ? "Naar aanleiding van mijn eerdere bericht neem ik graag opnieuw contact op. " : "Following my earlier message, I am getting in touch again. ") + T[1];
      else if (tone === "friendly") T[1] = T[1] + (nl ? " Fijne dag verder." : " Have a good day.");
      else if (tone === "direct") T[1] = T[1].split(". ").slice(0, 2).join(". ").replace(/\.?$/, ".");
      else if (tone === "soft_sales") T[1] = T[1] + (nl ? " Het kan jullie misschien wat extra aanvragen opleveren." : " It might bring you a few extra enquiries.");
      const custom = ctx.tone && ctx.tone.custom_instruction ? " Custom instruction applied: " + ctx.tone.custom_instruction : "";
      respond(JSON.stringify({ action_type: ctx.action.type, recommended_send_at: null, should_send_now: true, subject: T[0], body: hi + "\n\n" + T[1] + "\n\n" + sign, reason_summary: "Canned development draft for " + ctx.action.type + ", tone " + tone + "." + custom }));
    }
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
