"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { inquirySchema, type InquiryResult } from "@/lib/schemas/inquiry";
import { createPublicClient } from "@/lib/supabase/public";

/** Faster than this and it's almost certainly a script, not a person typing. */
const MIN_FILL_MS = 3000;

/** Salted hash so rate limiting never stores a raw IP address. */
function hashIp(ip: string): string {
  const salt = process.env.INQUIRY_HASH_SALT ?? "portfolio-inquiries";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/**
 * Receives the project request form.
 *
 * Protection layers: Zod validation (length limits), a hidden honeypot field,
 * a minimum fill time, and a database-side rate limit inside `submit_inquiry`.
 * The anonymous role has no table access at all — the only thing it can do is
 * call that function. Nothing about the database is revealed to the visitor.
 */
export async function submitInquiry(
  input: unknown,
  elapsedMs: number,
): Promise<InquiryResult> {
  const parsed = inquirySchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const values = parsed.data;

  // Honeypot filled: pretend success so bots get no signal, and store nothing.
  if (values.company) return { status: "sent" };

  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < MIN_FILL_MS) {
    return { status: "error", message: "That was a little quick — please try sending again." };
  }

  const requestHeaders = await headers();
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("submit_inquiry", {
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
      message: "Something went wrong while sending your request. Please try again in a moment.",
    };
  }

  if (data === "rate_limited") {
    return {
      status: "error",
      message: "You've sent several requests recently. Please try again later.",
    };
  }

  return { status: "sent" };
}
