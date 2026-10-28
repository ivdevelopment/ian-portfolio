import { resolveMediaUrl } from "@/lib/cms/mappers";
import type { PublicReview } from "@/types/review";

/** Pure helpers for public reviews (kept free of server-only imports so they're unit-testable). */

export type ReviewRow = {
  id: string;
  project_id: string | null;
  name: string;
  company: string | null;
  role: string | null;
  rating: number;
  review_text: string;
  avatar_path: string | null;
  featured: boolean;
  status: string;
  projects: { id: string; title: string; slug: string } | null;
};

export function rowToPublicReview(row: ReviewRow): PublicReview {
  return {
    id: row.id,
    rating: row.rating,
    text: row.review_text,
    name: row.name,
    role: row.role ?? undefined,
    company: row.company ?? undefined,
    avatar: resolveMediaUrl(row.avatar_path),
    featured: row.featured,
    project: row.projects ?? undefined,
  };
}

/** Second layer behind RLS: only approved reviews may ever be shown publicly. */
export function onlyApproved<T extends { status: string }>(rows: T[]): T[] {
  return rows.filter((r) => r.status === "approved");
}
