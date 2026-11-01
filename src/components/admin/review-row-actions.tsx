"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteReviewAction, setReviewFeaturedAction, setReviewStatusAction } from "@/app/(admin)/admin/(panel)/reviews/actions";
import type { ReviewStatus } from "@/lib/schemas/review";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { RowTextButton, rowTextButtonClass as btn } from "./icon-button";
import { useActionRunner } from "./use-action-runner";

type Props = { review: { id: string; name: string; status: ReviewStatus; featured: boolean } };

export function ReviewRowActions({ review }: Props) {
  const { run, active, pending, error, setError } = useActionRunner();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const setStatus = (key: string, status: ReviewStatus) => run(key, () => setReviewStatusAction(review.id, status));
  const { status } = review;

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div className="flex flex-wrap gap-1.5 sm:justify-end">
        {(status === "pending" || status === "rejected" || status === "archived") && (
          <RowTextButton busy={active === "approve"} busyLabel={status === "archived" ? "Restoring…" : "Approving…"} disabled={pending} onClick={() => setStatus("approve", "approved")}>
            {status === "archived" ? "Restore & publish" : "Approve"}
          </RowTextButton>
        )}
        {status === "pending" && (
          <RowTextButton busy={active === "reject"} busyLabel="Rejecting…" disabled={pending} onClick={() => setStatus("reject", "rejected")}>
            Reject
          </RowTextButton>
        )}
        {status === "approved" && (
          <>
            <RowTextButton
              busy={active === "feature"}
              busyLabel={review.featured ? "Unfeaturing…" : "Featuring…"}
              className={cn(review.featured && "border-accent/50 text-ink")}
              aria-pressed={review.featured}
              disabled={pending}
              onClick={() => run("feature", () => setReviewFeaturedAction(review.id, !review.featured))}
            >
              {review.featured ? "Unfeature" : "Feature"}
            </RowTextButton>
            <RowTextButton busy={active === "archive"} busyLabel="Archiving…" disabled={pending} onClick={() => setStatus("archive", "archived")}>
              Archive
            </RowTextButton>
          </>
        )}
        {(status === "pending" || status === "rejected") && (
          <RowTextButton busy={active === "archive"} busyLabel="Archiving…" disabled={pending} onClick={() => setStatus("archive", "archived")}>
            Archive
          </RowTextButton>
        )}
        <Link href={`/admin/reviews/${review.id}/edit`} className={btn}>
          Edit
        </Link>
        <RowTextButton
          busy={false}
          busyLabel="Deleting…"
          className="hover:border-danger/50 hover:text-danger"
          disabled={pending}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
        >
          Delete
        </RowTextButton>
      </div>
      {error && !confirmOpen && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete the review by “${review.name}”?`}
        confirmLabel="Delete review"
        pending={active === "delete"}
        error={confirmOpen ? error : null}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => run("delete", () => deleteReviewAction(review.id), () => setConfirmOpen(false))}
      >
        <p>
          This permanently deletes the review, including the client&apos;s original submission. This can&apos;t be
          undone. To hide it instead, use Archive.
        </p>
      </ConfirmDialog>
    </div>
  );
}
