import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/ui";
import { ReviewEditor } from "@/components/admin/review-editor";

export default async function EditReviewPage({ params }: PageProps<"/admin/reviews/[id]/edit">) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [reviewRes, projectsRes] = await Promise.all([
    supabase
      .from("reviews")
      .select("*, review_private(original_review_text)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("projects").select("id, title").order("title"),
  ]);
  if (reviewRes.error) {
    console.error("[admin] failed to load review:", reviewRes.error.message);
    throw new Error("Review unavailable");
  }
  const row = reviewRes.data;
  if (!row) notFound();

  const privateRow = Array.isArray(row.review_private) ? row.review_private[0] : row.review_private;

  return (
    <>
      <AdminPageHeader title={`Review by ${row.name}`} description={`${row.source === "invitation" ? "Submitted via invitation link" : "Added by admin"}`} />
      <ReviewEditor
        mode="edit"
        source={row.source}
        originalText={privateRow?.original_review_text ?? null}
        projects={projectsRes.data ?? []}
        initial={{
          id: row.id,
          name: row.name,
          company: row.company ?? "",
          role: row.role ?? "",
          rating: row.rating,
          reviewText: row.review_text,
          projectId: row.project_id ?? "",
          avatarPath: row.avatar_path,
          featured: row.featured,
          sortOrder: row.sort_order,
          status: row.status,
        }}
      />
    </>
  );
}
