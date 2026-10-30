import { requireAdmin } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/ui";
import { LangTabs, parseEditLang } from "@/components/admin/lang-tabs";
import { ServicesEditor } from "@/components/admin/list-editors";
import { ServicesTranslationEditor, type ServiceTranslationRow } from "@/components/admin/translation-editors";
import { localizeContent, translationFor } from "@/i18n/localize-content";
import type { ServiceIconId } from "@/lib/schemas/site-content";

export default async function AdminServicesEditorPage({ searchParams }: PageProps<"/admin/pages/services">) {
  const lang = parseEditLang((await searchParams).lang);
  const { supabase } = await requireAdmin();
  // "*" keeps the page working before the translations migration is applied.
  const { data, error } = await supabase.from("services").select("*").order("sort_order");
  if (error) {
    console.error("[admin] failed to load services:", error.message);
    throw new Error("Services unavailable");
  }

  const description =
    "Shown on the homepage and on /services. Disabled services are hidden from visitors.";

  if (lang === "nl") {
    // Start from what Dutch visitors currently see (saved translation → known Dutch → English).
    const rows: ServiceTranslationRow[] = data.map((s) => {
      const english = { title: s.title, description: s.description, includes: s.includes };
      const nl = localizeContent("nl", english, translationFor(s.translations, "nl"));
      return {
        id: s.id,
        slug: s.slug,
        english,
        title: nl.title,
        description: nl.description,
        includesText: nl.includes.join("\n"),
      };
    });
    return (
      <>
        <AdminPageHeader title="Services" description={description} />
        <LangTabs active="nl" basePath="/admin/pages/services" />
        <ServicesTranslationEditor initial={rows} />
      </>
    );
  }

  return (
    <>
      <AdminPageHeader title="Services" description={description} />
      <LangTabs active="en" basePath="/admin/pages/services" />
      <ServicesEditor
        initial={data.map((s) => ({
          id: s.id,
          slug: s.slug,
          title: s.title,
          description: s.description,
          icon: s.icon as ServiceIconId,
          includesText: s.includes.join("\n"),
          enabled: s.enabled,
        }))}
      />
    </>
  );
}
