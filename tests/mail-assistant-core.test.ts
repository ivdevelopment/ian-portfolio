import { describe, expect, it } from "vitest";
import { buildContext, changedParts, computeFingerprint } from "../src/lib/mail-assistant/context";
import { computeFacts } from "../src/lib/mail-assistant/facts";
import { conversationLanguage, detectLanguage } from "../src/lib/mail-assistant/language";
import { decidePlan, TIMING } from "../src/lib/mail-assistant/plan";
import { buildMailPrompt, MAIL_OUTPUT_SCHEMA } from "../src/lib/mail-assistant/prompt";
import { addBusinessDays, belgianHolidays, brusselsDayOf, businessDaysBetween, isBusinessDay, recommendedSendDay, relativeDayLabel } from "../src/lib/mail-assistant/timing";
import { ACTION_TYPES, type ActivityInput, type AssistantInputs, type MailInput, type ProspectInput, type QuoteInput } from "../src/lib/mail-assistant/types";
import { checkMailResult, forbiddenIn, overrideWithPlan, revealsTracking } from "../src/lib/mail-assistant/validate";

/** Thursday 5 Nov 2026, 10:00 in Brussels. (Wednesday 11 Nov is a Belgian public holiday.) */
const NOW = new Date("2026-11-05T09:00:00Z");

const prospect = (over: Partial<ProspectInput> = {}): ProspectInput => ({ id: "p1", company_name: "Brugse Bike Rental", contact_name: "Sofie", sector: "bicycle rental", city: "Brugge", website_url: "https://www.brugesbikerental.be/", email: "info@brugesbikerental.be", status: "ready_to_contact", priority: "normal", source: "AI prospecting", first_contact_on: null, last_contact_on: null, next_follow_up_on: null, ...over });
const mail = (id: string, direction: "incoming" | "outgoing", sentAt: string, over: Partial<MailInput> = {}): MailInput => ({ id, direction, subject: "Website idee", snippet: "Hallo, ik zag jullie website en had een kleine suggestie voor jullie reservatieflow.", sent_at: sentAt, ...over });
const activity = (id: string, type: string, day: string): ActivityInput => ({ id, type, title: type, occurred_on: day, occurred_at: null, created_at: `${day}T08:00:00Z` });
const inputs = (over: Partial<AssistantInputs> = {}): AssistantInputs => ({ now: NOW, prospect: prospect(), mail: [], activities: [], quotes: [], preview: null, insight: null, project: null, ...over });
const plan = (i: AssistantInputs) => decidePlan(computeFacts(i), i.now);

/* ------------------------------------------------ timing ------------------------------------------------ */

