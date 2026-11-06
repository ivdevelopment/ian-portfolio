"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { setStatusAction } from "@/app/(admin)/admin/(panel)/prospects/actions";
import { adminInput, Badge, Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { dismissMailRecommendationAction, getMailAssistantViewAction, markMailDraftUsedAction, requestMailRecommendationAction } from "@/crm/actions/mail-assistant";
import { useAppPaths } from "@/lib/crm/paths-context";
import type { AssistantView } from "@/lib/mail-assistant/view";
import { PRE_CONTACT_STATUSES, type ProspectStatus } from "@/lib/prospects/constants";
import { usePendingAction } from "@/lib/use-pending-action";
import { cn } from "@/lib/utils";

/**
 * The Mail Assistant tab. It suggests the next email from the CRM history and writes a draft for Ian to edit, copy into Zoho and send himself.
 * Nothing here sends mail. Opening the page never uses Codex: only Generate, Regenerate and Refresh queue a draft for the local agent.
 */
const POLL_MS = 3000;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function MailAssistantPanel({ initial, prospectStatus }: { initial: AssistantView; prospectStatus: ProspectStatus }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [ready, setReady] = useState(false);
  const { pending, run } = usePendingAction();
  const hadJob = useRef(Boolean(initial.job));
  const prospectId = initial.prospectId;

  const refresh = useCallback(async () => {
    const r = await getMailAssistantViewAction(prospectId);
    if (!r.ok) return;
    setView(r.view);
    if (hadJob.current && !r.view.job && r.view.draft && !r.view.draft.stale.outdated) {
      setReady(true);
      setTimeout(() => setReady(false), 5000);
    }
    hadJob.current = Boolean(r.view.job);
  }, [prospectId]);

  // While a draft is being made, look for the result every few seconds. Nothing polls when there is no open request.
  const open = Boolean(view.job);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [open, refresh]);

  const generate = () =>
    run(async () => {
      setError(null);
      setChecking(true);
      try {
        const r = await requestMailRecommendationAction(prospectId);
        if (!r.ok) setError(r.error);
        await refresh();
      } finally {
        setChecking(false);
      }
    });

  const cancelRequest = (id: string) =>
    run(async () => {
      const r = await dismissMailRecommendationAction(id);
      if (!r.ok) setError(r.error);
      await refresh();
    });

  const { plan, draft, job, generate: gen, availability, failure } = view;
  const waiting = plan.action === "wait";
  const showDraft = draft && plan.needsDraft;

  return (
    <Panel title="Mail Assistant" description="Suggests the next email for this prospect from the CRM history. It only drafts: nothing is sent from here.">
      <div className="space-y-5">
        {/* What to do, and when: always decided by rules from the history, never by the model. */}
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Suggested action</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-lg font-medium">
              {plan.actionLabel}
              {plan.isFinal && plan.needsDraft && <Badge tone="warn">Final message</Badge>}
            </dd>
            {waiting && plan.thenLabel && <p className="mt-0.5 text-sm text-muted">Then: {plan.thenLabel.toLowerCase()}</p>}
          </div>
          <div>
            <dt className="text-xs text-muted">{waiting ? "Recommended follow-up" : "Recommended timing"}</dt>
            <dd className="mt-0.5 text-lg font-medium">
              {plan.recommendedOn ? (waiting ? plan.recommendedLabel : plan.timingLabel) : "—"}
            </dd>
            {!waiting && plan.recommendedOn && plan.timingLabel !== "Today" && plan.timingLabel !== "Tomorrow" && <p className="mt-0.5 text-sm text-muted">Next working day that suits a mail</p>}
            {!waiting && plan.timingLabel === "Tomorrow" && <p className="mt-0.5 text-sm text-muted">{plan.recommendedLabel}</p>}
          </div>
        </dl>

        <div>
          <p className="text-xs text-muted">Why</p>
          <p className="mt-0.5 text-sm">{plan.reason}</p>
          {draft?.reasonSummary && plan.needsDraft && !draft.stale.outdated && <p className="mt-1 text-sm text-muted">Angle: {draft.reasonSummary}</p>}
          {plan.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {plan.warnings.map((w) => (
                <li key={w} className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-100">
                  {w}
                </li>
              ))}
            </ul>
          )}
          {plan.blocked === "more_context_needed" && (
            <p role="status" className="mt-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
              More email context needed. The CRM keeps only a short snippet of each mail, which is not enough to answer without guessing. Read the reply in Zoho and answer from there.
            </p>
          )}
        </div>

        {/* Live state of a request. No fake percentages: only what is really happening. */}
        <div aria-live="polite" className="min-h-6 text-sm">
          {checking && !job && (
            <span className="inline-flex items-center gap-2 text-muted">
              <Spinner className="size-3.5" /> Checking history…
            </span>
          )}
          {job?.stage === "waiting_agent" && (
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
              <span className="inline-flex items-center gap-2">
                <Spinner className="size-3.5" /> Waiting for Ian Prospect Agent…
              </span>
              {job.stuck && <span className="text-amber-200">Still waiting. Is Ian Prospect Agent running on your PC?</span>}
              <button type="button" onClick={() => void cancelRequest(job.id)} className="text-accent hover:underline">
                Cancel request
              </button>
            </span>
          )}
          {job?.stage === "generating" && (
            <span className="inline-flex items-center gap-2 text-muted">
              <Spinner className="size-3.5" /> Generating draft…
            </span>
          )}
          {ready && !job && <span className="text-success">Draft ready</span>}
          {error && (
            <span role="alert" className="text-danger">
              {error}
            </span>
          )}
          {failure && !job && !error && (
            <span role="alert" className="text-danger">
              {failure.message}
            </span>
          )}
        </div>

        {/* Outdated drafts are never silently reused. */}
        {draft?.stale.outdated && (
          <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            <p className="font-medium">{draft.stale.headline}</p>
            <p className="mt-0.5">{draft.stale.detail}</p>
            <details className="mt-2 text-amber-100/80">
              <summary className="cursor-pointer select-none">Show the outdated draft</summary>
              <p className="mt-2 font-medium">{draft.subject}</p>
              <p className="mt-1 whitespace-pre-wrap">{draft.body}</p>
            </details>
          </div>
        )}

        {showDraft && !draft.stale.outdated && <DraftEditor key={draft.id} draft={draft} prospectId={prospectId} prospectStatus={prospectStatus} onChanged={refresh} setError={setError} />}

        <div className="flex flex-wrap items-center gap-3">
          {gen && (
            <Button size="sm" icon="none" variant={gen.label === "Generate draft" || gen.label === "Refresh recommendation" ? "primary" : "secondary"} disabled={!gen.enabled || Boolean(job)} pending={pending && !job} pendingLabel="Queuing…" onClick={() => void generate()}>
              {gen.label}
            </Button>
          )}
          {gen && !gen.enabled && gen.disabledReason && (
            <p role="status" className="text-sm text-amber-200">
              {gen.disabledReason}
            </p>
          )}
          {!gen && !plan.needsDraft && availability.state !== "ready" && <p className="text-sm text-subtle">{availability.message}</p>}
        </div>
      </div>
    </Panel>
  );
}

