"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Small copy-to-clipboard button with a brief "Copied" confirmation. */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      icon="none"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked: the value is still visible to select manually.
        }
      }}
    >
      {copied ? <Check aria-hidden className="size-4 text-accent" /> : <Copy aria-hidden className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/**
 * Shown right after a preview is created or a code is reset. The code exists only in this component's
 * props: it is not stored anywhere recoverable, and closing the dialog discards it.
 */
export function PreviewSecretDialog({
  open,
  title,
  url,
  code,
  onDone,
}: {
  open: boolean;
  title: string;
  url: string;
  code: string;
  onDone: () => void;
}) {
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
      // Esc would silently discard the only copy of the code: require the explicit button.
      onCancel={(event) => event.preventDefault()}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-panel border border-line-strong bg-elevated p-6 text-ink shadow-lift backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <h2 id={titleId} className="text-lg font-medium tracking-tight">
        {title}
      </h2>

      <dl className="mt-5 space-y-4 text-sm">
        <div>
          <dt className="text-xs font-medium text-muted">URL</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md border border-line bg-glass px-2.5 py-1.5">{url}</code>
            <CopyButton value={url} label="Copy link" />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">Access code</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-2">
            <code className="rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1.5 font-mono text-base tracking-wide">
              {code}
            </code>
            <CopyButton value={code} label="Copy code" />
          </dd>
        </div>
      </dl>

      <p role="note" className="mt-5 rounded-md border border-line p-3 text-xs text-muted">
        The access code is shown only once. It is stored as a one-way hash and cannot be recovered; if it is lost,
        reset it (which also signs everyone out).
      </p>

      <div className="mt-6 flex justify-end">
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </dialog>
  );
}
