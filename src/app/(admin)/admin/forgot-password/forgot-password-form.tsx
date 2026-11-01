"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type ForgotPasswordState } from "./actions";
import { adminInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<ForgotPasswordState, FormData>(
    requestPasswordResetAction,
    {},
  );

  if (state.status === "sent") {
    return (
      <p role="status" className="text-sm text-muted">
        If an account exists for that email, a recovery link has been sent. The link expires
        after a short time and can be used once.
      </p>
    );
  }

  return (
    <form action={formAction} method="post" className="space-y-4" noValidate>
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
          aria-invalid={state.status === "invalid"}
          aria-describedby={state.status === "invalid" ? "forgot-error" : undefined}
        />
      </div>
      {state.status === "invalid" && (
        <p id="forgot-error" role="alert" className="text-sm text-danger">
          Enter a valid email address.
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" pending={pending} pendingLabel="Sending…">
        Send recovery link
      </Button>
    </form>
  );
}
