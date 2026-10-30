import { requireAdmin } from "@/lib/auth";
import { loadAboutContentFor } from "@/lib/cms/site-admin";
import { AdminPageHeader } from "@/components/admin/ui";
import { LangTabs, parseEditLang } from "@/components/admin/lang-tabs";
import { AboutContentEditor } from "@/components/admin/content-editors";
import { SkillsEditor } from "@/components/admin/list-editors";

export default async function AdminAboutPageEditor({ searchParams }: PageProps<"/admin/pages/about">) {
  const lang = parseEditLang((await searchParams).lang);
  const { supabase } = await requireAdmin();
  const [content, skillsRes] = await Promise.all([
    loadAboutContentFor(lang),
    supabase.from("skills").select("id, name, enabled").order("sort_order"),
  ]);
  if (skillsRes.error) {
    console.error("[admin] failed to load skills:", skillsRes.error.message);
    throw new Error("Skills unavailable");
  }

  return (
    <>
      <AdminPageHeader title="About" description="Intro, portrait, body copy, stats and skills." />
      <LangTabs active={lang} basePath="/admin/pages/about" />
      <AboutContentEditor key={lang} initial={content} translating={lang === "nl"} />
      {lang === "en" ? (
        <>
          <h2 className="mt-10 mb-3 text-lg font-medium">Skills</h2>
          <SkillsEditor initial={skillsRes.data} />
        </>
      ) : (
        <p className="mt-8 text-sm text-muted">Skills are technology names and are shared by every language.</p>
      )}
    </>
  );
}
