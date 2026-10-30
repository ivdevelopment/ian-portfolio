import { intlLocale, TIME_ZONE, type Locale } from "./config";

/** "29 oktober 2026" / "October 29, 2026", in the owner's timezone. */
export function formatDate(locale: Locale, value: Date | string | number): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: "long",
    timeZone: TIME_ZONE,
  }).format(new Date(value));
}

/** "29 oktober 2026 om 14:30" / "October 29, 2026 at 2:30 PM". */
export function formatDateTime(locale: Locale, value: Date | string | number): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: TIME_ZONE,
  }).format(new Date(value));
}

/**
 * Budget display label. The stored value ("€1,000 – €2,500", "< €1,000", "€5,000+")
 * never changes; only its presentation does. Dutch: "€ 1.000 – € 2.500".
 */
export function formatBudgetLabel(locale: Locale, stored: string): string {
  if (locale === "en") return stored;
  return stored.replace(/€\s?(\d{1,3}(?:,\d{3})*)/g, (_, amount: string) => {
    const n = Number(amount.replace(/,/g, ""));
    return `€ ${new Intl.NumberFormat(intlLocale.nl).format(n)}`;
  });
}
