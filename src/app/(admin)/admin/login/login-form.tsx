"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { ADMIN_FORGOT_PASSWORD } from "@/lib/auth-routes";
import { signInAction, type LoginState } from "./actions";
import { adminInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(signInAction, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={state.email}
          required
          className={`${adminInput} h-11`}
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? "login-error" : undefined}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={`${adminInput} h-11`}
          aria-invalid={Boolean(state.error)}
        />
      </div>

      {state.error && (
        <p id="login-error" role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 aria-hidden className="size-4 animate-spin" /> Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </Button>
      <p className="text-center text-sm">
        <Link
          href={ADMIN_FORGOT_PASSWORD}
          className="text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
