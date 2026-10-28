"use server";

import { inquirySchema, type InquiryResult } from "@/lib/schemas/inquiry";

/**
 * Server-side entry point for the project request form.
 *
 * P0: validates the payload and reports that no backend is attached — it
 * deliberately does NOT claim the message was delivered.
 * TODO(P1): persist to Supabase (`inquiries` table) and notify by email,
 * then return `{ status: "sent" }`.
 */
export async function submitInquiry(input: unknown): Promise<InquiryResult> {
  const parsed = inquirySchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "invalid",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // TODO(P1): silently drop the request here when `parsed.data.company` (honeypot) is set.
  return { status: "not_configured" };
}
