import "server-only";

import { createHash } from "node:crypto";
import { defaultLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { createInquirySchema, type InquiryResult } from "@/lib/schemas/inquiry";
import { createPublicClient } from "@/lib/supabase/public";
import { sendInquiryNotification, type NotifiableInquiry } from "@/lib/email/inquiry-notification";
import { verifyTurnstile } from "@/lib/turnstile";

type InquiryRpc = (
  fn: "submit_inquiry",
  args: {
    p_name: string;
    p_email: string;
    p_project_type: string;
    p_budget: string;
    p_message: string;
    p_ip_hash: string;
  },
) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

const defaultRpc: InquiryRpc = (fn, args) => createPublicClient().rpc(fn, args);

/** Faster than this and it's almost certainly a script, not a person typing. */
const MIN_FILL_MS = 3000;

/** Salted hash so rate limiting never stores a raw IP address. */
function hashIp(ip: string): string {
  const salt = process.env.INQUIRY_HASH_SALT ?? "portfolio-inquiries";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/**
 * Handles the project request form (called by POST /api/contact).
 *
 * Protection layers: Zod validation (length limits), a hidden honeypot field,
 * a minimum fill time, Cloudflare Turnstile (when configured) and a
 * database-side rate limit inside `submit_inquiry`. Once the inquiry is stored,
 * the owner is notified by email (best effort). The anonymous role has no
 * table access at all — the only thing it can do is call that function.
 * Nothing about the database is revealed to the visitor.
 */
export async function processInquiry(
  input: unknown,
  elapsedMs: unknown,
  turnstileToken: unknown,
  ip: string,
  locale: Locale = defaultLocale,
  deps: {
    rpc?: InquiryRpc;
    verify?: typeof verifyTurnstile;
    notify?: (inquiry: NotifiableInquiry) => Promise<unknown>;
  } = {},
): Promise<InquiryResult> {
  const dict = getDictionary(locale).contact;
  const rpc = deps.rpc ?? defaultRpc;
  const verify = deps.verify ?? verifyTurnstile;
  const notify = deps.notify ?? sendInquiryNotification;
  const parsed = createInquirySchema(dict.validation).safeParse(input);
  if (!parsed.success) {
    return { status: "invalid", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const values = parsed.data;

  // Honeypot filled: pretend success so bots get no signal, and store nothing.
  if (values.company) return { status: "sent" };

  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < MIN_FILL_MS) {
    return { status: "error", message: dict.server.tooQuick };
  }

  const human = await verify(turnstileToken, ip);
  if (human === "failed" || human === "unavailable") {
    return {
      status: "error",
      message:
        human === "failed"
          ? dict.server.securityFailed
          : dict.server.securityUnavailable,
    };
  }

  const { data, error } = await rpc("submit_inquiry", {
    p_name: values.name,
    p_email: values.email,
    p_project_type: values.projectType,
    p_budget: values.budget,
    p_message: values.message,
    p_ip_hash: hashIp(ip),
  });

  if (error) {
    console.error("[inquiry] insert failed:", error.code, error.message);
    return {
      status: "error",
      message: dict.server.failed,
    };
  }

  if (data === "rate_limited") {
    return {
      status: "error",
      message: dict.server.rateLimited,
    };
  }

  // Stored. Now tell the owner — best effort: a mail failure never fails or rolls back the lead.
  await notify({
    name: values.name,
    email: values.email,
    projectType: values.projectType,
    budget: values.budget,
    message: values.message,
    locale,
  }).catch(() => undefined);

  return { status: "sent" };
}
