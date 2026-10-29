"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ADMIN_LOGIN } from "@/lib/auth-routes";
import { createClient } from "@/lib/supabase/server";

export type ResetPasswordState = { error?: string };

const passwordSchema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters.").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "The passwords don't match.",
    path: ["confirm"],
  });

/** Sets a new password for the recovery session created by the emailed link. */
export async function updatePasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = passwordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the new password." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) {
    return { error: "This recovery link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("[auth] password update failed:", error.code ?? error.status);
    return {
      error: "The password couldn't be updated. Try a different password or request a new link.",
    };
  }

  // A recovered account starts clean: end every session, then sign in with the new password.
  await supabase.auth.signOut({ scope: "global" });
  redirect(`${ADMIN_LOGIN}?reset=1`);
}
