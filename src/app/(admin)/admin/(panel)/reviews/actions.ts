"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getPublicBaseUrl } from "@/lib/cms/request-origin";
import {
  expiryDate,
  generateReviewToken,
  hashReviewToken,
  invitationStatus,
} from "@/lib/review-tokens";
import { REVIEWS_TAG } from "@/lib/reviews";
import {
  invitationCreateSchema,
  isAvatarPathForReview,
  reviewEditorSchema,
  reviewStatusSchema,
} from "@/lib/schemas/review";
import { SITE_BUCKET } from "@/lib/supabase/env";

export type ReviewActionResult<T extends object = object> =
  | ({ ok: true; warning?: string } & T)
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const idSchema = z.uuid();

async function removeAvatar(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  path: string | null | undefined,
) {
  if (!path) return;
  const { error } = await supabase.storage.from(SITE_BUCKET).remove([path]);
  if (error) console.error("[reviews] avatar cleanup failed:", error.message);
}

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

/** Create (source = admin) or update a review. `source` is never taken from the client. */
export async function saveReviewAction(input: unknown): Promise<ReviewActionResult<{ id: string }>> {
  const { supabase } = await requireAdmin();

  const parsed = reviewEditorSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;

  if (v.avatarPath && !isAvatarPathForReview(v.avatarPath, v.id)) {
    return fail("The avatar doesn't belong to this review.");
  }

  const fields = {
    name: v.name,
    company: v.company || null,
    role: v.role || null,
    rating: v.rating,
    review_text: v.reviewText,
    project_id: v.projectId || null,
    avatar_path: v.avatarPath,
    featured: v.featured,
    sort_order: v.sortOrder,
    status: v.status,
  };

  const { data: existing } = await supabase
    .from("reviews")
    .select("id, avatar_path")
    .eq("id", v.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("reviews").update(fields).eq("id", v.id);
    if (error) {
      console.error("[reviews] update failed:", error.code, error.message);
      return fail("The review couldn't be saved. Please try again.");
    }
    if (existing.avatar_path && existing.avatar_path !== v.avatarPath) {
      await removeAvatar(supabase, existing.avatar_path);
    }
  } else {
    const { error } = await supabase.from("reviews").insert({ id: v.id, ...fields, source: "admin" });
    if (error) {
      console.error("[reviews] insert failed:", error.code, error.message);
      return fail("The review couldn't be saved. Please try again.");
    }
  }

  updateTag(REVIEWS_TAG);
  return { ok: true, id: v.id };
}

export async function setReviewStatusAction(id: string, status: string): Promise<ReviewActionResult> {
  const { supabase } = await requireAdmin();
  const parsedId = idSchema.safeParse(id);
  const parsedStatus = reviewStatusSchema.safeParse(status);
  if (!parsedId.success || !parsedStatus.success) return fail("Invalid request.");

  const { data, error } = await supabase
    .from("reviews")
    .update({ status: parsedStatus.data })
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[reviews] status update failed:", error.code, error.message);
    return fail("The status couldn't be updated.");
  }
  if (!data) return fail("Review not found.");

  updateTag(REVIEWS_TAG);
  return { ok: true };
}

export async function setReviewFeaturedAction(id: string, featured: boolean): Promise<ReviewActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return fail("Invalid request.");

  const { data, error } = await supabase
    .from("reviews")
    .update({ featured })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[reviews] feature update failed:", error.code, error.message);
    return fail("The review couldn't be updated.");
  }
  if (!data) return fail("Review not found.");

  updateTag(REVIEWS_TAG);
  return { ok: true };
}

export async function deleteReviewAction(id: string): Promise<ReviewActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return fail("Invalid request.");

  const { data: review } = await supabase.from("reviews").select("avatar_path").eq("id", id).maybeSingle();
  if (!review) return fail("Review not found.");

  const { error } = await supabase.from("reviews").delete().eq("id", id);
  if (error) {
    console.error("[reviews] delete failed:", error.code, error.message);
    return fail("The review couldn't be deleted.");
  }
  await removeAvatar(supabase, review.avatar_path);

  updateTag(REVIEWS_TAG);
  return { ok: true };
}

/**
 * Creates an invitation and returns the link ONCE. Only the SHA-256 hash is
 * stored; the raw token is neither persisted nor logged, and cannot be
 * recovered later.
 */
export async function createInvitationAction(
  input: unknown,
): Promise<ReviewActionResult<{ url: string; expiresAt: string }>> {
  const { supabase, userId } = await requireAdmin();

  const parsed = invitationCreateSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;

  const token = generateReviewToken();
  const expiresAt = expiryDate(v.expiresInDays, new Date());

  const { error } = await supabase.from("review_invitations").insert({
    token_hash: hashReviewToken(token),
    email: v.email || null,
    client_name: v.clientName || null,
    project_id: v.projectId || null,
    expires_at: expiresAt.toISOString(),
    created_by: userId,
  });
  if (error) {
    console.error("[invitations] create failed:", error.code, error.message);
    return fail("The invitation couldn't be created. Please try again.");
  }

  const base = await getPublicBaseUrl();
  return { ok: true, url: `${base}/review/${token}`, expiresAt: expiresAt.toISOString() };
}

export async function revokeInvitationAction(id: string): Promise<ReviewActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return fail("Invalid request.");

  const { data, error } = await supabase
    .from("review_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("used_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[invitations] revoke failed:", error.code, error.message);
    return fail("The invitation couldn't be revoked.");
  }
  if (!data) return fail("This invitation can't be revoked.");
  return { ok: true };
}

/** Only expired or revoked invitations can be deleted; active and used ones are kept. */
export async function deleteInvitationAction(id: string): Promise<ReviewActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return fail("Invalid request.");

  const { data: inv } = await supabase
    .from("review_invitations")
    .select("expires_at, used_at, revoked_at")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return fail("Invitation not found.");

  const status = invitationStatus(inv, new Date());
  if (status !== "expired" && status !== "revoked") {
    return fail("Only expired or revoked invitations can be deleted.");
  }

  const { error } = await supabase.from("review_invitations").delete().eq("id", id);
  if (error) {
    console.error("[invitations] delete failed:", error.code, error.message);
    return fail("The invitation couldn't be deleted.");
  }
  return { ok: true };
}
