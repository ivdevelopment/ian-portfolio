"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ADMIN_HOME, ADMIN_LOGIN } from "@/lib/auth-routes";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string; email?: string };

const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

/**
 * Email + password sign-in. There is deliberately no sign-up anywhere: a user
 * can only reach the CMS if their id is in `admin_users`.
 */
export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = loginSchema.safeParse({
    email,
    password: String(formData.get("password") ?? ""),
  });
  // Echo the email back: React clears uncontrolled fields after an action.
  if (!parsed.success) return { error: "Enter your email address and password.", email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Invalid email or password.", email };

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) {
    await supabase.auth.signOut();
    return { error: "This account isn't authorised to use the admin area.", email };
  }

  redirect(ADMIN_HOME);
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(ADMIN_LOGIN);
}
