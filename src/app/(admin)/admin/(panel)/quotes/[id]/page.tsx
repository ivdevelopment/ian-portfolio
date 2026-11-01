import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { QuoteDetailActions, type DetailProspect } from "@/components/admin/quote-detail-actions";
import { QuotePdfButtons } from "@/components/admin/quote-pdf-buttons";
import { QuoteStatusBadge, QuoteTotalsBlock } from "@/components/admin/quote-ui";
import { AdminPageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { SectionSkeleton } from "@/components/ui/loading";
import { daysUntilExpiry, effectiveStatus } from "@/lib/quotes/constants";
import { formFromQuote } from "@/lib/quotes/form";
import { formatCents, formatPercent, formatQuantity } from "@/lib/quotes/money";
import { getQuote, listQuoteActivities } from "@/lib/quotes/queries";
import { readinessIssues } from "@/lib/quotes/schema";
import { quoteTotals } from "@/lib/quotes/summary";
import { formatDay } from "@/lib/prospects/dates";
import type { ProspectStatus } from "@/lib/prospects/constants";

export default async function QuoteDetailPage({ params }: PageProps<"/admin/quotes/[id]">) {
  const { id } = await params;
  const quote = await getQuote(id);
  if (!quote) notFound();

  const totals = quoteTotals(quote);
  const money = (cents: number) => formatCents(cents, quote.currency, quote.language);
  const shown = effectiveStatus(quote.status, quote.validUntil);
  const days = daysUntilExpiry(quote.validUntil);
  const prospect: DetailProspect | null = quote.prospect
    ? { id: quote.prospect.id, companyName: quote.prospect.companyName, status: quote.prospect.status as ProspectStatus, quoteValueCents: quote.prospect.quoteValueCents }
    : null;

  return (
    <>
      <AdminPageHeader
        title={quote.number}
        description={quote.title ?? "Untitled quote"}
        actions={<QuoteStatusBadge status={quote.status} validUntil={quote.validUntil} />}
      />

      <div className="mb-5">
        <QuoteDetailActions
          id={quote.id}
          number={quote.number}
          status={quote.status}
          validUntil={quote.validUntil}
          prospect={prospect}
          netCents={totals.taxableTotal}
          currency={quote.currency}
          language={quote.language}
          projectId={quote.projectId}
          issues={readinessIssues(formFromQuote(quote))}
          links={<QuotePdfButtons id={quote.id} />}
        />
      </div>

      {quote.statusNote && (quote.status === "rejected" || quote.status === "cancelled") && (
        <p className="mb-4 rounded-card border border-line p-3 text-sm text-muted" role="note">
          <span className="font-medium text-ink">{quote.status === "rejected" ? "Reason for rejection" : "Reason for cancelling"}:</span> {quote.statusNote}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="min-w-0 space-y-4">
          <Panel title="Client">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="Name" value={quote.clientName} />
              <Item label="Company" value={quote.clientCompany} />
              <Item label="Email" value={quote.clientEmail} />
              <Item label="Address" value={quote.clientAddress} pre />
            </dl>
          </Panel>

          {quote.intro && (
            <Panel title="Introduction">
              <p className="text-sm whitespace-pre-line text-muted">{quote.intro}</p>
            </Panel>
          )}

          <Panel title="Line items">
            {quote.items.length === 0 ? (
              <p className="text-sm text-muted">No lines yet.</p>
            ) : (
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <caption className="sr-only">Line items of {quote.number}</caption>
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-line">
                      <th className="py-2 pr-3 font-medium">Description</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Unit price</th>
                      <th className="px-3 py-2 text-right font-medium">Disc.</th>
                      <th className="px-3 py-2 text-right font-medium">VAT</th>
                      <th className="py-2 pl-3 text-right font-medium">Excl. VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.items.map((item) => (
                      <tr key={item.id} className="border-b border-line/60 align-top last:border-0">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">{item.title}</div>
                          {item.description && <div className="mt-0.5 text-xs whitespace-pre-line text-muted">{item.description}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                          {formatQuantity(item.quantity, quote.language)}
                          {item.unit ? ` ${item.unit}` : ""}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{money(item.unitPriceCents)}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums text-muted">{Number(item.discountPercent) > 0 ? formatPercent(Number(item.discountPercent), quote.language) : "—"}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{formatPercent(item.taxRate, quote.language)}</td>
                        <td className="py-2.5 pl-3 text-right whitespace-nowrap tabular-nums">{money(item.subtotalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {(quote.notes || quote.terms) && (
            <Panel title="Notes and terms">
              <div className="space-y-4 text-sm text-muted">
                {quote.notes && <p className="whitespace-pre-line">{quote.notes}</p>}
                {quote.terms && <p className="whitespace-pre-line">{quote.terms}</p>}
              </div>
            </Panel>
          )}
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4">
          <Panel title="Totals">
            <QuoteTotalsBlock totals={totals} currency={quote.currency} language={quote.language} />
          </Panel>

          <Panel title="Details">
            <dl className="space-y-2 text-sm">
              <Item label="Language" value={quote.language === "nl" ? "Nederlands" : "English"} />
              <Item
                label="Valid until"
                value={
                  quote.validUntil
                    ? `${formatDay(quote.validUntil)}${days !== null && shown !== "accepted" && shown !== "rejected" && shown !== "cancelled" ? (days < 0 ? ` (${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago)` : days === 0 ? " (today)" : ` (in ${days} day${days === 1 ? "" : "s"})`) : ""}`
                    : null
                }
              />
              <Item label="Created" value={formatDateTime(quote.createdAt)} />
              <Item label="Sent" value={quote.sentAt ? formatDateTime(quote.sentAt) : null} />
              <Item label="Accepted" value={quote.acceptedAt ? formatDateTime(quote.acceptedAt) : null} />
              <Item label="Rejected" value={quote.rejectedAt ? formatDateTime(quote.rejectedAt) : null} />
            </dl>
          </Panel>

          <Panel title="Related">
            <ul className="space-y-1.5 text-sm">
              <li>
                Prospect:{" "}
                {quote.prospect ? (
                  <Link href={`/admin/prospects/${quote.prospect.id}`} className="text-ink underline underline-offset-4">
                    {quote.prospect.companyName}
                  </Link>
                ) : (
                  <span className="text-muted">{quote.prospectId ? "—" : "none"}</span>
                )}
              </li>
              <li>
                Project:{" "}
                {quote.projectId ? (
                  <Link href={`/admin/projects/${quote.projectId}/edit`} className="text-ink underline underline-offset-4">
                    Open project
                  </Link>
                ) : (
                  <span className="text-muted">none</span>
                )}
              </li>
            </ul>
          </Panel>

          <Suspense fallback={<SectionSkeleton title="activity" lines={3} />}>
            <QuoteActivity id={quote.id} />
          </Suspense>
        </aside>
      </div>
    </>
  );
}

function Item({ label, value, pre }: { label: string; value: string | null; pre?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={pre ? "whitespace-pre-line" : undefined}>{value || <span className="text-subtle">—</span>}</dd>
    </div>
  );
}

/** The audit trail loads on its own so the quote itself is on screen first. */
async function QuoteActivity({ id }: { id: string }) {
  const activities = await listQuoteActivities(id);
  return (
      <Panel title="Activity">
        {activities.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ol className="space-y-3">
            {activities.map((a) => (
              <li key={a.id} className="text-sm">
                <div>{a.title}</div>
                {a.description && <div className="text-xs text-muted">{a.description}</div>}
                <div className="text-xs text-subtle">{formatDateTime(a.createdAt)}</div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
  );
}
