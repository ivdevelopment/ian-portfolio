"use client";

import { useEffect, useId, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  pending?: boolean;
  error?: string | null;
  /** Red for destructive actions (default); accent for everything else. */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onClose: () => void;
};

/** Accessible modal built on the native <dialog> element (focus trap and Esc come for free). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  pending,
  error,
  tone = "danger",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-panel border border-line-strong bg-elevated p-6 text-ink shadow-lift backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <h2 id={titleId} className="text-lg font-medium tracking-tight">
        {title}
      </h2>
      <div className="mt-2 text-sm text-muted">{children}</div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onConfirm}
          disabled={pending}
          className={tone === "danger" ? "bg-danger text-bg shadow-none hover:brightness-110" : undefined}
        >
          {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
