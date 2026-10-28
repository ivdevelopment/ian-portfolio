import { notFound } from "next/navigation";
import { rowToEditorValues } from "@/lib/cms/editor";
import { loadProjectForAdmin } from "@/lib/cms/admin-queries";
import { AdminPageHeader } from "@/components/admin/ui";
import { ProjectEditor } from "@/components/admin/project-editor";

export default async function EditProjectPage({
  params,
  searchParams,
}: PageProps<"/admin/projects/[id]/edit">) {
  const { id } = await params;
  const query = await searchParams;

  const row = await loadProjectForAdmin(id);
  if (!row) notFound();

  const notice = query.created ? "created" : query.duplicated ? "duplicated" : undefined;

  return (
    <>
      <AdminPageHeader title={row.title} description={`Editing /work/${row.slug}`} />
      <ProjectEditor mode="edit" initial={rowToEditorValues(row)} notice={notice} />
    </>
  );
}
