import { QuoteForm } from "@/components/admin/quote-form";
import { AdminPageHeader } from "@/components/admin/ui";
import { newQuoteForm } from "@/lib/quotes/form";
import { getProspectOption, getQuoteSettings, listProspectOptions, listTemplates } from "@/lib/quotes/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewQuotePage({ searchParams }: PageProps<"/admin/quotes/new">) {
  const { prospect } = await searchParams;
  const prospectId = typeof prospect === "string" && UUID.test(prospect) ? prospect : null;
  const [settings, templates, prospects, preset] = await Promise.all([
    getQuoteSettings(),
    listTemplates(),
    listProspectOptions(),
    prospectId ? getProspectOption(prospectId) : Promise.resolve(null),
  ]);

  return (
    <>
      <AdminPageHeader
        title="New quote"
        description={preset ? `Prefilled from ${preset.companyName}. Check the details, add your lines and save.` : "Create a quote, then generate the PDF and send it yourself."}
      />
      <QuoteForm mode="create" initial={newQuoteForm(settings, preset ?? undefined)} settings={settings} templates={templates} prospects={prospects} />
    </>
  );
}
