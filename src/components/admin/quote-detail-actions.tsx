"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Pencil } from "lucide-react";
import {
  changeQuoteStatusAction,
  createProjectFromQuoteAction,
  deleteQuoteAction,
  duplicateQuoteAction,
  extendValidityAction,
  setProspectQuoteValueAction,
} from "@/app/(admin)/admin/(panel)/quotes/actions";
import { setStatusAction as setProspectStatusAction } from "@/app/(admin)/admin/(panel)/prospects/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { defaultValidUntil, type QuoteStatus } from "@/lib/quotes/constants";
import { formatCents } from "@/lib/quotes/money";
import { isClosed, STATUS_LABELS, type ProspectStatus } from "@/lib/prospects/constants";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { adminInput } from "./ui";

export type DetailProspect = { id: string; companyName: string; status: ProspectStatus; quoteValueCents: number | null };

type Dialog = "ready" | "draft" | "sent" | "accepted" | "rejected" | "cancelled" | "delete" | "extend" | "project" | null;
type Suggestion = { kind: "sent" | "accepted" } | null;

/**
 * Status workflow for one quote. Every change is an explicit, confirmed click. Changes to the linked prospect (its status, its
 * quote value, a project draft) are never made silently: they are offered afterwards and only happen when confirmed.
 */
