/**
 * Which language a message is written in, from common function words. Used twice: to continue the language of the existing conversation
 * (never switch mid-thread), and to check that a generated draft really is in the language it was asked for. Deliberately simple and
 * deterministic: it only answers when the text is clear enough, otherwise it says "unknown".
 */
export type Language = "nl" | "en";

const NL = new Set(["de", "het", "een", "en", "van", "ik", "je", "jij", "jullie", "u", "uw", "jouw", "is", "dat", "die", "dit", "niet", "met", "voor", "op", "te", "zijn", "ook", "maar", "als", "bij", "naar", "over", "mijn", "graag", "hoi", "dag", "bedankt", "groeten", "alvast", "even", "nog", "wat", "wel", "kan", "kunnen", "heb", "hebben", "geen", "of", "om", "aan", "uit", "zou", "wil", "willen", "hallo", "goedemorgen", "goedendag", "vriendelijke", "bericht", "mail", "terug", "tijd", "deze", "naar"]);
const EN = new Set(["the", "and", "of", "to", "in", "is", "that", "it", "for", "with", "you", "your", "my", "have", "has", "are", "was", "be", "this", "on", "at", "as", "or", "not", "but", "we", "our", "just", "would", "could", "if", "can", "will", "hi", "hello", "thanks", "thank", "best", "regards", "following", "email", "message", "happy", "let", "know", "about", "from", "had", "so", "me", "an"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z]+/)
    .filter((w) => w.length > 0);
}

/** "nl", "en", or null when the text is too short or too mixed to say. */
export function detectLanguage(text: string): Language | null {
  const ws = words(text);
  if (ws.length < 4) return null;
  let nl = 0;
  let en = 0;
  for (const w of ws) {
    if (NL.has(w)) nl++;
    if (EN.has(w)) en++;
  }
  if (nl + en < 3) return null;
  if (nl >= en * 1.5) return "nl";
  if (en >= nl * 1.5) return "en";
  return null;
}

/**
 * The language to write in: the language of the existing correspondence (newest first, the prospect's own messages count first, then ours),
 * otherwise Dutch, which is the default for Belgian prospects. A conversation that is already in English stays in English.
 */
export function conversationLanguage(samples: ReadonlyArray<{ direction: "incoming" | "outgoing"; text: string }>): Language {
  const ordered = [...samples.filter((s) => s.direction === "incoming"), ...samples.filter((s) => s.direction === "outgoing")];
  for (const s of ordered) {
    const lang = detectLanguage(s.text);
    if (lang) return lang;
  }
  return "nl";
}
