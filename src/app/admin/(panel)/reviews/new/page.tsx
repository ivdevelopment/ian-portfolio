import { requireAdmin } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/ui";
import { ReviewEditor } from "@/components/admin/review-editor";

export default async function NewReviewPage() {
  const { supabase } = await requireAdmin();
  const { data: projects } = await supabase.from("projects").select("id, title").order("title");

  return (
    <>
      <AdminPageHeader
        title="Add review"
        description="Add a genuine review you received elsewhere. It will be marked as added by admin."
      />
      <ReviewEditor
        mode="create"
        source="admin"
        projects={projects ?? []}
        initial={{
          id: crypto.randomUUID(),
          name: "",
          company: "",
          role: "",
          rating: 5,
          reviewText: "",
          projectId: "",
          avatarPath: null,
          featured: false,
          sortOrder: 0,
          status: "pending",
        }}
      />
    </>
  );
}
