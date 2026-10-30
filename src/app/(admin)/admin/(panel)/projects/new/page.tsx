import { requireAdmin } from "@/lib/auth";
import { emptyEditorValues } from "@/lib/cms/editor";
import { AdminPageHeader } from "@/components/admin/ui";
import { ProjectEditor } from "@/components/admin/project-editor";

export default async function NewProjectPage() {
  await requireAdmin();

  // The id is generated up front so media can be uploaded to
  // `projects/<id>/…` before the project row exists.
  return (
    <>
      <AdminPageHeader title="New project" description="Saved as a draft until you publish it." />
      <ProjectEditor mode="create" initial={emptyEditorValues(crypto.randomUUID())} />
    </>
  );
}
