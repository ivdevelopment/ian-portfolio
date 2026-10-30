"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteReviewAction,
  setReviewFeaturedAction,
  setReviewStatusAction,
  type ReviewActionResult,
} from "@/app/(admin)/admin/(panel)/reviews/actions";
import type { ReviewStatus } from "@/lib/schemas/review";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";

type Props = { review: { id: string; name: string; status: ReviewStatus; featured: boolean } };

const btn =
  "inline-flex h-8 items-center rounded-md border border-line px-2.5 text-xs text-muted transition-colors " +
  "hover:border-line-strong hover:bg-glass-strong hover:text-ink disabled:pointer-events-none disabled:opacity-50";

export function ReviewRowActions({ review }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const run = (action: () => Promise<ReviewActionResult>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };
  const setStatus = (status: ReviewStatus) => run(() => setReviewStatusAction(review.id, status));
  const { status } = review;

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div className="flex flex-wrap gap-1.5 sm:justify-end">
        {(status === "pending" || status === "rejected" || status === "archived") && (
          <button type="button" className={btn} disabled={pending} onClick={() => setStatus("approved")}>
            {status === "archived" ? "Restore & publish" : "Approve"}
          </button>
        )}
        {status === "pending" && (
          <button type="button" className={btn} disabled={pending} onClick={() => setStatus("rejected")}>
            Reject
          </button>
        )}
        {status === "approved" && (
          <>
            <button
              type="button"
              className={cn(btn, review.featured && "border-accent/50 text-ink")}
              aria-pressed={review.featured}
              disabled={pending}
              onClick={() => run(() => setReviewFeaturedAction(review.id, !review.featured))}
            >
              {review.featured ? "Unfeature" : "Feature"}
            </button>
            <button type="button" className={btn} disabled={pending} onClick={() => setStatus("archived")}>
              Archive
            </button>
          </>
        )}
        {(status === "pending" || status === "rejected") && (
          <button type="button" className={btn} disabled={pending} onClick={() => setStatus("archived")}>
            Archive
          </button>
        )}
        <Link href={`/admin/reviews/${review.id}/edit`} className={btn}>
          Edit
        </Link>
        <button
          type="button"
          className={cn(btn, "hover:border-danger/50 hover:text-danger")}
          disabled={pending}
          onClick={() => {
            setDeleteError(null);
            setConfirmOpen(true);
          }}
        >
          Delete
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete the review by “${review.name}”?`}
        confirmLabel="Delete review"
        pending={pending}
        error={deleteError}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setDeleteError(null);
          startTransition(async () => {
            const result = await deleteReviewAction(review.id);
            if (!result.ok) {
              setDeleteError(result.error);
              return;
            }
            setConfirmOpen(false);
            router.refresh();
          });
        }}
      >
        <p>
          This permanently deletes the review, including the client&apos;s original submission. This can&apos;t be
          undone. To hide it instead, use Archive.
        </p>
      </ConfirmDialog>
    </div>
  );
}
