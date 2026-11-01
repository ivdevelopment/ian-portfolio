"use client";

import { useFormStatus } from "react-dom";
import { LogOut } from "lucide-react";
import { Spinner } from "@/components/ui/loading";
import { cn } from "@/lib/utils";

/** Submit button of the sign-out form: says "Signing out…" and cannot be clicked twice while the request runs. */
export function SignOutButton({ variant }: { variant: "sidebar" | "inline" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn(
        variant === "sidebar"
          ? "inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-ink"
          : "inline-flex items-center gap-2 text-sm text-muted underline-offset-4 hover:underline",
        "disabled:cursor-wait disabled:opacity-70",
      )}
    >
      {pending ? <Spinner className="size-4" /> : variant === "sidebar" && <LogOut aria-hidden className="size-4" />}
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
