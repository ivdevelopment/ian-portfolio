import { addDays, brusselsToday, diffDays } from "@/lib/prospects/dates";

export const QUOTE_STATUSES = ["draft", "ready", "sent", "accepted", "rejected", "expired", "cancelled"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  ready: "Ready to send",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  cancelled: "Cancelled",
};

/** Belgian VAT rates offered per line. The person chooses; nothing is decided automatically. */
export const VAT_RATES = [0, 6, 12, 21] as const;
export const DEFAULT_VAT_RATE = 21;

export const QUOTE_LANGUAGES = ["nl", "en"] as const;
export type QuoteLanguage = (typeof QUOTE_LANGUAGES)[number];
export const QUOTE_LANGUAGE_LABELS: Record<QuoteLanguage, string> = { nl: "Nederlands", en: "English" };

export const CURRENCIES = ["EUR", "USD", "GBP"] as const;
export type QuoteCurrency = (typeof CURRENCIES)[number];

export const DISCOUNT_TYPES = ["none", "percent", "fixed"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** Unit suggestions (free text is allowed too). */
export const UNIT_SUGGESTIONS: Record<QuoteLanguage, readonly string[]> = {
  nl: ["stuk", "uur", "dag", "maand", "jaar", "pakket"],
  en: ["piece", "hour", "day", "month", "year", "package"],
};

export const DEFAULT_VALIDITY_DAYS = 14;
export const MAX_ITEMS = 100;

/**
 * The status transitions the database allows too (see quotes_guard). `expired` is mostly DERIVED from valid_until
 * (see effectiveStatus) and never written automatically.
 */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ["ready", "cancelled"],
  ready: ["draft", "sent", "cancelled"],
  sent: ["accepted", "rejected", "expired", "cancelled"],
  expired: ["sent", "accepted", "rejected", "cancelled"],
  accepted: ["cancelled"],
  rejected: ["cancelled"],
  cancelled: [],
};

export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

/** Content (client, lines, texts) can only change while the quote is a draft or ready. */
export function isEditable(status: QuoteStatus): boolean {
  return status === "draft" || status === "ready";
}

/** Only drafts can be deleted; everything else is kept as the record (cancel it instead). */
export function isDeletable(status: QuoteStatus): boolean {
  return status === "draft";
}

/**
 * What the reader sees: a sent quote whose validity has passed is "Expired", without anything being written to the database.
 * Accepting or rejecting it is still possible (the client may answer late).
 */
export function effectiveStatus(status: QuoteStatus, validUntil: string | null, today: string = brusselsToday()): QuoteStatus {
  return status === "sent" && validUntil !== null && validUntil < today ? "expired" : status;
}

/** Days until the quote expires (negative when past), or null without a date. */
export function daysUntilExpiry(validUntil: string | null, today: string = brusselsToday()): number | null {
  return validUntil ? diffDays(validUntil, today) : null;
}

export function defaultValidUntil(days: number = DEFAULT_VALIDITY_DAYS, today: string = brusselsToday()): string {
  return addDays(today, days);
}

/** Pipeline buckets for dashboards. Rejected, cancelled and expired quotes are never part of the open pipeline. */
export function isOpenPipeline(status: QuoteStatus, validUntil: string | null, today: string = brusselsToday()): boolean {
  const effective = effectiveStatus(status, validUntil, today);
  return effective === "ready" || effective === "sent";
}

/** Filesystem/HTTP-safe download name: "Q-2026-0004-geert-kips.pdf". */
export function quoteFileName(quoteNumber: string, clientName: string | null | undefined, clientCompany?: string | null): string {
  const raw = (clientCompany || clientName || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const slug = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  const number = quoteNumber.replace(/[^A-Za-z0-9-]/g, "");
  return `${number}${slug ? `-${slug}` : ""}.pdf`;
}
