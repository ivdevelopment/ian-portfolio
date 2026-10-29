"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { updatePasswordAction, type ResetPasswordState } from "./actions";
import { adminInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(
    updatePasswordAction,
    {},
  );

  return (
    <form action={formAction} method="post" className="space-y-4" noValidate>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          className={`${adminInput} h-11`}
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="mt-1.5 text-xs text-subtle">
          At least 10 characters.
        </p>
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium">
          Repeat new password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className={`${adminInput} h-11`}
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 aria-hidden className="size-4 animate-spin" /> Saving…
          </>
        ) : (
          "Set new password"
        )}
      </Button>
    </form>
  );
}
