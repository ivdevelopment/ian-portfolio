import { getPaths } from "@/lib/crm/server-paths";
import { QuoteList } from "@/components/admin/quote-list";
import { AdminPageHeader } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/button";
import { parseQuoteFilters } from "@/lib/quotes/filters";
import { formatCents } from "@/lib/quotes/money";
import { getProspectOption, getQuoteMetrics, listQuotes } from "@/lib/quotes/queries";

export default async function AdminQuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const P = await getPaths();
  const filters = parseQuoteFilters(await searchParams);
  const [{ rows, total }, metrics, prospect] = await Promise.all([listQuotes(filters), getQuoteMetrics(), filters.prospect ? getProspectOption(filters.prospect) : Promise.resolve(null)]);

  const cards: Array<{ label: string; value: string; hint?: string }> = [
    { label: "Drafts", value: String(metrics.draft.count + metrics.ready.count), hint: metrics.ready.count > 0 ? `${metrics.ready.count} ready to send` : undefined },
    { label: "Sent", value: String(metrics.sent.count), hint: metrics.expired.count > 0 ? `${metrics.expired.count} expired` : undefined },
    { label: "Accepted", value: String(metrics.accepted.count), hint: metrics.accepted.count > 0 ? `${formatCents(metrics.accepted.netCents)} excl. VAT` : undefined },
    { label: "Open quoted value", value: metrics.open.count > 0 ? formatCents(metrics.open.netCents) : "—", hint: "Ready + sent, excl. VAT" },
  ];

  return (
    <>
      <AdminPageHeader
        title="Quotes"
        description="Offertes: prepare a quote, generate the PDF, send it yourself and track the answer."
        actions={
          <>
            <ButtonLink href={P.quoteTemplates} variant="secondary" size="sm" icon="none">
              Services
            </ButtonLink>
            <ButtonLink href={P.quoteNew()} size="sm" icon="none">
              New quote
            </ButtonLink>
          </>
        }
      />

      <dl className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-card border border-line bg-glass p-3.5">
            <dd className="text-xl font-medium tabular-nums">{c.value}</dd>
            <dt className="mt-0.5 text-xs text-muted">{c.label}</dt>
            {c.hint && <p className="mt-0.5 text-xs text-subtle">{c.hint}</p>}
          </div>
        ))}
      </dl>

      <QuoteList rows={rows} total={total} filters={filters} prospectName={prospect?.companyName ?? null} />
    </>
  );
}
