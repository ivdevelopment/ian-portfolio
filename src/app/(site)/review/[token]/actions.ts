"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { hashReviewToken, isPlausibleToken } from "@/lib/review-tokens";
import { publicReviewSchema, type ReviewSubmitResult } from "@/lib/schemas/review";
import { createPublicClient } from "@/lib/supabase/public";

const MIN_FILL_MS = 3000;

function hashIp(ip: string): string {
  const salt = process.env.INQUIRY_HASH_SALT ?? "portfolio-inquiries";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/**
 * Submits a review through an invitation link.
 *
 * The database does the security-critical part atomically (`submit_review`):
 * it consumes the invitation with a conditional UPDATE and inserts the pending
 * review in the same transaction, so a link can never be used twice. Every
 * unusable link yields the same generic answer. The raw token is hashed
 * immediately and never logged or stored.
 */
export async function submitReviewAction(
  token: string,
  input: unknown,
  elapsedMs: number,
): Promise<ReviewSubmitResult> {
  const parsed = publicReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid-input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const values = parsed.data;

  if (!isPlausibleToken(token)) return { status: "invalid-link" };

  // Honeypot filled: pretend success, store nothing.
  if (values.website) return { status: "submitted" };

  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < MIN_FILL_MS) {
    return { status: "error", message: "That was a little quick — please try sending again." };
  }

  const requestHeaders = await headers();
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";

  const { data, error } = await createPublicClient().rpc("submit_review", {
    p_token_hash: hashReviewToken(token),
    p_name: values.name,
    p_company: values.company,
    p_role: values.role,
    p_rating: values.rating,
    p_text: values.review,
    p_ip_hash: hashIp(ip),
  });

  if (error) {
    console.error("[review] submission failed:", error.code);
    return { status: "error", message: "Something went wrong while sending your review. Please try again." };
  }
  if (data === "rate_limited") {
    return { status: "error", message: "You've sent several reviews recently. Please try again later." };
  }
  if (data !== "ok") return { status: "invalid-link" };

  return { status: "submitted" };
}
