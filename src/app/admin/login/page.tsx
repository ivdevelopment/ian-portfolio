import { Suspense } from "react";
import { siteConfig } from "@/config/site";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="text-center text-xl font-medium tracking-tight">{siteConfig.initials}</p>
        <h1 className="mt-6 text-center text-2xl font-medium tracking-tight">Admin sign in</h1>
        <p className="mt-1 text-center text-sm text-muted">Restricted area.</p>

        <div className="glass mt-8 rounded-panel p-6">
          <Suspense fallback={<LoginForm />}>
            <LoginBody />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

/**
 * Approved admins never see this page: the proxy redirects them to /admin.
 * If someone is signed in but NOT approved, say so (and offer to sign out)
 * rather than bouncing between /admin and /admin/login.
 */
async function LoginBody() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedInAs = data?.claims?.sub
    ? typeof data.claims.email === "string"
      ? data.claims.email
      : "this account"
    : null;

  return (
    <>
      {signedInAs && (
        <div role="status" className="mb-5 rounded-md border border-line p-3 text-sm">
          <p className="text-muted">
            Signed in as <span className="text-ink">{signedInAs}</span>, which isn&apos;t
            authorised for the admin area.
          </p>
          <form action={signOutAction} className="mt-2">
            <button
              type="submit"
              className="text-sm text-accent underline-offset-4 hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
      <LoginForm />
    </>
  );
}
