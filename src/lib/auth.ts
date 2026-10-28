import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_LOGIN } from "@/lib/auth-routes";

export type AdminContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string | undefined;
};

/**
 * Returns the signed-in admin, or null. "Admin" means the session's user
 * has a row in `admin_users` (checked by the database function `is_admin()`),
 * not merely that someone is authenticated.
 */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error || isAdmin !== true) return null;

  const email = typeof data?.claims?.email === "string" ? data.claims.email : undefined;
  return { supabase, userId, email };
});

/** Page / layout guard. Redirects to the login page when not an admin. */
export async function requireAdmin(): Promise<AdminContext> {
  const admin = await getAdminContext();
  if (!admin) redirect(ADMIN_LOGIN);
  return admin;
}
