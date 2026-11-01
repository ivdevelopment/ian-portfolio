import { Badge } from "./ui";
import { QUOTE_STATUS_LABELS, effectiveStatus, type QuoteStatus } from "@/lib/quotes/constants";
import { formatCents, formatPercent, type QuoteTotals } from "@/lib/quotes/money";
import type { QuoteCurrency, QuoteLanguage } from "@/lib/quotes/constants";
import { cn } from "@/lib/utils";

const TONES: Record<QuoteStatus, "neutral" | "accent" | "success" | "warn" | "danger"> = {
  draft: "neutral",
  ready: "warn",
  sent: "accent",
  accepted: "success",
  rejected: "danger",
  expired: "warn",
  cancelled: "neutral",
};

/** The status as the reader should see it: a sent quote past its validity reads "Expired" (nothing is written). */
export function QuoteStatusBadge({ status, validUntil }: { status: QuoteStatus; validUntil: string | null }) {
  const shown = effectiveStatus(status, validUntil);
  return <Badge tone={TONES[shown]}>{QUOTE_STATUS_LABELS[shown]}</Badge>;
}

/** Excl. VAT / VAT per rate / Incl. VAT, always in this order and always labelled. */
export function QuoteTotalsBlock({
  totals,
  currency,
  language,
  className,
}: {
  totals: Pick<QuoteTotals, "subtotal" | "discountTotal" | "taxTotal" | "total" | "vat" | "taxableTotal" | "lineDiscountTotal">;
  currency: QuoteCurrency;
  language: QuoteLanguage;
  className?: string;
}) {
  const money = (cents: number) => formatCents(cents, currency, language);
  return (
    <dl className={cn("space-y-1.5 text-sm", className)} data-testid="quote-totals">
      {(totals.discountTotal > 0 || totals.lineDiscountTotal > 0) && (
        <Row label="Subtotal" value={money(totals.subtotal)} hint={totals.lineDiscountTotal > 0 ? `after ${money(totals.lineDiscountTotal)} line discounts` : undefined} />
      )}
      {totals.discountTotal > 0 && <Row label="Discount" value={`− ${money(totals.discountTotal)}`} />}
      <Row label="Total excl. VAT" value={money(totals.taxableTotal)} strong />
      {totals.vat.map((v) => (
        <Row key={v.rate} label={`VAT ${formatPercent(v.rate, "en")}`} value={money(v.tax)} muted hint={`on ${money(v.base)}`} />
      ))}
      {totals.vat.length > 1 && <Row label="Total VAT" value={money(totals.taxTotal)} />}
      <div className="border-t border-line pt-2">
        <Row label="Total incl. VAT" value={money(totals.total)} strong big />
      </div>
    </dl>
  );
}

function Row({ label, value, hint, strong, muted, big }: { label: string; value: string; hint?: string; strong?: boolean; muted?: boolean; big?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("text-muted", muted && "text-subtle")}>
        {label}
        {hint && <span className="ml-1.5 text-xs text-subtle">{hint}</span>}
      </dt>
      <dd className={cn("tabular-nums", strong && "font-medium text-ink", big && "text-lg", muted && "text-muted")}>{value}</dd>
    </div>
  );
}
