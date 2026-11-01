import { getPaths } from "@/lib/crm/server-paths";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QuoteForm } from "@/components/admin/quote-form";
import { QuoteStatusBadge } from "@/components/admin/quote-ui";
import { AdminPageHeader, EmptyState } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/button";
import { isEditable } from "@/lib/quotes/constants";
import { formFromQuote } from "@/lib/quotes/form";
import { getQuote, getQuoteSettings, listProspectOptions, listTemplates } from "@/lib/quotes/queries";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const P = await getPaths();
  const { id } = await params;
  const quote = await getQuote(id);
  if (!quote) notFound();

  if (!isEditable(quote.status)) {
    return (
      <>
        <AdminPageHeader title={quote.number} actions={<QuoteStatusBadge status={quote.status} validUntil={quote.validUntil} />} />
        <EmptyState>
          This quote is {quote.status} and can no longer be edited.{" "}
          <Link href={P.quote(quote.id)} className="text-ink underline underline-offset-4">
            Open it
          </Link>{" "}
          and use <strong>Duplicate</strong> to make a revision.
        </EmptyState>
      </>
    );
  }

  const [settings, templates, prospects] = await Promise.all([getQuoteSettings(), listTemplates(), listProspectOptions()]);
  return (
    <>
      <AdminPageHeader
        title={`Edit ${quote.number}`}
        description={quote.title ?? undefined}
        actions={
          <ButtonLink href={P.quote(quote.id)} variant="secondary" size="sm" icon="none">
            Back to quote
          </ButtonLink>
        }
      />
      <QuoteForm
        mode="edit"
        id={quote.id}
        initial={formFromQuote(quote)}
        updatedAt={quote.updatedAt}
        status={quote.status === "ready" ? "ready" : "draft"}
        settings={settings}
        templates={templates}
        prospects={prospects}
      />
    </>
  );
}