function DraftEditor({ draft, prospectId, prospectStatus, onChanged, setError }: { draft: NonNullable<AssistantView["draft"]>; prospectId: string; prospectStatus: ProspectStatus; onChanged: () => Promise<void>; setError: (e: string | null) => void }) {
  const P = useAppPaths();
  // Editing happens here only. Polling replaces the view, never these fields: they reset only when a different draft arrives (the key).
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState<null | "subject" | "body" | "both" | "failed">(null);
  const { pending, run } = usePendingAction();
  const [contacted, setContacted] = useState(false);

  const flash = (what: NonNullable<typeof copied>) => {
    setCopied(what);
    setTimeout(() => setCopied(null), 2200);
  };
  const copy = async (what: "subject" | "body" | "both") => flash((await copyText(what === "subject" ? subject : what === "body" ? body : `${subject}\n\n${body}`)) ? what : "failed");

  const markUsed = () =>
    run(async () => {
      setError(null);
      const r = await markMailDraftUsedAction(draft.id);
      if (!r.ok) setError(r.error);
      await onChanged();
    });
  const dismiss = () =>
    run(async () => {
      setError(null);
      const r = await dismissMailRecommendationAction(draft.id);
      if (!r.ok) setError(r.error);
      await onChanged();
    });
  const markContacted = () =>
    run(async () => {
      const r = await setStatusAction(prospectId, "contacted");
      if (r && "ok" in r && r.ok === false) setError(typeof r.error === "string" ? r.error : "That couldn't be saved.");
      else setContacted(true);
    });

  return (
    <div className="space-y-3 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{draft.used ? "Draft (marked as used)" : "Draft"}</p>
        <span className="flex flex-wrap items-center gap-2 text-xs text-subtle">
          {draft.language && <Badge>{draft.language === "nl" ? "Dutch" : "English"}</Badge>}
          <span>You can edit before copying. Your edits are not saved.</span>
        </span>
      </div>

      <div>
        <label htmlFor="mail-subject" className="text-xs text-muted">
          Subject
        </label>
        <input id="mail-subject" type="text" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className={cn(adminInput, "mt-1 h-10")} />
      </div>
      <div>
        <label htmlFor="mail-body" className="text-xs text-muted">
          Email
        </label>
        <textarea id="mail-body" rows={Math.min(18, Math.max(8, body.split("\n").length + 2))} value={body} maxLength={6000} onChange={(e) => setBody(e.target.value)} className={cn(adminInput, "mt-1 py-2 leading-relaxed")} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="none" variant="secondary" onClick={() => void copy("subject")}>
          Copy subject
        </Button>
        <Button size="sm" icon="none" variant="secondary" onClick={() => void copy("body")}>
          Copy body
        </Button>
        <Button size="sm" icon="none" variant="primary" onClick={() => void copy("both")}>
          Copy both
        </Button>
        <span role="status" aria-live="polite" className="min-w-16 text-sm">
          {copied === "failed" ? <span className="text-danger">Copy failed. Select the text and copy it by hand.</span> : copied ? <span className="text-success">Copied</span> : null}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {!draft.used && (
          <Button size="sm" icon="none" variant="secondary" pending={pending} pendingLabel="Saving…" onClick={() => void markUsed()}>
            Mark as used
          </Button>
        )}
        <Button size="sm" icon="none" variant="ghost" disabled={pending} onClick={() => void dismiss()}>
          Dismiss
        </Button>
      </div>

      {draft.used && (
        <div className="rounded-md border border-line bg-glass p-3 text-sm">
          <p>
            Marked as used. This does not mean the mail was sent: after you send it from Zoho, use <Link href={P.prospectTab(prospectId, "email")} className="text-accent hover:underline">Sync now on the Email tab</Link> so the CRM sees it and the next suggestion follows from it.
          </p>
          {PRE_CONTACT_STATUSES.includes(prospectStatus) && !contacted && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-muted">Mark prospect as Contacted?</span>
              <Button size="sm" icon="none" variant="secondary" pending={pending} onClick={() => void markContacted()}>
                Mark as Contacted
              </Button>
            </div>
          )}
          {contacted && <p className="mt-2 text-success">The prospect is now marked as Contacted.</p>}
        </div>
      )}
    </div>
  );
}
