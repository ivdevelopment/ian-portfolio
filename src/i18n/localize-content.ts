import { defaultLocale, type Locale } from "./config";
import { knownDutch } from "./known-dutch";

/** Keys whose strings are structure, not copy: always taken from the base (English) row. */
const STRUCTURAL_KEYS = new Set(["src", "href", "id", "email", "value", "icon", "slug"]);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Resolves one text value: the admin's saved translation, else a known Dutch rendering, else the base text. */
function resolveText(base: string, override: unknown): string {
  if (typeof override === "string" && override.trim() !== "") return override;
  return knownDutch(base) ?? base;
}

/**
 * Localizes structured CMS content. `base` is the stored (English) content and
 * `override` the saved Dutch translation (may be missing or partial).
 *
 * - English: `base`, unchanged.
 * - Dutch: for every text field, saved translation → known Dutch rendering →
 *   base text. Links, images, ids, numbers, flags and list lengths always come
 *   from `base`, so a translation can never break structure.
 */
export function localizeContent<T>(locale: Locale, base: T, override?: unknown): T {
  if (locale !== "nl") return base;
  return walk(base, override, undefined) as T;
}

function walk(base: unknown, override: unknown, key: string | undefined): unknown {
  if (typeof base === "string") {
    return key && STRUCTURAL_KEYS.has(key) ? base : resolveText(base, override);
  }
  if (Array.isArray(base)) {
    return base.map((item, i) => walk(item, Array.isArray(override) ? override[i] : undefined, key));
  }
  if (isPlainObject(base)) {
    const o = isPlainObject(override) ? override : {};
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, walk(v, o[k], k)]));
  }
  return base;
}

/** Reads `translations[locale]` from a jsonb column, tolerating anything. */
export function translationFor(translations: unknown, locale: Locale): unknown {
  if (locale === defaultLocale && !isPlainObject(translations)) return undefined;
  return isPlainObject(translations) ? translations[locale] : undefined;
}

/** First non-empty string: saved translation, then known rendering, then base. */
export function localizeText(locale: Locale, base: string | undefined | null, override?: unknown): string {
  const text = base ?? "";
  if (locale !== "nl") return text;
  return resolveText(text, override);
}

/** Dutch location text: "Belgium, 8000 Brugge" → "België, 8000 Brugge" unless overridden. */
export function localizeLocation(locale: Locale, base: string, override?: unknown): string {
  if (locale !== "nl") return base;
  if (typeof override === "string" && override.trim() !== "") return override;
  return base.replace(/\bBelgium\b/g, "België");
}
