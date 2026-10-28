import { requireAdmin } from "@/lib/auth";
import { loadAboutContent } from "@/lib/cms/site-admin";
import { AdminPageHeader } from "@/components/admin/ui";
import { AboutContentEditor } from "@/components/admin/content-editors";
import { SkillsEditor } from "@/components/admin/list-editors";

export default async function AdminAboutPageEditor() {
  const { supabase } = await requireAdmin();
  const [content, skillsRes] = await Promise.all([
    loadAboutContent(),
    supabase.from("skills").select("id, name, enabled").order("sort_order"),
  ]);
  if (skillsRes.error) {
    console.error("[admin] failed to load skills:", skillsRes.error.message);
    throw new Error("Skills unavailable");
  }

  return (
    <>
      <AdminPageHeader title="About" description="Intro, portrait, body copy, stats and skills." />
      <AboutContentEditor initial={content} />
      <h2 className="mt-10 mb-3 text-lg font-medium">Skills</h2>
      <SkillsEditor initial={skillsRes.data} />
    </>
  );
}
