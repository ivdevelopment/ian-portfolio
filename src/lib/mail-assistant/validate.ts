import { z } from "zod";
import { detectLanguage } from "./language";
import { DEFAULT_TONE, type TonePreset } from "./tone";
import { ACTION_TYPES, isDraftAction, type ActionType, type Plan, type Recommendation } from "./types";

/**
 * The server's (and the agent's) guardrails around the model's answer. The deterministic plan is authoritative: the model may write the
 * words, but it cannot change WHAT is sent, WHEN, or whether anything is sent at all. Anything inconsistent is rejected, or overridden
 * by the plan, and never stored as a recommendation.
 */
export const mailResultSchema = z.object({
  action_type: z.enum(ACTION_TYPES),
  recommended_send_at: z.string().max(10).nullable().optional(),
  should_send_now: z.boolean(),
  subject: z.string().max(400),
  body: z.string().max(6000),
  reason_summary: z.string().max(600),
});
export type MailResult = z.infer<typeof mailResultSchema>;

export const LIMITS = {
  subject: { min: 3, max: 120 },
  /** A follow-up is deliberately much shorter than a first message. */
  body: { first_outreach: 1100, reply: 1500, default: 750, min: 25 },
  reason: 300,
  /** A very short mail is much shorter still. No preset ever allows more than the limits above. */
  veryShort: { first_outreach: 450, reply: 700, default: 300 },
} as const;

/** Things a draft must never contain. Each has a plain reason that is shown to Ian when a draft is rejected. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\b(ai|a\.i\.|artificial intelligence|kunstmatige intelligentie|algorithm\w*|algoritme\w*|machine learning|chatgpt|openai|gpt|codex)\b/i, "mentions AI"],
  [/\b(score|scored|scoring|punten)\b/i, "mentions a score"],
  [/\b(openstreetmap|osm|scrap\w+|geschraapt|crm|prospect finder|prospectfinder)\b/i, "mentions how the business was found"],
  [/\b(automated|automatically|automatisch|geautomatiseerd|automated analysis)\b/i, "mentions automation"],
  [/\b(tracking|tracked|getrackt|analytics|pixel)\b/i, "mentions tracking"],
  [/\b(outdated|out-of-date|verouderd|ouderwets|ugly|lelijk|terrible|awful|slecht(e)?|bad (website|site|design)|amateur\w*|rommelig|messy)\b/i, "criticises the prospect's website"],
  [/https?:\/\/|www\./i, "contains a link"],
  // Stock sales-copy constructions and fake familiarity (everyday single words such as "duidelijk" are NOT banned).
  [/als dat (voor jullie |voor u )?interessant is|ik bouw websites en reservatieflows|digitale aanwezigheid|op maat gemaakte oplossing|effici[eë]nte workflow|streamlin\w*|gerichte oplossing|graag licht ik (dit|het) verder toe|verbeteren van de conversie|gebruikerservaring (te )?optimaliseren/i, "uses stock sales-copy wording"],
  [/hopelijk gaat alles goed|ik volg jullie al (een tijdje|lang)|ik ben (een )?fan van (wat|jullie)/i, "claims a familiarity that is not in the data"],
  [/[[\]{}<>]|\{\{|\}\}|lorem ipsum|xxx/i, "contains a placeholder"],
  [/!{1,}/, "uses an exclamation mark"],
  [/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "contains an emoji"],
];

/**
 * "Did you have a look?" is a normal question; "I saw that you viewed it at 14:37" is surveillance. A sentence is flagged only when it says
 * Ian saw / noticed / was told something AND that the prospect viewed / opened / clicked / visited something (English or Dutch), or when it
 * quotes a clock time next to such a word.
 */
const SAW = /\b(saw|seen|see|noticed|notice|can tell|know that|zag|gezien|zie|gemerkt|merkte|opgemerkt|weet dat|notification|melding|bleek)\b/i;
const LOOKED = /\b(viewed|opened|clicked|visited|looked at|checked out|bekeken|geopend|bezocht|geklikt)\b/i;
const CLOCK = /\b([01]?\d|2[0-3])[:.h][0-5]\d\b/;

