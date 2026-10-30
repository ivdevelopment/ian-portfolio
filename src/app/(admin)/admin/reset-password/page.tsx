import { Suspense } from "react";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { ADMIN_FORGOT_PASSWORD } from "@/lib/auth-routes";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="text-center text-xl font-medium tracking-tight">{siteConfig.initials}</p>
        <h1 className="mt-6 text-center text-2xl font-medium tracking-tight">Choose a new password</h1>
        <div className="glass mt-8 rounded-panel p-6">
          <Suspense fallback={<p className="text-sm text-muted">Checking your link…</p>}>
            <ResetBody />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

/** The proxy has already exchanged the emailed code for a session; no session means a bad or used link. */
async function ResetBody() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) return <ResetPasswordForm />;

  return (
    <div role="alert" className="space-y-3 text-sm">
      <p className="text-muted">This recovery link is invalid or has expired.</p>
      <Link href={ADMIN_FORGOT_PASSWORD} className="text-accent underline-offset-4 hover:underline">
        Request a new link
      </Link>
    </div>
  );
}
