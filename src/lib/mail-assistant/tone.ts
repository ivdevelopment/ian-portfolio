/**
 * Tone controls for a draft (P10.5.1). Tone only changes HOW a message is worded. It can never change the action, the language, the timing,
 * the facts or any rule: the plan decides those, the validator enforces them, and a custom instruction is treated as untrusted style preference.
 */
export const TONE_PRESETS = ["casual", "friendly", "professional", "direct", "soft_sales", "very_short"] as const;
export type TonePreset = (typeof TONE_PRESETS)[number];
export const DEFAULT_TONE: TonePreset = "casual";

export const TONE_LABELS: Record<TonePreset, string> = {
  casual: "Casual",
  friendly: "Friendly",
  professional: "Professional",
  direct: "Direct",
  soft_sales: "Soft sales",
  very_short: "Very short",
};

export const isTonePreset = (v: unknown): v is TonePreset => typeof v === "string" && (TONE_PRESETS as readonly string[]).includes(v);

/**
 * What each preset asks for. Every preset is a variation of Ian's own writing voice (voice.ts), never a different, generic style.
 * The default, casual, is Ian's voice as is, and also what a plain "Generate" uses.
 */
export const TONE_GUIDANCE: Record<TonePreset, string> = {
  casual: "Ian's voice as it is: relaxed, plain, the way he normally types an email. This is the default.",
  friendly: "A warmer version of Ian's voice: a bit more personal, still short and natural. A friendly touch, not gushing or enthusiastic.",
  professional: "A cleaner version of Ian's voice: slightly tidier sentences, a bit less slang. Still Ian, still natural, never corporate or stiff.",
  direct: "A shorter version of Ian's voice: fewer words, straight to the point, still in his own phrasing.",
  soft_sales: "A slightly more persuasive version of Ian's voice: say a little more about why the idea could help, but never pushy: no pressure, no urgency, no promises, no marketing language.",
  very_short: "A compressed version of Ian's voice: two or three short sentences at most, written in his words. Greeting and sign-off still apply.",
};

export const CUSTOM_INSTRUCTION_MAX = 200;

/** A custom instruction is plain text only: control characters and markup are removed and it is cut to a short length. Empty means none. */
export function sanitizeCustomInstruction(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[<>{}[\]`]/g, "").replace(/\s+/g, " ").trim().slice(0, CUSTOM_INSTRUCTION_MAX);
  return cleaned.length > 0 ? cleaned : null;
}

export type ToneChoice = { preset: TonePreset; custom_instruction: string | null };

/** Validates what the browser sent. An unknown preset is refused, never silently replaced. */
export function parseToneChoice(input: unknown): { ok: true; tone: ToneChoice } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, tone: { preset: DEFAULT_TONE, custom_instruction: null } };
  if (typeof input !== "object") return { ok: false, error: "That tone is not available." };
  const o = input as { preset?: unknown; customInstruction?: unknown };
  const preset = o.preset === undefined || o.preset === "custom" ? DEFAULT_TONE : o.preset;
  if (!isTonePreset(preset)) return { ok: false, error: "That tone is not available." };
  return { ok: true, tone: { preset, custom_instruction: sanitizeCustomInstruction(o.customInstruction) } };
}
