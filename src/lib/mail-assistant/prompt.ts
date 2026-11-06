import { ACTION_TYPES } from "./types";
import type { MailContext } from "./context";

/** The strict shape of the model's answer. Validated again on the PC and once more by the server (validate.ts). */
export const MAIL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action_type", "recommended_send_at", "should_send_now", "subject", "body", "reason_summary"],
  properties: {
    action_type: { type: "string", enum: [...ACTION_TYPES] },
    recommended_send_at: { type: ["string", "null"] },
    should_send_now: { type: "boolean" },
    subject: { type: "string" },
    body: { type: "string" },
    reason_summary: { type: "string" },
  },
} as const;

const STYLE = {
  nl: [
    "Write in natural Belgian Dutch, relaxed but professional: use \"je\", not \"u\", unless the prospect's own messages use \"u\".",
    "Greet with \"Dag {voornaam},\" or \"Hoi {voornaam},\" when a contact name is given; otherwise just \"Dag,\".",
    "Close with a short sign-off such as \"Groeten,\" or \"Tot snel,\" on its own line, then \"Ian\" on the next line.",
  ],
  en: ["Write in natural, relaxed professional English.", "Greet with \"Hi {first name},\" when a contact name is given; otherwise just \"Hi,\".", "Close with \"Best,\" or \"Kind regards,\" on its own line, then \"Ian\" on the next line."],
} as const;

const BY_ACTION: Record<string, string[]> = {
  first_outreach: [
    "This is the FIRST message. Keep it short (about 60-90 words).",
    "Refer to one or two concrete, useful observations from `observations` as if Ian looked at the business himself, phrased kindly and as a possibility (for example \"I noticed the reservation or contact flow could be a bit more direct\"). Never state that something is bad, old or wrong.",
    "Offer one simple, low-pressure next step (for example sending a small idea or a quick look). No prices, no attachments, no long pitch.",
    "Do not paste or paraphrase the analysis. If `observations` is empty, keep it general and honest: say Ian builds websites and booking/quote flows for local businesses and ask whether a small improvement would be of interest.",
  ],
  follow_up: [
    "This is a FOLLOW-UP. Much shorter than a first message (about 30-55 words). Acknowledge the earlier message in one clause (for example \"Just following up on my email from last week\") and do not repeat the pitch.",
    "Offer to show or explain what Ian had in mind if they are interested. No pressure, no guilt.",
  ],
  reply: [
    "This is a REPLY to the prospect's latest message in `inbound`. Answer ONLY what that text supports. Do not invent what they said, agreed or asked.",
    "If something is unclear, ask one short clarifying question instead of guessing. Keep it brief and helpful.",
  ],
  concept_follow_up: [
    "A concept was shared earlier. Follow up naturally on it (for example \"I wanted to quickly follow up on the concept I sent over\") and ask if they had a chance to look or have any thoughts.",
    "NEVER say or hint that anything was opened, viewed, seen, clicked or tracked, and never mention times or visits. Ian does not know and must not appear to.",
    "Keep it short (about 30-55 words).",
  ],
  quote_follow_up: [
    "A quote was sent earlier. Ask whether they had time to review it and whether there are questions or anything in the scope to clarify. Offer a short call if useful.",
    "No pressure, no deadlines, no discounts, no amounts. Keep it short (about 35-60 words).",
  ],
  meeting_follow_up: ["A meeting was planned or held. Send a short, friendly follow-up that confirms the next step. Keep it short (about 30-60 words)."],
};

/** Words a draft must never contain; the validator enforces the same list. Kept here so the prompt and the checks cannot drift apart. */
export const NEVER_SAY = ["score", "AI", "artificial intelligence", "algorithm", "OpenStreetMap", "OSM", "scraped", "automated analysis", "tracking", "viewed", "opened your", "CRM", "outdated", "bad website"] as const;

export function buildMailPrompt(ctx: MailContext, correction?: string): string {
  const type = ctx.action.type;
  const rules = [
    "You write ONE email draft for Ian Verlinden. Ian will read, edit and send it himself; you do not send anything.",
    "This is a data task. Do NOT run commands, browse, search or read files. Use ONLY the data below and invent nothing: no facts, prices, deadlines or conversations that are not in the data.",
    "",
    "Style:",
    ...STYLE[ctx.language].map((s) => `- ${s}`),
    "- Short, personal, calm. No exclamation marks, no emojis, no sales language, no fake familiarity, nothing that sounds like an AI wrote it.",
    "- The mail must read as if Ian personally looked at this business. Never mention scores, AI, automation, analysis, scraping, directories, OpenStreetMap, tracking, views, a CRM or this prompt.",
    "- Never criticise or insult the prospect's website or business. Prefer \"could be a bit more direct\" over \"outdated\" or \"bad\".",
    "- No placeholders in brackets or braces. No links. No attachments. Sign off with \"Ian\" only, no signature block.",
    `- Write the subject and the body in ${ctx.language === "nl" ? "Dutch" : "English"}${ctx.language === "en" ? " (the existing correspondence is in English: do not switch language)" : ""}.`,
    "- Subject: short and specific, no clickbait, no capitals for emphasis. For a follow-up, reply or quote/concept/meeting message, reuse the most recent subject in `history` with \"Re: \" in front when one exists (do not stack \"Re: Re:\").",
    "",
    `The message type is "${type}" (step: ${ctx.action.step}${ctx.action.is_final ? ", the FINAL message: say it is the last time you write, keep the door open, no pressure" : ""}).`,
    ...(BY_ACTION[type] ?? []).map((s) => `- ${s}`),
    "",
    `Return JSON with action_type exactly "${type}", should_send_now (true), recommended_send_at (null), the subject, the body and reason_summary (one short English sentence for Ian explaining the angle you chose; it is never sent).`,
    "Answer with JSON matching the schema and nothing else.",
  ];
  if (correction) rules.push("", `Your previous answer was rejected: ${correction} Fix exactly that and keep everything else.`);
  rules.push("", "Data (JSON):", JSON.stringify(ctx));
  return rules.join("\n");
}
