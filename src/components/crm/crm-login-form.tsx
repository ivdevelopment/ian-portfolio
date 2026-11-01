"use client";

import { useActionState } from "react";
import { crmSignInAction, type CrmLoginState } from "@/crm/actions/auth";
import { adminInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { siteAdminOrigin } from "@/lib/crm/host";

export function CrmLoginForm() {
  const [state, formAction, pending] = useActionState<CrmLoginState, FormData>(crmSignInAction, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" defaultValue={state.email} required className={`${adminInput} h-11`} aria-invalid={Boolean(state.error)} aria-describedby={state.error ? "login-error" : undefined} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={`${adminInput} h-11`} aria-invalid={Boolean(state.error)} />
      </div>

      {state.error && (
        <p id="login-error" role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" pending={pending} pendingLabel="Signing in…">
        Sign in
      </Button>
      <p className="text-center text-xs text-subtle">
        Forgot your password? Reset it at the{" "}
        <a href={`${siteAdminOrigin()}/admin/forgot-password`} className="text-muted underline underline-offset-4 hover:text-ink">
          website admin
        </a>
        , then sign in here.
      </p>
    </form>
  );
}
