"use server";

import { z } from "zod";
import { ADMIN_RESET_PASSWORD } from "@/lib/auth-routes";
import { getPublicBaseUrl } from "@/lib/cms/request-origin";
import { createClient } from "@/lib/supabase/server";

export type ForgotPasswordState = { status?: "sent" | "invalid"; email?: string };

/**
 * Always answers the same way, so the form can't be used to discover which
 * emails belong to an account. Supabase itself rate-limits recovery emails.
 */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = z.email().max(200).safeParse(email);
  if (!parsed.success) return { status: "invalid", email };

  const supabase = await createClient();
  const redirectTo = `${await getPublicBaseUrl()}${ADMIN_RESET_PASSWORD}`;
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo });
  // Log the code only (never the address) and still answer generically.
  if (error) console.error("[auth] recovery request failed:", error.code ?? error.status);

  return { status: "sent" };
}
