import { loadHomeContentFor } from "@/lib/cms/site-admin";
import { AdminPageHeader } from "@/components/admin/ui";
import { LangTabs, parseEditLang } from "@/components/admin/lang-tabs";
import { HomeContentEditor } from "@/components/admin/content-editors";

export default async function AdminHomePageEditor({ searchParams }: PageProps<"/admin/pages/home">) {
  const lang = parseEditLang((await searchParams).lang);
  const content = await loadHomeContentFor(lang);
  return (
    <>
      <AdminPageHeader title="Home" description="Hero, stats, section intros and the call to action." />
      <LangTabs active={lang} basePath="/admin/pages/home" />
      {/* key: switching language remounts the form with that language's values */}
      <HomeContentEditor key={lang} initial={content} translating={lang === "nl"} />
    </>
  );
}
