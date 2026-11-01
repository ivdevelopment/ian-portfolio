"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { CRM_HOME, CRM_LOGIN } from "@/lib/crm/auth-routes";
import { createClient } from "@/lib/supabase/server";

export type CrmLoginState = { error?: string; email?: string };

const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

/**
 * Email + password sign-in for the CRM. The same identities and the same authorisation as the website admin (`admin_users`, checked by
 * the `is_admin()` database function), but a SEPARATE session: Supabase's cookies are host-only, so signing in here sets cookies for the
 * CRM host only. There is deliberately no sign-up.
 */
export async function crmSignInAction(_prev: CrmLoginState, formData: FormData): Promise<CrmLoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = loginSchema.safeParse({ email, password: String(formData.get("password") ?? "") });
  if (!parsed.success) return { error: "Enter your email address and password.", email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Invalid email or password.", email };

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) {
    await supabase.auth.signOut();
    return { error: "This account isn't authorised to use the CRM.", email };
  }

  redirect(CRM_HOME);
}

/** Ends the CRM session only (the website admin session, if any, is a different cookie on a different host). */
export async function crmSignOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(CRM_LOGIN);
}
