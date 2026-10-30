import { createHash } from "node:crypto";
import { hashReviewToken, isPlausibleToken } from "@/lib/review-tokens";
import { defaultLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { createPublicReviewSchema, type ReviewSubmitResult } from "@/lib/schemas/review";
import { createPublicClient } from "@/lib/supabase/public";

const MIN_FILL_MS = 3000;

function hashIp(ip: string): string {
  const salt = process.env.INQUIRY_HASH_SALT ?? "portfolio-inquiries";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

type SubmitRpc = (
  fn: "submit_review",
  args: {
    p_token_hash: string;
    p_name: string;
    p_company: string;
    p_role: string;
    p_rating: number;
    p_text: string;
    p_ip_hash: string;
  },
) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;

const defaultRpc: SubmitRpc = (fn, args) => createPublicClient().rpc(fn, args);

/**
 * Submits a review through an invitation link (called by POST /api/reviews/submit).
 *
 * The database does the security-critical part atomically (`submit_review`):
 * it consumes the invitation with a conditional UPDATE and inserts the pending
 * review in the same transaction, so a link can never be used twice. Every
 * unusable link (unknown, expired, revoked, used) yields the same generic
 * answer. The raw token is hashed immediately and never logged or stored.
 */
export async function processReviewSubmission(
  token: unknown,
  input: unknown,
  elapsedMs: unknown,
  ip: string,
  rpc: SubmitRpc = defaultRpc,
  locale: Locale = defaultLocale,
): Promise<ReviewSubmitResult> {
  const dict = getDictionary(locale).review;
  const parsed = createPublicReviewSchema(dict.validation).safeParse(input);
  if (!parsed.success) {
    return { status: "invalid-input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const values = parsed.data;

  if (typeof token !== "string" || !isPlausibleToken(token)) return { status: "invalid-link" };

  // Honeypot filled: pretend success, store nothing.
  if (values.website) return { status: "submitted" };

  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < MIN_FILL_MS) {
    return { status: "error", message: dict.server.tooQuick };
  }

  const { data, error } = await rpc("submit_review", {
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
    return { status: "error", message: dict.server.failed };
  }
  if (data === "rate_limited") {
    return { status: "error", message: dict.server.rateLimited };
  }
  if (data !== "ok") return { status: "invalid-link" };

  return { status: "submitted" };
}
