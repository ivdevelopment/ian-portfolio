"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import {
  createInvitationAction,
  deleteInvitationAction,
  revokeInvitationAction,
} from "@/app/(admin)/admin/(panel)/reviews/actions";
import { EXPIRY_OPTIONS_DAYS } from "@/lib/review-tokens";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./confirm-dialog";
import { NETWORK_ERROR } from "./use-action-runner";
import { Panel, adminInput, formatDateTime } from "./ui";

type ProjectOption = { id: string; title: string };

/**
 * Creates an invitation and shows the link exactly once. The link lives only in
 * this component's state: it is not stored anywhere recoverable.
 */
export function InviteForm({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = (form: HTMLFormElement) => {
    const data = new FormData(form);
    setError(null);
    setFieldErrors({});
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await createInvitationAction({
          clientName: String(data.get("clientName") ?? ""),
          email: String(data.get("email") ?? ""),
          projectId: String(data.get("projectId") ?? ""),
          expiresInDays: Number(data.get("expiresInDays")),
        });
        if (!result.ok) {
          setError(result.error);
          setFieldErrors(result.fieldErrors ?? {});
          return;
        }
        form.reset();
        setIssued({ url: result.url, expiresAt: result.expiresAt });
        setCopied(false);
        router.refresh();
      } catch {
        setError(NETWORK_ERROR);
      }
    });
  };

  if (issued) {
    return (
      <Panel title="Review link created">
        <p className="text-sm text-muted">
          Copy this link now and send it to your client. <strong className="text-ink">It is shown only once</strong> and
          cannot be recovered later. It expires {formatDateTime(issued.expiresAt)}.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            readOnly
            value={issued.url}
            aria-label="Review link"
            onFocus={(e) => e.currentTarget.select()}
            className={`${adminInput} h-10 min-w-56 flex-1 font-mono text-xs`}
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-10"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.url);
                setCopied(true);
              } catch {
                setError("Couldn't copy automatically — select the link and copy it manually.");
              }
            }}
          >
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button size="sm" className="h-10" onClick={() => setIssued(null)}>
            Done
          </Button>
        </div>
        <p role="status" className="sr-only">
          {copied ? "Link copied to the clipboard." : ""}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Request a review" description="Creates a single-use link you can send to a client.">
      <form
        noValidate
        // Never fall back to a GET (personal data in the URL) if JS has not hydrated yet.
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <label htmlFor="inv-name" className="mb-1.5 block text-xs font-medium text-muted">
            Client name
          </label>
          <input id="inv-name" name="clientName" type="text" maxLength={120} className={`${adminInput} h-10`} aria-invalid={Boolean(fieldErrors.clientName)} />
        </div>
        <div>
          <label htmlFor="inv-email" className="mb-1.5 block text-xs font-medium text-muted">
            Email (optional)
          </label>
          <input id="inv-email" name="email" type="email" maxLength={200} className={`${adminInput} h-10`} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "inv-email-error" : undefined} />
          {fieldErrors.email && (
            <p id="inv-email-error" role="alert" className="mt-1 text-xs text-danger">
              {fieldErrors.email}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="inv-project" className="mb-1.5 block text-xs font-medium text-muted">
            Related project (optional)
          </label>
          <select id="inv-project" name="projectId" className={`${adminInput} h-10`} defaultValue="">
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="inv-expiry" className="mb-1.5 block text-xs font-medium text-muted">
            Expires after
          </label>
          <select id="inv-expiry" name="expiresInDays" className={`${adminInput} h-10`} defaultValue="14">
            {EXPIRY_OPTIONS_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" size="sm" pending={pending} pendingLabel="Creating link…">
            Create link
          </Button>
          {error && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      </form>
    </Panel>
  );
}

type InvitationRowActionsProps = {
  id: string;
  label: string;
  status: "active" | "used" | "revoked" | "expired";
};

export function InvitationRowActions({ id, label, status }: InvitationRowActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"revoke" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status !== "active" && status !== "revoked" && status !== "expired") {
    return <span className="text-xs text-subtle">—</span>;
  }

  const verb = status === "active" ? "revoke" : "delete";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setMode(verb);
        }}
        className="inline-flex h-8 items-center rounded-md border border-line px-2.5 text-xs text-muted transition-colors hover:border-danger/50 hover:text-danger"
      >
        {status === "active" ? "Revoke" : "Delete"}
      </button>
      <ConfirmDialog
        open={mode !== null}
        title={mode === "revoke" ? `Revoke the link for “${label}”?` : `Delete the invitation for “${label}”?`}
        confirmLabel={mode === "revoke" ? "Revoke link" : "Delete invitation"}
        pendingLabel={mode === "revoke" ? "Revoking link…" : "Deleting invitation…"}
        pending={pending}
        error={error}
        onClose={() => setMode(null)}
        onConfirm={() => {
          setError(null);
          if (pending) return;
          startTransition(async () => {
            try {
              const result = mode === "revoke" ? await revokeInvitationAction(id) : await deleteInvitationAction(id);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setMode(null);
              router.refresh();
            } catch {
              setError(NETWORK_ERROR);
            }
          });
        }}
      >
        <p>
          {mode === "revoke"
            ? "The link will stop working immediately. This can't be undone."
            : "The invitation record will be removed. Any review it produced is kept."}
        </p>
      </ConfirmDialog>
    </>
  );
}
