import { Suspense } from "react";
import { crmSignOutAction } from "@/crm/actions/auth";
import { CrmLoginForm } from "@/components/crm/crm-login-form";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Sign in" };

export default function CrmLoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="text-center text-xl font-medium tracking-tight">Ian Verlinden</p>
        <h1 className="mt-1 text-center text-sm font-medium tracking-[0.2em] text-accent uppercase">CRM</h1>
        <p className="mt-6 text-center text-sm text-muted">Business workspace</p>

        <div className="mt-6 rounded-panel border border-line bg-surface p-6">
          <Suspense fallback={<CrmLoginForm />}>
            <LoginBody />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

/** Approved admins never see this page (the proxy sends them home). A signed-in but unapproved account is told so, with a way out. */
async function LoginBody() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedInAs = data?.claims?.sub ? (typeof data.claims.email === "string" ? data.claims.email : "this account") : null;
  return (
    <>
      {signedInAs && (
        <div role="status" className="mb-5 rounded-md border border-line p-3 text-sm">
          <p className="text-muted">
            Signed in as <span className="text-ink">{signedInAs}</span>, which isn&apos;t authorised for the CRM.
          </p>
          <form action={crmSignOutAction} className="mt-2">
            <button type="submit" className="text-sm text-accent underline-offset-4 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      )}
      <CrmLoginForm />
    </>
  );
}