export function QuoteDetailActions({
  id,
  number,
  status,
  validUntil,
  prospect,
  netCents,
  currency,
  language,
  projectId,
  issues,
  links,
}: {
  id: string;
  number: string;
  status: QuoteStatus;
  validUntil: string | null;
  prospect: DetailProspect | null;
  netCents: number;
  currency: string;
  language: "nl" | "en";
  projectId: string | null;
  /** What is still missing before the quote can be Ready / Sent. */
  issues: string[];
  /** Extra buttons rendered by the page (PDF preview/download). */
  links?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [suggestion, setSuggestion] = useState<Suggestion>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [day, setDay] = useState(validUntil ?? defaultValidUntil());
  const [alsoSetValue, setAlsoSetValue] = useState(false);

  const editable = status === "draft" || status === "ready";
  const money = formatCents(netCents, currency as "EUR", language);

  const close = () => {
    setDialog(null);
    setError(null);
    setNote("");
  };

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await work();
      if (!result.ok) return setError(result.error ?? "That didn't work.");
      close();
      after?.();
      router.refresh();
    });

  const changeStatus = (to: QuoteStatus, extra: { note?: string; validUntil?: string } = {}, after?: () => void) =>
    run(() => changeQuoteStatusAction(id, { to, ...extra }), after);

  /** After "sent" / "accepted": offer (not apply) the matching change on the linked prospect. */
  const offerProspectChange = (kind: "sent" | "accepted") => {
    if (!prospect) return;
    const needed = kind === "sent" ? !isClosed(prospect.status) && prospect.status !== "quote_sent" : prospect.status !== "won";
    if (!needed) return;
    setAlsoSetValue(prospect.quoteValueCents === null);
    setSuggestion({ kind });
  };

  const applySuggestion = () => {
    if (!prospect || !suggestion) return;
    run(
      async () => {
        const moved = await setProspectStatusAction(prospect.id, suggestion.kind === "sent" ? "quote_sent" : "won");
        if (!moved.ok) return moved;
        if (alsoSetValue && prospect.quoteValueCents !== netCents) return setProspectQuoteValueAction(prospect.id, netCents);
        return { ok: true };
      },
      () => setSuggestion(null),
    );
  };

  const btn = (label: string, onClick: () => void, opts: { variant?: "primary" | "secondary"; disabled?: boolean; danger?: boolean } = {}) => (
    <Button size="sm" variant={opts.variant ?? "secondary"} icon="none" disabled={opts.disabled || pending} onClick={onClick} className={cn(opts.danger && "text-danger")}>
      {label}
    </Button>
  );

  const readyBlocked = issues.length > 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" data-testid="quote-actions">
        {editable && (
          <ButtonLink href={`/admin/quotes/${id}/edit`} size="sm" variant="secondary" icon="none">
            <Pencil aria-hidden className="size-4" />
            Edit
          </ButtonLink>
        )}
        {links}
        {status === "draft" && btn("Mark ready", () => setDialog("ready"), { variant: "primary", disabled: readyBlocked })}
        {status === "ready" && btn("Mark sent", () => setDialog("sent"), { variant: "primary" })}
        {status === "ready" && btn("Back to draft", () => setDialog("draft"))}
        {status === "expired" && btn("Reopen as sent", () => setDialog("extend"), { variant: "primary" })}
        {(status === "sent" || status === "expired") && btn("Mark accepted", () => setDialog("accepted"), { variant: status === "sent" ? "primary" : "secondary" })}
        {(status === "sent" || status === "expired") && btn("Mark rejected", () => setDialog("rejected"))}
        {status === "sent" && btn("Extend validity", () => setDialog("extend"))}
        {status === "accepted" && prospect && !projectId && btn("Create project", () => setDialog("project"), { variant: "primary" })}
        {status === "accepted" && prospect && prospect.status !== "won" && btn("Mark prospect won", () => offerProspectChange("accepted"))}
        <Button
          size="sm"
          variant="secondary"
          icon="none"
          disabled={pending}
          onClick={() =>
            run(
              async () => {
                const result = await duplicateQuoteAction(id);
                if (result.ok) router.push(`/admin/quotes/${result.id}/edit`);
                return result;
              },
            )
          }
        >
          <Copy aria-hidden className="size-4" />
          Duplicate
        </Button>
        {status !== "cancelled" && btn("Cancel quote", () => setDialog("cancelled"), { danger: true })}
        {status === "draft" && btn("Delete draft", () => setDialog("delete"), { danger: true })}
      </div>
      {status === "draft" && readyBlocked && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-muted" aria-label="Before this quote can be marked ready">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {error && !dialog && !suggestion && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      <ConfirmDialog open={dialog === "ready"} tone="primary" title="Mark as ready to send?" confirmLabel="Mark ready" pending={pending} error={error} onClose={close} onConfirm={() => changeStatus("ready")}>
        {number} will be locked for review. You can still edit it while it is ready, or move it back to draft.
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "draft"} tone="primary" title="Move back to draft?" confirmLabel="Back to draft" pending={pending} error={error} onClose={close} onConfirm={() => changeStatus("draft")}>
        {number} returns to the draft state.
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "sent"}
        tone="primary"
        title="Mark as sent?"
        confirmLabel="Mark sent"
        pending={pending}
        error={error}
        onClose={close}
        onConfirm={() => changeStatus("sent", {}, () => offerProspectChange("sent"))}
      >
        This records that <strong>you</strong> sent {number} to the client. The app never emails quotes. After this the content is locked: to change anything, duplicate the quote.
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "accepted"}
        tone="primary"
        title="Mark as accepted?"
        confirmLabel="Mark accepted"
        pending={pending}
        error={error}
        onClose={close}
        onConfirm={() => changeStatus("accepted", {}, () => offerProspectChange("accepted"))}
      >
        The client accepted {number}. It becomes read-only; you can then create a project from it.
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "rejected"} title="Mark as rejected?" confirmLabel="Mark rejected" pending={pending} error={error} onClose={close} onConfirm={() => changeStatus("rejected", { note })}>
        <p>{number} stays in your records; nothing is deleted.</p>
        <label htmlFor="reject-note" className="mt-3 mb-1.5 block text-xs font-medium text-muted">
          Reason (optional)
        </label>
        <textarea id="reject-note" rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className={cn(adminInput, "py-2")} />
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "cancelled"} title="Cancel this quote?" confirmLabel="Cancel quote" pending={pending} error={error} onClose={close} onConfirm={() => changeStatus("cancelled", { note })}>
        <p>{number} is kept but can no longer be used. This cannot be undone; duplicate it to start again.</p>
        <label htmlFor="cancel-note" className="mt-3 mb-1.5 block text-xs font-medium text-muted">
          Reason (optional)
        </label>
        <textarea id="cancel-note" rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className={cn(adminInput, "py-2")} />
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "delete"}
        title="Delete this draft?"
        confirmLabel="Delete draft"
        pending={pending}
        error={error}
        onClose={close}
        onConfirm={() =>
          run(async () => {
            const result = await deleteQuoteAction(id);
            if (result.ok) router.push("/admin/quotes");
            return result;
          })
        }
      >
        {number} and its lines will be removed permanently. Only drafts can be deleted.
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "extend"}
        tone="primary"
        title={status === "expired" ? "Reopen as sent" : "Extend validity"}
        confirmLabel={status === "expired" ? "Reopen" : "Save date"}
        pending={pending}
        error={error}
        onClose={close}
        onConfirm={() => (status === "expired" ? changeStatus("sent", { validUntil: day }) : run(() => extendValidityAction(id, day)))}
      >
        <label htmlFor="extend-day" className="mb-1.5 block text-xs font-medium text-muted">
          Valid until
        </label>
        <input id="extend-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className={cn(adminInput, "h-10 [color-scheme:dark]")} />
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "project"}
        tone="primary"
        title="Create a project from this quote?"
        confirmLabel="Create project"
        pending={pending}
        error={error}
        onClose={close}
        onConfirm={() =>
          run(async () => {
            const result = await createProjectFromQuoteAction(id);
            if (result.ok) router.push(`/admin/projects/${result.projectId}/edit`);
            return result;
          })
        }
      >
        An <strong>unpublished</strong> project draft is created for {prospect?.companyName}, linked to this quote, and the prospect is marked as won. Nothing is published.
      </ConfirmDialog>

      <ConfirmDialog
        open={suggestion !== null}
        tone="primary"
        title={suggestion?.kind === "sent" ? "Move the prospect to “Quote sent”?" : "Mark the prospect as won?"}
        confirmLabel={suggestion?.kind === "sent" ? "Move prospect" : "Mark won"}
        pending={pending}
        error={error}
        onClose={() => {
          setSuggestion(null);
          setError(null);
        }}
        onConfirm={applySuggestion}
      >
        {prospect && (
          <>
            <p>
              {prospect.companyName} is currently <strong>{STATUS_LABELS[prospect.status]}</strong>. The prospect only changes if you confirm here.
            </p>
            {prospect.quoteValueCents !== netCents && (
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input type="checkbox" checked={alsoSetValue} onChange={(e) => setAlsoSetValue(e.target.checked)} className="mt-1" />
                <span>
                  Also set the prospect&apos;s quote value to <strong>{money}</strong> (excl. VAT)
                  {prospect.quoteValueCents !== null && <> instead of {formatCents(prospect.quoteValueCents, currency as "EUR", language)}</>}
                </span>
              </label>
            )}
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
