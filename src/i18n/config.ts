/**
 * Dutch is the default locale and has NO URL prefix; English lives under /en.
 * Admin (/admin) and API (/api) routes are never localized.
 */
export const locales = ["nl", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "nl";
export const LOCALE_COOKIE = "site-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Value for <html lang> and hreflang alternates (one coherent strategy: nl-BE + en). */
export const htmlLang: Record<Locale, string> = { nl: "nl-BE", en: "en" };
export const hreflang = htmlLang;

/** Open Graph locale. */
export const ogLocale: Record<Locale, string> = { nl: "nl_BE", en: "en_GB" };

/** Locale tags for Intl formatting. */
export const intlLocale: Record<Locale, string> = { nl: "nl-BE", en: "en-US" };

/** Visitors see dates in the owner's timezone. */
export const TIME_ZONE = "Europe/Brussels";
