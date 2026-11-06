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

/** What each preset asks for. The default, casual, is also what a plain "Generate" uses. */
export const TONE_GUIDANCE: Record<TonePreset, string> = {
  casual: "Casual and human, like a freelancer typing a normal personal email: simple sentences, relaxed, slightly informal is fine. This is the default.",
  friendly: "A little warmer and more personal than casual, still short and natural. A friendly touch, not gushing.",
  professional: "A bit cleaner and more formal, still natural and still short. Never stiff, never an essay.",
  direct: "Short, clear, minimal fluff: say what you noticed, what you suggest, and ask.",
  soft_sales: "Slightly more persuasive about the benefit of the idea, but never pushy: no pressure, no urgency, no promises.",
  very_short: "As short as possible: two or three short sentences at most. Greeting and sign-off still apply.",
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
