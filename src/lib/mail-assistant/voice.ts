/**
 * "Ian writing voice": the reusable style profile that every Mail Assistant draft is written in (P10.5.2).
 *
 * It replaces a pile of rigid "sound human" rules with one description of how Ian actually writes, a few varied examples and a short list of
 * templated constructions to avoid. It affects WORDING ONLY: the action, language, timing, facts and guardrails stay deterministic (plan.ts,
 * validate.ts). The tone presets are variations of this voice, not separate styles, so no preset falls back to generic marketing copy.
 */

export const IAN_VOICE_NL = [
  "Write as Ian himself, a freelance web developer from around Brugge, typing a normal email in one pass.",
  "Natural Belgian Dutch. Relaxed professional. Short and readable. Conversational, not overly polished.",
  "Not agency copy, not corporate, not sales language. No fake enthusiasm, no exaggerated friendliness, no unnecessary jargon, no long explanations of benefits.",
  "There is NO fixed structure. Do not run observation, then solution, then pitch, then call to action as a template. Write it the way a person would: sometimes the idea first, sometimes a plain question, sometimes how you came across them.",
  "Natural phrasing Ian likes (use what fits, never all of them, and not the same ones every time): \"Ik kwam jullie website tegen...\", \"Ik zag niet meteen...\", \"Ik dacht dat...\", \"Misschien zou...\", \"Ik maak zelf websites als freelancer.\", \"Als je wilt, kan ik eens tonen hoe ik dat zou aanpakken.\", \"Laat gerust iets weten.\"",
  "Vary the opening (how Ian found them, the thing he noticed, a simple question, a practical idea) and vary the closing. Do not always end on a question, and never on a stock line such as \"Zou dit interessant zijn?\".",
] as const;

export const IAN_VOICE_EN = [
  "Write as Ian himself, a freelance web developer from around Brugge, typing a normal email in one pass.",
  "Natural, relaxed, plain English. Short and readable, conversational, not overly polished. Not agency copy, not corporate, not sales language; no fake enthusiasm, no jargon, no long explanations of benefits.",
  "There is NO fixed structure (do not run observation, solution, pitch, call to action as a template). Vary the opening and the closing from one email to the next.",
] as const;

/** Templated constructions that read as machine- or marketing-written. Single everyday words are fine; these constructions are what to avoid. */
export const TEMPLATED_CONSTRUCTIONS = [
  "Als dat voor jullie interessant is",
  "Zou dit / zoiets interessant zijn? / Zou zoiets voor jullie van pas komen?",
  "Zou je het fijn vinden als...",
  "Ik bouw websites en reservatieflows voor lokale zaken",
  "Ik had een klein idee (as a recurring opener)",
  "digitale aanwezigheid",
  "optimaliseren / de gebruikerservaring / de conversie verbeteren",
  "op maat gemaakte oplossing",
  "efficiënte workflow",
  "streamlinen",
  "gerichte oplossing",
  "graag licht ik dit verder toe",
] as const;

export const FAKE_FAMILIARITY = ["Hopelijk gaat alles goed", "Ik volg jullie al een tijdje", "Ik ben fan van wat jullie doen"] as const;

/** Everyday words that pile up in machine-written Dutch: fine on their own, not in every paragraph. */
export const OVERUSED_WORDS = ["duidelijk", "eenvoudig", "interessant", "direct", "oplossing"] as const;

export type OpeningStyle = "found_them" | "noticed" | "question" | "idea";
export const OPENING_STYLES: Record<OpeningStyle, string> = {
  found_them: "start with how you came across them (for example that you came across their website)",
  noticed: "start with the thing you noticed on their site",
  question: "start with a simple, honest question",
  idea: "start with the practical idea you had",
};

/** A deterministic nudge so that different prospects do not all get the same opening. A hint, never a rule: the model may pick another if it fits better. */
export function openingLean(seed: string): OpeningStyle {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const styles = Object.keys(OPENING_STYLES) as OpeningStyle[];
  return styles[h % styles.length];
}

/**
 * Few-shot style calibration. Invented, generic and deliberately DIFFERENT in shape (different openings, closings and lengths) so the model learns
 * the voice and not a template. They carry no real company facts: never copy their wording, observations or ideas.
 */
export const VOICE_EXAMPLES_NL: readonly string[] = [
  "Dag,\n\nIk kwam jullie website tegen toen ik naar een bakker in de buurt zocht. Ik zag niet meteen waar je een bestelling kan plaatsen, misschien zit het ergens verstopt.\n\nIk maak zelf websites als freelancer. Als je wilt, kan ik eens tonen hoe ik dat zou aanpakken.\n\nGroeten,\nIan",
  "Dag Els,\n\nIk dacht dat een knop \"Vraag een offerte aan\" bovenaan jullie site wel zou helpen, nu moet je daarvoor eerst door drie pagina's.\n\nLaat gerust iets weten als je daar eens over wil praten.\n\nGroeten,\nIan",
  "Dag,\n\nKan je bij jullie eigenlijk online een tafel reserveren? Ik vond het niet meteen terug op de site.\n\nIk maak zelf websites en zoiets is meestal snel gedaan. Misschien zou een simpel formuliertje al genoeg zijn.\n\nGroeten,\nIan",
];

export const VOICE_FOLLOW_UP_EXAMPLES_NL: readonly string[] = [
  "Dag,\n\nIk wou even terugkomen op mijn vorige mail, voor als die tussen de rest is gerold. Laat gerust iets weten.\n\nGroeten,\nIan",
  "Dag Els,\n\nNog een korte reactie op mijn mail van vorige week. Als het niet past, is dat helemaal oké.\n\nGroeten,\nIan",
];

export function voiceProfile(language: "nl" | "en"): readonly string[] {
  return language === "nl" ? IAN_VOICE_NL : IAN_VOICE_EN;
}
