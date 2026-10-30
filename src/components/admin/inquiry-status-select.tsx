"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { updateInquiryStatusAction } from "@/app/(admin)/admin/(panel)/inquiries/actions";
import { INQUIRY_STATUSES, type InquiryStatus } from "@/lib/schemas/inquiry";
import { INQUIRY_STATUS_LABELS } from "./inquiry-status";
import { adminInput } from "./ui";

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
          className={`${adminInput} h-9 w-auto`}
          onChange={(e) => {
            const next = e.target.value as InquiryStatus;
            const previous = value;
            setValue(next);
            setError(null);
            startTransition(async () => {
              const result = await updateInquiryStatusAction(id, next);
              if (!result.ok) {
                setValue(previous);
                setError(result.error);
                return;
              }
              router.refresh();
            });
          }}
        >
          {INQUIRY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INQUIRY_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {pending && <Loader2 aria-label="Saving" className="size-4 animate-spin text-muted" />}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
