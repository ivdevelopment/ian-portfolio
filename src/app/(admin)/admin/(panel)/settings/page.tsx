import { loadSettingsFor } from "@/lib/cms/site-admin";
import { AdminPageHeader } from "@/components/admin/ui";
import { LangTabs, parseEditLang } from "@/components/admin/lang-tabs";
import { SettingsEditor } from "@/components/admin/content-editors";

export default async function AdminSettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const lang = parseEditLang((await searchParams).lang);
  const settings = await loadSettingsFor(lang);
  return (
    <>
      <AdminPageHeader title="Settings" description="Site-wide details, social links and SEO defaults." />
      <LangTabs active={lang} basePath="/admin/settings" />
      <SettingsEditor key={lang} initial={settings} translating={lang === "nl"} />
    </>
  );
}
