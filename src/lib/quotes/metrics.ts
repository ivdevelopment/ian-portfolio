import { brusselsToday } from "@/lib/prospects/dates";
import { effectiveStatus, type QuoteStatus } from "./constants";

export type MetricRow = { status: QuoteStatus; validUntil: string | null; netCents: number; totalCents: number };

export type Bucket = { count: number; netCents: number };

export type QuoteMetrics = {
  /** Drafts (not yet ready). */
  draft: Bucket;
  /** Ready to send. */
  ready: Bucket;
  /** Sent and still within their validity. */
  sent: Bucket;
  accepted: Bucket;
  /** Sent but past their validity (nothing was written to the database). */
  expired: Bucket;
  /** Ready + sent (not expired): quotes that can still turn into work. Rejected, cancelled and expired never count. */
  open: Bucket;
};

const empty = (): Bucket => ({ count: 0, netCents: 0 });

/**
 * Dashboard figures. Values are NET (excl. VAT, after discounts): what the work is worth to the business.
 * Rejected and cancelled quotes are ignored entirely; expired ones are reported separately and are not "open".
 */
export function summarizeQuotes(rows: readonly MetricRow[], today: string = brusselsToday()): QuoteMetrics {
  const out: QuoteMetrics = { draft: empty(), ready: empty(), sent: empty(), accepted: empty(), expired: empty(), open: empty() };
  for (const row of rows) {
    const status = effectiveStatus(row.status, row.validUntil, today);
    const bucket = status === "draft" ? out.draft : status === "ready" ? out.ready : status === "sent" ? out.sent : status === "accepted" ? out.accepted : status === "expired" ? out.expired : null;
    if (!bucket) continue;
    bucket.count += 1;
    bucket.netCents += row.netCents;
    if (status === "ready" || status === "sent") {
      out.open.count += 1;
      out.open.netCents += row.netCents;
    }
  }
  return out;
}
