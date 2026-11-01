"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateInquiryStatusAction } from "@/app/(admin)/admin/(panel)/inquiries/actions";
import { Spinner } from "@/components/ui/loading";
import { INQUIRY_STATUSES, type InquiryStatus } from "@/lib/schemas/inquiry";
import { INQUIRY_STATUS_LABELS } from "./inquiry-status";
import { adminInput } from "./ui";
import { NETWORK_ERROR } from "./use-action-runner";

export function InquiryStatusSelect({ id, status }: { id: string; status: InquiryStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(status);

  return (
    <div>
      <div className="flex items-center gap-2">
        <label htmlFor="inquiry-status" className="text-xs font-medium text-muted">
          Status
        </label>
        <select
          id="inquiry-status"
          value={value}
          disabled={pending}
          aria-busy={pending || undefined}
          className={`${adminInput} h-9 w-auto`}
          onChange={(e) => {
            const next = e.target.value as InquiryStatus;
            const previous = value;
            setValue(next);
            setError(null);
            startTransition(async () => {
              try {
                const result = await updateInquiryStatusAction(id, next);
                if (!result.ok) {
                  setValue(previous);
                  setError(result.error);
                  return;
                }
                router.refresh();
              } catch {
                setValue(previous);
                setError(NETWORK_ERROR);
              }
            });
          }}
        >
          {INQUIRY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INQUIRY_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {/* Reserved width, so the row does not move when the spinner appears. */}
        <span className="inline-flex min-w-16 items-center gap-1.5 text-xs text-muted" role="status">
          {pending && (
            <>
              <Spinner className="size-3.5" />
              Saving…
            </>
          )}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