describe("business days in Europe/Brussels", () => {
  it("knows weekends and the Belgian public holidays (fixed and Easter-based)", () => {
    expect(isBusinessDay("2026-11-05")).toBe(true);
    expect(isBusinessDay("2026-11-07")).toBe(false); // Saturday
    expect(isBusinessDay("2026-11-11")).toBe(false); // Armistice Day
    const h = belgianHolidays(2026);
    for (const d of ["2026-01-01", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-07-21", "2026-08-15", "2026-11-01", "2026-12-25"]) expect(h.has(d), d).toBe(true);
  });

  it("adds business days skipping weekends and holidays, and counts them back", () => {
    expect(addBusinessDays("2026-11-04", 3)).toBe("2026-11-09"); // Wed -> Thu, Fri, Mon
    expect(addBusinessDays("2026-11-09", 2)).toBe("2026-11-12"); // Mon -> Tue, (Wed holiday) Thu
    expect(addBusinessDays("2026-11-07", 1)).toBe("2026-11-09"); // from a Saturday
    expect(businessDaysBetween("2026-10-30", "2026-11-05")).toBe(4);
  });

  it("suggests today during business hours, otherwise the next working day (no late-night or weekend sends)", () => {
    expect(recommendedSendDay(new Date("2026-11-05T09:00:00Z"))).toBe("2026-11-05"); // Thu 10:00
    expect(recommendedSendDay(new Date("2026-11-05T17:30:00Z"))).toBe("2026-11-06"); // Thu 18:30 -> Friday
    expect(recommendedSendDay(new Date("2026-11-05T23:30:00Z"))).toBe("2026-11-06"); // Thu 00:30 Brussels is Friday already? 23:30Z = 00:30 CET Fri
    expect(recommendedSendDay(new Date("2026-11-07T10:00:00Z"))).toBe("2026-11-09"); // Saturday -> Monday
    expect(recommendedSendDay(new Date("2026-11-10T16:30:00Z"))).toBe("2026-11-12"); // Tue evening -> skip the Wednesday holiday
    expect(recommendedSendDay(new Date("2026-11-05T09:00:00Z"), "2026-11-09")).toBe("2026-11-09");
  });

  it("works on the Brussels calendar day, not the server's", () => {
    expect(brusselsDayOf("2026-11-05T23:30:00Z")).toBe("2026-11-06");
    expect(relativeDayLabel("2026-11-05", "2026-11-05")).toBe("Today");
    expect(relativeDayLabel("2026-11-06", "2026-11-05")).toBe("Tomorrow");
    expect(relativeDayLabel("2026-11-09", "2026-11-05")).toBe("Mon 9 Nov 2026");
  });
});

/* ------------------------------------------------ language ------------------------------------------------ */

describe("language", () => {
  it("detects Dutch and English, and says nothing when unsure", () => {
    expect(detectLanguage("Dag Sofie, ik wou even nagaan of je al tijd had om naar het voorstel te kijken. Groeten, Ian")).toBe("nl");
    expect(detectLanguage("Hi Sofie, just following up on my email from last week. Happy to explain what I had in mind. Best, Ian")).toBe("en");
    expect(detectLanguage("ok")).toBeNull();
  });

  it("continues the language of the existing conversation and defaults to Dutch", () => {
    expect(conversationLanguage([])).toBe("nl");
    expect(conversationLanguage([{ direction: "outgoing", text: "Hi, I wanted to share a small idea for your website and the booking flow." }])).toBe("en");
    // The prospect's own language wins over ours.
    expect(conversationLanguage([{ direction: "outgoing", text: "Hi, I wanted to share a small idea for your website." }, { direction: "incoming", text: "Dag Ian, bedankt voor je mail, we hebben wel interesse in een nieuwe site." }])).toBe("nl");
  });

  it("keeps an English conversation in English in the facts", () => {
    const i = inputs({ mail: [mail("m1", "outgoing", "2026-10-26T09:00:00Z", { subject: "A small idea", snippet: "Hi, I noticed that the booking flow on your site could be a bit more direct and wanted to share an idea." })] });
    expect(computeFacts(i).language).toBe("en");
    expect(plan(i).language).toBe("en");
  });
});

/* ------------------------------------------------ the plan ------------------------------------------------ */

describe("next best outreach: deterministic plan", () => {
  it("a never-contacted prospect gets a first outreach, today during business hours", () => {
    const p = plan(inputs());
    expect(p).toMatchObject({ action: "first_outreach", step: "first_outreach", recommended_on: "2026-11-05", needs_ai: true, blocked: null, reason: "No previous outreach found." });
  });

  it("a first outreach prepared in the evening is suggested for the next working morning", () => {
    expect(plan(inputs({ now: new Date("2026-11-05T18:30:00Z") })).recommended_on).toBe("2026-11-06");
  });

  it("mail sent yesterday: wait, and say when to follow up (3 business days, Monday)", () => {
    const p = plan(inputs({ mail: [mail("m1", "outgoing", "2026-11-04T10:00:00Z")] }));
    expect(p).toMatchObject({ action: "wait", then: "follow_up", step: "follow_up_1", recommended_on: "2026-11-09", needs_ai: false });
    expect(p.reason).toContain("yesterday");
  });

  it("mail sent 5 days ago with no reply: a follow-up now", () => {
    const p = plan(inputs({ mail: [mail("m1", "outgoing", "2026-10-31T10:00:00Z")] }));
    expect(p).toMatchObject({ action: "follow_up", step: "follow_up_1", recommended_on: "2026-11-05", needs_ai: true, is_final: false });
    expect(p.reason).toContain("5 days ago");
  });

  it("the sequence is first message, follow-up 1, a final follow-up 2, then stop", () => {
    const sent = (days: string[]) => days.map((d, n) => mail(`m${n}`, "outgoing", `${d}T10:00:00Z`));
    expect(plan(inputs({ mail: sent(["2026-10-12", "2026-10-19"]) }))).toMatchObject({ action: "follow_up", step: "follow_up_2_final", is_final: true });
    // Two follow-ups after the first message have gone unanswered: stop.
    const stopped = plan(inputs({ mail: sent(["2026-10-05", "2026-10-12", "2026-10-19"]) }));
    expect(stopped).toMatchObject({ action: "no_action", step: "stop", needs_ai: false, recommended_on: null });
    expect(stopped.reason).toMatch(/Leave this prospect alone/);
  });

  it("the final follow-up waits 5 business days after the previous one", () => {
    const p = plan(inputs({ mail: [mail("a", "outgoing", "2026-10-26T10:00:00Z"), mail("b", "outgoing", "2026-11-02T10:00:00Z")] }));
    expect(p).toMatchObject({ action: "wait", then: "follow_up", step: "follow_up_2_final", recommended_on: "2026-11-09" });
    expect(TIMING.followUp2.min).toBe(5);
  });

  it("several messages on the same day count as one touch, and a mail that is also logged by hand is not counted twice", () => {
    const i = inputs({ mail: [mail("a", "outgoing", "2026-10-28T09:00:00Z"), mail("b", "outgoing", "2026-10-28T13:00:00Z")], activities: [activity("x", "contacted", "2026-10-28")] });
    expect(computeFacts(i)).toMatchObject({ outgoing_touches: 1, unanswered_touches: 1 });
  });

  it("an incoming reply means: reply to it (when the stored text is usable)", () => {
    const i = inputs({ prospect: prospect({ status: "contacted" }), mail: [mail("o", "outgoing", "2026-10-28T10:00:00Z"), mail("i", "incoming", "2026-11-04T08:00:00Z", { snippet: "Dag Ian, bedankt voor je bericht. Kunnen we volgende week eens bellen over de nieuwe website?" })] });
    const p = plan(i);
    expect(p).toMatchObject({ action: "reply", step: "reply", needs_ai: true, blocked: null });
    expect(p.reason).toContain("replied yesterday");
    expect(computeFacts(i).inbound?.sufficient).toBe(true);
  });

  it("a reply whose snippet is too short is NOT answered with a guess: more email context is needed", () => {
    const i = inputs({ mail: [mail("o", "outgoing", "2026-10-28T10:00:00Z"), mail("i", "incoming", "2026-11-04T08:00:00Z", { snippet: "ok" })] });
    const p = plan(i);
    expect(p).toMatchObject({ action: "reply", needs_ai: false, blocked: "more_context_needed" });
    expect(p.reason).toContain("More email context needed");
  });

  it("a reply logged by hand (no mail text at all) also asks for more context", () => {
    const p = plan(inputs({ activities: [activity("r", "reply_received", "2026-11-04")] }));
    expect(p).toMatchObject({ action: "reply", blocked: "more_context_needed", needs_ai: false });
  });

  it("when Ian answered last, the sequence continues from his answer (no repeated reply)", () => {
    const p = plan(inputs({ mail: [mail("i", "incoming", "2026-10-27T08:00:00Z"), mail("o", "outgoing", "2026-10-28T10:00:00Z", { snippet: "Bedankt, ik stuur een voorstel door." })] }));
    expect(p.action).not.toBe("reply");
    expect(p.action).toBe("follow_up");
  });

  it("a concept that was shared and viewed gets a concept follow-up 2 business days after the preview was viewed", () => {
    const i = inputs({
      prospect: prospect({ status: "concept_sent" }),
      mail: [mail("o", "outgoing", "2026-10-29T10:00:00Z")],
      activities: [activity("c", "concept_sent", "2026-10-29")],
      preview: { linked: true, id: "pv", firstAccessedAt: "2026-11-02T14:37:00Z", lastAccessedAt: "2026-11-02T14:40:00Z", accessCount: 3 },
    });
    const p = plan(i);
    expect(p).toMatchObject({ action: "concept_follow_up", step: "concept_follow_up_1", needs_ai: true });
    // Viewed yesterday: wait for the 2 business days.
    const recent = inputs({ ...i, preview: { linked: true, id: "pv", firstAccessedAt: "2026-11-04T09:00:00Z", lastAccessedAt: "2026-11-04T09:00:00Z", accessCount: 1 } });
    expect(plan(recent)).toMatchObject({ action: "wait", then: "concept_follow_up", recommended_on: "2026-11-06" });
  });

  it("a quote sent 5 days ago with no reply gets a quote follow-up; right after sending it, wait", () => {
    const quotes: QuoteInput[] = [{ id: "q1", status: "sent", sentAt: "2026-10-31T10:00:00Z", createdAt: "2026-10-30T10:00:00Z", title: "Nieuwe website" }];
    expect(plan(inputs({ prospect: prospect({ status: "quote_sent" }), quotes, activities: [activity("qs", "quote_sent", "2026-10-31")] }))).toMatchObject({ action: "quote_follow_up", step: "quote_follow_up_1", needs_ai: true });
    expect(plan(inputs({ prospect: prospect({ status: "quote_sent" }), quotes: [{ ...quotes[0], sentAt: "2026-11-04T10:00:00Z" }] }))).toMatchObject({ action: "wait", then: "quote_follow_up" });
  });

  it("an accepted or declined quote means no chasing", () => {
    for (const status of ["accepted", "rejected"]) expect(plan(inputs({ quotes: [{ id: "q", status, sentAt: "2026-10-20T10:00:00Z", createdAt: "2026-10-19T10:00:00Z", title: null }] })).action).toBe("no_action");
  });

  it("two unanswered follow-ups on a quote: stop, do not keep chasing", () => {
    const i = inputs({ prospect: prospect({ status: "quote_sent" }), quotes: [{ id: "q", status: "sent", sentAt: "2026-10-12T10:00:00Z", createdAt: "2026-10-11T10:00:00Z", title: null }], mail: [mail("a", "outgoing", "2026-10-19T10:00:00Z"), mail("b", "outgoing", "2026-10-27T10:00:00Z")] });
    expect(plan(i)).toMatchObject({ action: "no_action", step: "stop" });
  });

  it.each(["won", "lost", "not_interested", "no_response"] as const)("status %s: never a cold outreach, even with an old unanswered mail", (status) => {
    const p = plan(inputs({ prospect: prospect({ status }), mail: [mail("m", "outgoing", "2026-10-01T10:00:00Z")] }));
    expect(p).toMatchObject({ action: "no_action", needs_ai: false, recommended_on: null });
  });

  it("a prospect imported with contact dates but no mail is not treated as never contacted", () => {
    const p = plan(inputs({ prospect: prospect({ status: "contacted", first_contact_on: "2026-10-20", last_contact_on: "2026-10-20" }) }));
    expect(p.action).toBe("follow_up");
    expect(p.action).not.toBe("first_outreach");
  });

  it("a status that says contacted but has no history at all is flagged for a double check", () => {
    const p = plan(inputs({ prospect: prospect({ status: "contacted" }) }));
    expect(p.warnings.join(" ")).toContain("no mail or contact is recorded");
  });

  it("a missing email address is warned about but does not block a draft", () => {
    const p = plan(inputs({ prospect: prospect({ email: null }) }));
    expect(p).toMatchObject({ action: "first_outreach", needs_ai: true });
    expect(p.warnings).toContain("This prospect has no email address yet.");
  });

  it("the plan only ever uses the fixed action vocabulary", () => {
    const seen = [inputs(), inputs({ mail: [mail("m", "outgoing", "2026-11-04T10:00:00Z")] }), inputs({ prospect: prospect({ status: "lost" }) })].map((i) => plan(i).action);
    for (const a of seen) expect(ACTION_TYPES).toContain(a);
  });

  it("the same facts at the same moment always give the same plan", () => {
    const i = inputs({ mail: [mail("m", "outgoing", "2026-10-30T10:00:00Z")] });
    expect(plan(i)).toEqual(plan(i));
  });
});

/* ------------------------------------------------ freshness ------------------------------------------------ */

describe("stale recommendations", () => {
  it("a newly synced mail changes the fingerprint, and the page can say it was the mail", () => {
    const before = inputs({ mail: [mail("m1", "outgoing", "2026-10-30T10:00:00Z")] });
    const after = inputs({ mail: [mail("m1", "outgoing", "2026-10-30T10:00:00Z"), mail("m2", "incoming", "2026-11-04T10:00:00Z")] });
    const a = computeFingerprint(before);
    const b = computeFingerprint(after);
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(changedParts(a.parts, b)).toEqual(["mail"]);
    expect(changedParts(a.parts, a)).toEqual([]);
  });

  it("a logged activity, a quote, the first preview view and a status change each make it outdated; irrelevant activity does not", () => {
    const base = inputs();
    const fp = computeFingerprint(base);
    expect(changedParts(fp.parts, computeFingerprint(inputs({ activities: [activity("a", "contacted", "2026-11-05")] })))).toEqual(["activity"]);
    expect(changedParts(fp.parts, computeFingerprint(inputs({ activities: [activity("n", "note", "2026-11-05")] })))).toEqual([]);
    expect(changedParts(fp.parts, computeFingerprint(inputs({ quotes: [{ id: "q", status: "sent", sentAt: "2026-11-05T08:00:00Z", createdAt: "2026-11-05T08:00:00Z", title: null }] })))).toEqual(["quote"]);
    expect(changedParts(fp.parts, computeFingerprint(inputs({ preview: { linked: true, id: "pv", firstAccessedAt: "2026-11-05T08:00:00Z", lastAccessedAt: null, accessCount: 1 } })))).toEqual(["preview"]);
    expect(changedParts(fp.parts, computeFingerprint(inputs({ prospect: prospect({ status: "contacted" }) })))).toEqual(["status"]);
  });

  it("opening the preview AGAIN does not make a recommendation outdated (only the first view matters)", () => {
    const a = inputs({ preview: { linked: true, id: "pv", firstAccessedAt: "2026-11-02T08:00:00Z", lastAccessedAt: "2026-11-02T08:00:00Z", accessCount: 1 } });
    const b = inputs({ preview: { linked: true, id: "pv", firstAccessedAt: "2026-11-02T08:00:00Z", lastAccessedAt: "2026-11-04T08:00:00Z", accessCount: 5 } });
    expect(computeFingerprint(a).fingerprint).toBe(computeFingerprint(b).fingerprint);
  });
});

/* --------------------------------------------- context for Codex --------------------------------------------- */

describe("what Codex gets to see", () => {
  const i = inputs({
    prospect: prospect({ status: "concept_sent" }),
    mail: [mail("o", "outgoing", "2026-10-29T10:00:00Z", { snippet: "Dag Sofie, ik zag dat jullie reservatieflow wat directer kan." })],
    activities: [activity("c", "concept_sent", "2026-10-29"), activity("n", "note", "2026-11-01")],
    preview: { linked: true, id: "pv", firstAccessedAt: "2026-11-02T14:37:00Z", lastAccessedAt: "2026-11-03T09:00:00Z", accessCount: 4 },
    insight: { summary: "Fietsverhuur zonder duidelijke reservatielink.", opportunity: "Reservatieflow", observations: ["No enquiry CTA, form or reservation link was found on the pages checked."] },
    quotes: [{ id: "q", status: "draft", sentAt: null, createdAt: "2026-10-30T10:00:00Z", title: "Voorstel" }],
  });
  const ctx = buildContext(i, computeFacts(i), plan(i));
  const json = JSON.stringify(ctx);

  it("contains the facts needed to write one message, as plain observations", () => {
    expect(ctx).toMatchObject({ action: { type: "concept_follow_up" }, language: "nl", prospect: { company: "Brugse Bike Rental", contact_name: "Sofie", website: "brugesbikerental.be" }, concept: { shared: true } });
    expect(ctx.observations?.points[0]).toContain("No enquiry CTA");
    expect(ctx.history.find((h) => h.kind === "email_sent")).toMatchObject({ days_ago: 7 });
  });

  it("never contains tracking details, scores, email addresses, notes or amounts", () => {
    for (const secret of ["14:37", "first_viewed", "access", "visits", "score", "info@brugesbikerental.be", "@", "note"]) expect(json, secret).not.toContain(secret);
    expect(json).not.toMatch(/"(score|breakdown|eur|total|amount|notes)"/i);
  });

  it("the prompt tells the model what never to say and to keep the draft short, and carries the strict schema", () => {
    const prompt = buildMailPrompt(ctx);
    expect(prompt).toContain("NEVER say or hint that anything was opened, viewed");
    expect(prompt).toContain("Never mention scores, AI");
    expect(prompt).toContain("Belgian Dutch");
    expect(prompt).toContain("Do NOT run commands");
    expect(buildMailPrompt(ctx, "The body is too long.")).toContain("Your previous answer was rejected: The body is too long.");
    expect(MAIL_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(MAIL_OUTPUT_SCHEMA.properties.action_type.enum).toEqual([...ACTION_TYPES]);
    expect(prompt.split("\n").at(-1)).toBe(JSON.stringify(ctx));
  });
});

/* ------------------------------------------------ guardrails ------------------------------------------------ */

describe("server-side guardrails on the model's answer", () => {
  const dutchBody = "Dag Sofie,\n\nIk wou even terugkomen op mijn mail van vorige week over de reservatieflow op jullie site. Als het iets is waar je over nadenkt, toon ik graag wat ik in gedachten had.\n\nGroeten,\nIan";
  const answer = (over: Record<string, unknown> = {}) => ({ action_type: "follow_up", recommended_send_at: null, should_send_now: true, subject: "Re: Website idee", body: dutchBody, reason_summary: "Short nudge on the earlier idea.", ...over });
  const followUpNow = plan(inputs({ mail: [mail("m1", "outgoing", "2026-10-30T10:00:00Z")] }));

  it("accepts a clean draft that matches the plan, and the plan decides the date and 'send now'", () => {
    const v = checkMailResult(answer({ recommended_send_at: "2026-12-24" }), followUpNow, "2026-11-05");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.recommendation).toMatchObject({ action_type: "follow_up", recommended_send_at: "2026-11-05", should_send_now: true, subject: "Re: Website idee" });
      expect(v.note).toContain("replaced by the timing rules");
    }
  });

  it("rejects 'send a follow-up now' when the prospect was emailed yesterday: the plan says wait, so no draft exists", () => {
    const waiting = plan(inputs({ mail: [mail("m1", "outgoing", "2026-11-04T10:00:00Z")] }));
    expect(waiting.action).toBe("wait");
    const v = checkMailResult(answer(), waiting, "2026-11-05");
    expect(v).toMatchObject({ ok: false, kind: "not_allowed" });
    expect(overrideWithPlan(waiting)).toMatchObject({ action_type: "wait", recommended_send_at: "2026-11-09", should_send_now: false });
  });

  it("never allows a draft for a lost, not-interested or finished prospect, or for a reply that needs more context", () => {
    const lost = plan(inputs({ prospect: prospect({ status: "lost" }) }));
    expect(checkMailResult(answer({ action_type: "first_outreach" }), lost, "2026-11-05")).toMatchObject({ ok: false, kind: "not_allowed" });
    const blocked = plan(inputs({ mail: [mail("o", "outgoing", "2026-10-28T10:00:00Z"), mail("i", "incoming", "2026-11-04T08:00:00Z", { snippet: "ok" })] }));
    expect(checkMailResult(answer({ action_type: "reply" }), blocked, "2026-11-05")).toMatchObject({ ok: false, kind: "not_allowed" });
  });

  it("rejects an action type that is not the plan's, and structurally invalid answers", () => {
    expect(checkMailResult(answer({ action_type: "first_outreach" }), followUpNow, "2026-11-05")).toMatchObject({ ok: false });
    expect(checkMailResult(answer({ action_type: "send_everything_now" }), followUpNow, "2026-11-05")).toMatchObject({ ok: false });
    expect(checkMailResult({ subject: "x" }, followUpNow, "2026-11-05")).toMatchObject({ ok: false });
    expect(checkMailResult("not json", followUpNow, "2026-11-05")).toMatchObject({ ok: false });
  });

  it("rejects drafts that mention AI, scores, tracking or the discovery source, or that criticise the site", () => {
    for (const bad of ["Mijn AI-analyse gaf jullie site een score van 74.", "Ik zag via OpenStreetMap dat jullie bestaan.", "Ik zag dat je het concept gisteren om 14:37 bekeken hebt.", "I saw that you viewed it yesterday.", "Jullie website is verouderd en slecht.", "Bekijk het op https://voorbeeld.be nu."]) {
      const v = checkMailResult(answer({ body: `${bad} Laat maar weten wat je ervan vindt, dan kijken we samen verder naar de volgende stap. Groeten, Ian` }), followUpNow, "2026-11-05");
      expect(v.ok, bad).toBe(false);
    }
  });

  it("allows the natural question 'did you have a look?' (that is not revealing tracking)", () => {
    expect(revealsTracking("Heb je al de tijd gehad om het concept te bekijken?")).toBe(false);
    expect(revealsTracking("Did you have a chance to look at the concept yet?")).toBe(false);
    expect(revealsTracking("I saw that you viewed it at 14:37.")).toBe(true);
    expect(revealsTracking("Ik zag dat je het gisteren bekeken hebt.")).toBe(true);
    expect(forbiddenIn("Ik laat je weten of je het concept al bekeken hebt, geen stress.")).toBeNull();
  });

  it("rejects placeholders, exclamation marks, emoji and over-long follow-ups", () => {
    for (const body of ["Dag [naam], ik wou even terugkomen op mijn mail van vorige week, laat maar weten of je tijd had. Groeten, Ian", "Dag Sofie, ik wou even terugkomen op mijn mail van vorige week, laat maar weten of je tijd had! Groeten, Ian", "Dag Sofie, ik wou even terugkomen op mijn mail van vorige week, laat maar weten of je tijd had 😊 Groeten, Ian", `Dag Sofie, ${"ik wou even terugkomen op mijn vorige mail. ".repeat(30)} Groeten, Ian`]) {
      expect(checkMailResult(answer({ body }), followUpNow, "2026-11-05").ok, body.slice(0, 40)).toBe(false);
    }
  });

  it("keeps the language: an English draft for a Dutch conversation is rejected, and the other way round", () => {
    const en = "Hi Sofie, just following up on my email from last week about the booking flow on your site. Happy to show what I had in mind if you are interested. Best, Ian";
    expect(checkMailResult(answer({ body: en }), followUpNow, "2026-11-05")).toMatchObject({ ok: false });
    const english = plan(inputs({ mail: [mail("m", "outgoing", "2026-10-26T09:00:00Z", { subject: "A small idea", snippet: "Hi, I noticed that the booking flow on your site could be a bit more direct and wanted to share an idea." })] }));
    expect(english.language).toBe("en");
    expect(checkMailResult(answer({ body: en }), english, "2026-11-05").ok).toBe(true);
    expect(checkMailResult(answer(), english, "2026-11-05").ok).toBe(false);
  });

  it("a follow-up is much shorter than a first message", () => {
    const first = plan(inputs());
    const long = `Dag Sofie, ${"ik kwam jullie website tegen en had een kleine suggestie voor de reservatieflow. ".repeat(10)}Groeten, Ian`;
    expect(long.length).toBeGreaterThan(750);
    expect(long.length).toBeLessThanOrEqual(1100);
    expect(checkMailResult(answer({ action_type: "first_outreach", body: long }), first, "2026-11-05").ok).toBe(true);
    expect(checkMailResult(answer({ body: long }), followUpNow, "2026-11-05").ok).toBe(false);
  });
});

/* ------------------------------------------ discovery insight for a mail ------------------------------------------ */

import { insightFromCandidate, originOf } from "../src/lib/mail-assistant/insight";

describe("which discovery findings may reach a draft", () => {
  // The real evidence of a candidate stored by an earlier version of the Prospect Finder: no `origin` on any line.
  const stored = [
    { fact: "Listed in OpenStreetMap as shop=rental, 0.1 km from the search centre." },
    { fact: "The website is served over plain http (no https)." },
    { fact: "No call-to-action for a quote, booking or enquiry was found on the pages checked (1 page checked)." },
    { fact: "No booking or reservation link was found on the pages checked (3 pages checked)." },
    { fact: "No contact page link was found in the homepage navigation." },
    { fact: "The homepage has no meta description for search results." },
    { fact: "Interpretation: Reservation flow" },
  ];

  it("infers where an untagged finding came from, and trusts a tag when there is one", () => {
    expect(originOf({ fact: stored[0].fact })).toBe("listing");
    expect(originOf({ fact: stored[6].fact })).toBe("ai");
    expect(originOf({ fact: stored[2].fact })).toBe("website");
    expect(originOf({ fact: "anything", origin: "listing" })).toBe("listing");
  });

  it("keeps only what a person looking at the business could have noticed: the enquiry and booking flow, without bookkeeping", () => {
    const i = insightFromCandidate({ summary: "Strong potential fit for website modernisation and a reservation flow. Findings are limited to one checked page.", opportunity: "HTTPS modernisation + reservation and enquiry flow", evidence: stored, synthetic: false })!;
    expect(i.observations).toEqual([
      "No call-to-action for a quote, booking or enquiry was found on the pages checked.",
      "No booking or reservation link was found on the pages checked.",
      "No contact page link was found in the homepage navigation.",
    ]);
    expect(i.opportunity).toBe("HTTPS modernisation + reservation and enquiry flow");
    expect(i.summary).toContain("reservation flow");
  });

  it("leaves out listing text, the model's own lines, technical page details and analysis wording; never uses sample data", () => {
    const i = insightFromCandidate({ summary: "Car repair business 1.4 km from the search centre, listed in OpenStreetMap, score 80.", opportunity: "AI-assisted redesign", evidence: stored, synthetic: false })!;
    expect(i.summary).toBeNull();
    expect(i.opportunity).toBeNull();
    const text = JSON.stringify(i);
    for (const leak of ["OpenStreetMap", "search centre", "plain http", "meta description", "Interpretation", "score"]) expect(text, leak).not.toContain(leak);
    expect(insightFromCandidate({ summary: "x", opportunity: "y", evidence: stored, synthetic: true })).toBeNull();
    expect(insightFromCandidate(null)).toBeNull();
  });
});
