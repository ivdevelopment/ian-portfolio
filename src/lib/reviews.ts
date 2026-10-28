import { cacheLife, cacheTag } from "next/cache";
import { onlyApproved, rowToPublicReview, type ReviewRow } from "@/lib/review-filters";
import { createPublicClient } from "@/lib/supabase/public";
import type { PublicReview } from "@/types/review";

export const REVIEWS_TAG = "reviews";

/**
 * Approved reviews only — enforced by Row Level Security for the anonymous
 * role and repeated here. Featured first, then the admin's order, then newest.
 */
export async function getApprovedReviews(): Promise<PublicReview[]> {
  "use cache";
  cacheTag(REVIEWS_TAG);
  cacheLife("hours");

  const { data, error } = await createPublicClient()
    .from("reviews")
    .select(
      "id, project_id, name, company, role, rating, review_text, avatar_path, featured, status, projects(id, title, slug)",
    )
    .eq("status", "approved")
    .order("featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("published_at", { ascending: false });

  if (error) {
    console.error("[reviews] failed to load approved reviews:", error.message);
    throw new Error("Reviews are temporarily unavailable.");
  }

  return onlyApproved(data as unknown as ReviewRow[]).map(rowToPublicReview);
}

/** Reviews shown in the homepage section: featured first, capped. */
export async function getHomepageReviews(limit = 6): Promise<PublicReview[]> {
  "use cache";
  cacheTag(REVIEWS_TAG);
  cacheLife("hours");

  return (await getApprovedReviews()).slice(0, limit);
}

export async function getReviewsForProject(projectId: string): Promise<PublicReview[]> {
  "use cache";
  cacheTag(REVIEWS_TAG);
  cacheLife("hours");

  return (await getApprovedReviews()).filter((r) => r.project?.id === projectId);
}