export function revealsTracking(text: string): boolean {
  return text
    .split(/(?<=[.?!])\s+|\n+/)
    .some((s) => (SAW.test(s) && LOOKED.test(s)) || (LOOKED.test(s) && CLOCK.test(s)));
}

export function forbiddenIn(text: string): string | null {
  for (const [re, why] of FORBIDDEN) if (re.test(text)) return why;
  if (revealsTracking(text)) return "reveals that the prospect looked at something";
  return null;
}

export type Verdict = { ok: true; recommendation: Recommendation; note: string | null } | { ok: false; reason: string; kind: "invalid_output" | "not_allowed" };

const fail = (reason: string, kind: "invalid_output" | "not_allowed" = "invalid_output"): Verdict => ({ ok: false, reason, kind });

/**
 * Checks one answer against the plan it was generated for.
 *  - No draft is accepted unless the plan itself calls for one (wait, no_action and "more context needed" never get a draft).
 *  - The action must be the plan's action, and the date and "send now" come from the plan, whatever the model said.
 *  - Subject and body must be clean, in the right language, free of tracking talk, scores, insults and placeholders, and short enough.
 */
export function checkMailResult(raw: unknown, plan: Plan, today: string, tone: TonePreset = DEFAULT_TONE): Verdict {
  const parsed = mailResultSchema.safeParse(raw);
  if (!parsed.success) return fail("The answer did not have the required structure.");
  const r = parsed.data;

  if (!plan.needs_ai || !isDraftAction(plan.action)) return fail(`The plan says ${plan.action === "wait" ? "to wait" : plan.action === "no_action" ? "that no mail should be sent" : "that more context is needed"}, so no draft is accepted.`, "not_allowed");
  if (r.action_type !== plan.action) return fail(`The draft is for "${r.action_type}" but the situation calls for "${plan.action}".`);

  const subject = r.subject.replace(/\s+/g, " ").trim();
  const body = r.body.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (subject.length < LIMITS.subject.min || subject.length > LIMITS.subject.max) return fail("The subject must be between 3 and 120 characters.");
  if (/[\r\n]/.test(r.subject.trim())) return fail("The subject must be one line.");
  if (body.length < LIMITS.body.min) return fail("The body is empty or too short.");
  const table = tone === "very_short" ? LIMITS.veryShort : LIMITS.body;
  const max = plan.action === "first_outreach" ? table.first_outreach : plan.action === "reply" ? table.reply : table.default;
  if (body.length > max) return fail(`The body is too long for this kind of message (${body.length} characters, at most ${max}).`);

  for (const [label, text] of [["subject", subject], ["body", body]] as const) {
    const why = forbiddenIn(text);
    if (why) return fail(`The ${label} ${why}.`);
  }
  const reason = r.reason_summary.replace(/\s+/g, " ").trim();
  if (reason.length === 0) return fail("The reason is missing.");

  // The language of the existing conversation is kept: a draft in the other language is rejected (short drafts that are inconclusive pass).
  const lang = detectLanguage(body);
  if (lang && lang !== plan.language) return fail(`The draft is in ${lang === "nl" ? "Dutch" : "English"} but the conversation is in ${plan.language === "nl" ? "Dutch" : "English"}.`);

  // The model's own date and "send now" are ignored: the plan decides when. A mismatch is overridden and noted, never trusted.
  const sendDay = plan.recommended_on;
  const note = r.recommended_send_at && sendDay && r.recommended_send_at !== sendDay ? "The suggested date was replaced by the timing rules." : r.should_send_now && sendDay && sendDay !== today ? "The draft was ready, but the timing rules put it on the next working day." : null;
  return { ok: true, note, recommendation: { action_type: plan.action, recommended_send_at: sendDay, should_send_now: sendDay === today, subject, body, reason_summary: reason.slice(0, LIMITS.reason) } };
}

/**
 * What may be shown when the model's answer disagrees with the situation, expressed as a plan: a "send a follow-up now" for a prospect who
 * was emailed yesterday becomes "wait", with the date from the rules. Used for the page and by the tests; no draft survives.
 */
export function overrideWithPlan(plan: Plan): { action_type: ActionType; recommended_send_at: string | null; should_send_now: false; reason_summary: string } {
  return { action_type: plan.action, recommended_send_at: plan.recommended_on, should_send_now: false, reason_summary: plan.reason };
}
