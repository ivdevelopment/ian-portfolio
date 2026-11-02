"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { zohoSyncNowAction } from "@/app/(admin)/admin/(panel)/settings/integrations/actions";
import { Button } from "@/components/ui/button";
import { useAppPaths } from "@/lib/crm/paths-context";
import { syncSummary } from "@/lib/mail/zoho/sync-summary";
import { usePendingAction } from "@/lib/use-pending-action";

const reviewLabel = (n: number) => (n === 1 ? "Review candidate" : `Review ${n} candidates`);

type Message = { tone: "ok" | "error"; title: string; parts?: string[]; pending?: number };

/**
 * "Sync now" next to the mail it refreshes. Read-only: it only reads from Zoho and stores metadata; it never sends anything and
 * never creates a prospect. Outgoing mail to someone you have no prospect for is reported as a prospect CANDIDATE to review.
 * The same server action as the settings page, one run at a time.
 */
export function MailSyncButton() {
  const router = useRouter();
  const P = useAppPaths();
  const { pending, run } = usePendingAction();
  const [message, setMessage] = useState<Message | null>(null);

  const sync = () =>
    run(async () => {
      setMessage(null);
      try {
        const result = await zohoSyncNowAction();
        if (!result.ok) return setMessage({ tone: "error", title: result.error });
        if (!result.report) return setMessage({ tone: "ok", title: "Sync complete" });
        const summary = syncSummary(result.report);
        setMessage({ tone: result.report.errors.length > 0 ? "error" : "ok", title: summary.title, parts: summary.parts, pending: summary.pending });
        router.refresh();
      } catch {
        setMessage({ tone: "error", title: "The sync could not be completed. Check your connection and try again." });
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="secondary" icon="none" pending={pending} pendingLabel="Syncing…" onClick={() => void sync()}>
        Sync now
      </Button>
      <p role={message?.tone === "error" ? "alert" : "status"} className={message?.tone === "error" ? "text-sm text-danger" : "text-sm text-muted"}>
        {message && (
          <>
            {message.title}
            {message.parts ? `: ${message.parts.join(" · ")}` : ""}
            {message.pending ? (
              <>
                {" "}
                {P.candidatesReview.startsWith("/") ? (
                  <Link href={P.candidatesReview} className="text-accent underline-offset-4 hover:underline">
                    {reviewLabel(message.pending)}
                  </Link>
                ) : (
                  <a href={P.candidatesReview} className="text-accent underline-offset-4 hover:underline">
                    {reviewLabel(message.pending)}
                  </a>
                )}
              </>
            ) : null}
          </>
        )}
      </p>
    </div>
  );
}
