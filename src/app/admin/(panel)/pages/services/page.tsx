import { requireAdmin } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/ui";
import { ServicesEditor } from "@/components/admin/list-editors";
import type { ServiceIconId } from "@/lib/schemas/site-content";

export default async function AdminServicesEditorPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("services")
    .select("id, slug, title, description, icon, includes, enabled")
    .order("sort_order");
  if (error) {
    console.error("[admin] failed to load services:", error.message);
    throw new Error("Services unavailable");
  }

  return (
    <>
      <AdminPageHeader title="Services" description="Shown on the homepage and on /services. Disabled services are hidden from visitors." />
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
