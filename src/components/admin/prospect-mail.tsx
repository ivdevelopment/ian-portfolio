"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { quickAction } from "@/app/(admin)/admin/(panel)/prospects/actions";
import { Button } from "@/components/ui/button";

/** Applies the suggestion with the existing "Reply received" action: nothing changes unless this is clicked. */
export function MarkRepliedButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        icon="none"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await quickAction(id, "reply_received");
            if (!result.ok) return setError(result.error);
            router.refresh();
          })
        }
      >
        Mark as Replied
      </Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}
