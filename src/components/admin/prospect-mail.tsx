"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { quickAction } from "@/app/(admin)/admin/(panel)/prospects/actions";
import { Button } from "@/components/ui/button";
import { NETWORK_ERROR } from "./use-action-runner";

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
        pending={pending}
        pendingLabel="Marking as replied…"
        onClick={() => {
          setError(null);
          start(async () => {
            try {
              const result = await quickAction(id, "reply_received");
              if (!result.ok) return setError(result.error);
              router.refresh();
            } catch {
              setError(NETWORK_ERROR);
            }
          });
        }}
      >
        Mark as Replied
      </Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}
