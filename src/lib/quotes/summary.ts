import { calculateQuote, centsToDecimal, type QuoteTotals } from "./money";
import type { QuoteRecord } from "./types";

/**
 * The figures of a saved quote, calculated from its lines with the same calculator that produced the stored numbers.
 * The detail page, the PDF and the exports all read this, so what is shown can never drift from what was saved.
 */
export function quoteTotals(quote: Pick<QuoteRecord, "items" | "discountType" | "discountValue">): QuoteTotals {
  return calculateQuote({
    lines: quote.items.map((i) => ({ quantity: i.quantity, unitPrice: centsToDecimal(i.unitPriceCents), discountPercent: i.discountPercent, taxRate: i.taxRate })),
    discount: { type: quote.discountType, value: quote.discountValue },
  });
}

/** True when the stored header figures equal a fresh calculation (they always do; used by tests and a sanity guard). */
export function storedTotalsMatch(quote: QuoteRecord): boolean {
  const t = quoteTotals(quote);
  return t.subtotal === quote.subtotalCents && t.discountTotal === quote.discountCents && t.taxTotal === quote.taxCents && t.total === quote.totalCents;
}
