"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, ExternalLink, KeyRound, Pencil, Power, PowerOff, RefreshCw, Trash2 } from "lucide-react";
import { deletePreviewAction, resetPreviewCodeAction, setPreviewActiveAction, type PreviewActionResult } from "@/app/(admin)/admin/(panel)/previews/actions";
import { generateAccessCode } from "@/lib/preview/access-code";
import { ConfirmDialog } from "./confirm-dialog";
import { IconButton } from "./icon-button";
import { useActionRunner } from "./use-action-runner";
import { PreviewSecretDialog } from "./preview-secret-dialog";
import { adminInput } from "./ui";
import { cn } from "@/lib/utils";

import { iconButtonClass as iconButton } from "./icon-button";

type Row = { id: string; clientName: string; active: boolean; url: string };

/** Open, copy link, reset code, disable/enable, edit and delete (destructive ones ask first). */
export function PreviewRowActions({ preview, hideEdit }: { preview: Row; hideEdit?: boolean }) {
  const { run, active, pending, error, setError } = useActionRunner();
  const [dialog, setDialog] = useState<"reset" | "disable" | "delete" | null>(null);
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  // Only THIS preview's row is busy: the rest of the page stays usable.
  const dialogError = dialog ? error : null;
  const message = dialog ? null : error;
  const dialogBusy = (key: string) => active === key;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <a href={preview.url} target="_blank" rel="noopener noreferrer" className={iconButton} aria-label={`Open ${preview.clientName} preview`} title="Open">
          <ExternalLink aria-hidden className="size-4" />
        </a>
        <CopyIcon url={preview.url} />
        <button
          type="button"
          className={iconButton}
          aria-label={`Reset access code for ${preview.clientName}`}
          title="Reset access code"
          onClick={() => {
            setCode(generateAccessCode(preview.clientName));
            setError(null);
            setDialog("reset");
          }}
        >
          <KeyRound aria-hidden className="size-4" />
        </button>
        <IconButton
          busy={active === "enable"}
          disabled={pending}
          aria-label={preview.active ? `Disable ${preview.clientName} preview` : `Enable ${preview.clientName} preview`}
          title={preview.active ? "Disable" : "Enable"}
          onClick={() => {
            if (preview.active) {
              setError(null);
              setDialog("disable");
            } else run("enable", () => setPreviewActiveAction(preview.id, true));
          }}
        >
          {preview.active ? <PowerOff aria-hidden className="size-4" /> : <Power aria-hidden className="size-4" />}
        </IconButton>
        {!hideEdit && (
          <Link href={`/admin/previews/${preview.id}/edit`} className={iconButton} aria-label={`Edit ${preview.clientName} preview`} title="Edit">
            <Pencil aria-hidden className="size-4" />
          </Link>
        )}
        <button
          type="button"
          className={cn(iconButton, "hover:border-danger/50 hover:text-danger")}
          aria-label={`Delete ${preview.clientName} preview`}
          title="Delete"
          onClick={() => {
            setError(null);
            setDialog("delete");
          }}
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      </div>
      {active === "enable" && (
        <p role="status" className="max-w-56 text-right text-xs text-muted">
          Enabling…
        </p>
      )}
      {message && (
        <p role="alert" className="max-w-56 text-right text-xs text-danger">
          {message}
        </p>
      )}

      <ConfirmDialog
        open={dialog === "disable"}
        title={`Disable ${preview.clientName}'s preview?`}
        confirmLabel="Disable"
        pendingLabel="Disabling…"
        pending={dialogBusy("disable")}
        error={dialogError}
        onClose={() => setDialog(null)}
        onConfirm={() => run("disable", () => setPreviewActiveAction(preview.id, false), () => setDialog(null))}
      >
        Everyone is locked out immediately, including visitors who already entered the code. Visitors see
        &ldquo;not available&rdquo;. After re-enabling they must enter the code again.
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "delete"}
        title={`Delete ${preview.clientName}'s preview?`}
        confirmLabel="Delete preview"
        pending={dialogBusy("delete")}
        error={dialogError}
        onClose={() => setDialog(null)}
        onConfirm={() => run("delete", () => deletePreviewAction(preview.id), () => setDialog(null))}
      >
        The preview address stops working and its code is gone. The client&apos;s own website and deployment are not
        touched.
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "reset"}
        title="Reset access code"
        confirmLabel="Reset code"
        pendingLabel="Resetting code…"
        pending={dialogBusy("reset")}
        error={dialogError}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          run(
            "reset",
            (): Promise<PreviewActionResult> => resetPreviewCodeAction(preview.id, code),
            (r) => {
              setDialog(null);
              if (r.ok && "code" in r) setSecret(String(r.code));
            },
          )
        }
      >
        <p>The old code stops working and everyone who is signed in is signed out. A new code is shown once.</p>
        <label htmlFor={`reset-code-${preview.id}`} className="mt-3 mb-1.5 block text-xs font-medium text-muted">
          New access code
        </label>
        <div className="flex gap-2">
          <input
            id={`reset-code-${preview.id}`}
            type="text"
            value={code}
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
            onChange={(e) => setCode(e.target.value)}
            className={cn(adminInput, "h-10 min-w-0 flex-1 font-mono")}
          />
          <button type="button" className={iconButton} aria-label="Generate a new code" title="Generate" onClick={() => setCode(generateAccessCode(preview.clientName))}>
            <RefreshCw aria-hidden className="size-4" />
          </button>
        </div>
      </ConfirmDialog>

      <PreviewSecretDialog
        open={secret !== null}
        title="Access code reset"
        url={preview.url}
        code={secret ?? ""}
        onDone={() => setSecret(null)}
      />
    </div>
  );
}

/** Copy-link as an icon button in the same row style. */
function CopyIcon({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={iconButton}
      aria-label={copied ? "Link copied" : "Copy link"}
      title="Copy link"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked: use Open and copy from the address bar.
        }
      }}
    >
      {copied ? <Check aria-hidden className="size-4 text-accent" /> : <Copy aria-hidden className="size-4" />}
    </button>
  );
}
