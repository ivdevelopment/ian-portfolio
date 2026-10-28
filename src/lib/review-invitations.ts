import "server-only";

import { resolveMediaUrl } from "@/lib/cms/mappers";
import { hashReviewToken, isPlausibleToken } from "@/lib/review-tokens";
import { createPublicClient } from "@/lib/supabase/public";

export type InvitationPreview = {
  clientName?: string;
  projectTitle?: string;
  projectThumbnail?: string;
};

/**
 * Looks up what to show on a review form. Returns null for every kind of
 * unusable link (malformed, unknown, expired, revoked, used) — the caller
 * cannot, and must not, distinguish them. The raw token is hashed here and
 * only the hash goes to the database. It is never logged.
 */
export async function getInvitationPreview(token: string): Promise<InvitationPreview | null> {
  if (!isPlausibleToken(token)) return null;

  const { data, error } = await createPublicClient().rpc("get_review_invitation", {
    p_token_hash: hashReviewToken(token),
  });
  if (error) {
    console.error("[review-invitation] lookup failed:", error.code);
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const row = data as { client_name?: string | null; project_title?: string | null; project_thumbnail?: string | null };
  return {
    clientName: row.client_name ?? undefined,
    projectTitle: row.project_title ?? undefined,
    projectThumbnail: resolveMediaUrl(row.project_thumbnail),
  };
}
