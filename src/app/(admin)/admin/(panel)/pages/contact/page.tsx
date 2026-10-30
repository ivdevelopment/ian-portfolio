import { loadContactContentFor, loadSettings } from "@/lib/cms/site-admin";
import { AdminPageHeader } from "@/components/admin/ui";
import { LangTabs, parseEditLang } from "@/components/admin/lang-tabs";
import { ContactContentEditor } from "@/components/admin/content-editors";

export default async function AdminContactPageEditor({ searchParams }: PageProps<"/admin/pages/contact">) {
  const lang = parseEditLang((await searchParams).lang);
  const [content, settings] = await Promise.all([loadContactContentFor(lang), loadSettings()]);
  return (
    <>
      <AdminPageHeader title="Contact" description="The header and public contact details. The enquiry form itself is unchanged." />
      <LangTabs active={lang} basePath="/admin/pages/contact" />
      <ContactContentEditor key={lang} initial={content} settingsEmail={settings.contactEmail} translating={lang === "nl"} />
    </>
  );
}
