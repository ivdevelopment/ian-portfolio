import { getPaths } from "@/lib/crm/server-paths";
import { QuoteTemplatesManager } from "@/components/admin/quote-templates-manager";
import { AdminPageHeader } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/button";
import { listTemplates } from "@/lib/quotes/queries";

export default async function QuoteTemplatesPage() {
  const P = await getPaths();
  const templates = await listTemplates({ includeInactive: true });
  return (
    <>
      <AdminPageHeader
        title="Services"
        description="Reusable lines for the “Add service” button in the quote builder."
        actions={
          <ButtonLink href={P.quotes} variant="secondary" size="sm" icon="none">
            Back to quotes
          </ButtonLink>
        }
      />
      <QuoteTemplatesManager templates={templates} />
    </>
  );
}
