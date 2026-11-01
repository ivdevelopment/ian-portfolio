"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { zohoSyncNowAction } from "@/app/(admin)/admin/(panel)/settings/integrations/actions";
import { Button } from "@/components/ui/button";
import { usePendingAction } from "@/lib/use-pending-action";

/**
 * "Sync now" next to the mail it refreshes. Read-only: it only reads from Zoho and stores metadata; it never sends anything.
 * The same server action as the settings page, one run at a time.
 */
export function MailSyncButton() {
  const router = useRouter();
  const { pending, run } = usePendingAction();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const sync = () =>
    run(async () => {
      setMessage(null);
      try {
        const result = await zohoSyncNowAction();
        if (!result.ok) return setMessage({ tone: "error", text: result.error });
        const stored = result.report?.stored ?? 0;
        setMessage({ tone: "ok", text: stored > 0 ? `Synced: ${stored} new ${stored === 1 ? "message" : "messages"}.` : "Synced: nothing new." });
        router.refresh();
      } catch {
        setMessage({ tone: "error", text: "The sync could not be completed. Check your connection and try again." });
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="secondary" icon="none" pending={pending} pendingLabel="Syncing…" onClick={() => void sync()}>
        Sync now
      </Button>
      <p role={message?.tone === "error" ? "alert" : "status"} className={message?.tone === "error" ? "text-sm text-danger" : "text-sm text-muted"}>
        {message?.text}
      </p>
    </div>
  );
}
