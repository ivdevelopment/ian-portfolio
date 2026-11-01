"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, Check, ExternalLink, FileSignature, Link2, Mail, MessageSquareReply, Pencil, Plus, Rocket, Send, ThumbsDown, Trash2, Trophy, Unlink } from "lucide-react";
import {
  addActivityAction,
  completeFollowUpAction,
  convertToProjectAction,
  deleteProspectAction,
  linkPreviewAction,
  linkProjectAction,
  quickAction,
  setFollowUpAction,
  type ProspectActionResult,
} from "@/app/(admin)/admin/(panel)/prospects/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { MANUAL_ACTIVITY_TYPES, type ActivityType } from "@/lib/prospects/constants";
import { FOLLOW_UP_PRESETS, addDays, formatDay } from "@/lib/prospects/dates";
import type { QuickAction } from "@/lib/prospects/events";
import { cn } from "@/lib/utils";
import { AdminSelect } from "./admin-select";
import { ConfirmDialog } from "./confirm-dialog";
import { Field } from "./form-bits";
import { adminInput } from "./ui";

type Subject = {
  id: string;
  name: string;
  status: string;
  email: string | null;
  website: string | null;
  nextFollowUp: string | null;
  hasPreview: boolean;
  hasProject: boolean;
};

type Dialog = "followup" | "activity" | "convert" | "delete" | "preview" | "project" | null;

/** The header action row of the prospect page. Every change goes through a server action, then the page refreshes. */
export function ProspectActions({
  prospect,
  today,
  previews,
  projects,
}: {
  prospect: Subject;
  today: string;
  previews: Array<{ id: string; label: string }>;
  projects: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = (action: () => Promise<ProspectActionResult>, then?: () => void, success?: string) => {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(result.error);
      if (success) setNote(success);
      then?.();
      setDialog(null);
      router.refresh();
    });
  };
  const quick = (action: QuickAction, label: string) => run(() => quickAction(prospect.id, action), undefined, label);

  const small = "gap-1.5";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink href={`/admin/prospects/${prospect.id}/edit`} variant="secondary" size="sm" icon="none" className={small}>
          <Pencil aria-hidden className="size-4" /> Edit
        </ButtonLink>
        <Button size="sm" variant="secondary" icon="none" className={small} onClick={() => setDialog("activity")}>
          <Plus aria-hidden className="size-4" /> Add activity
        </Button>
        <Button size="sm" variant="secondary" icon="none" className={small} onClick={() => setDialog("followup")}>
          <CalendarClock aria-hidden className="size-4" /> Set follow-up
        </Button>
        <ButtonLink href={`/admin/quotes/new?prospect=${prospect.id}`} variant="secondary" size="sm" icon="none" className={small}>
          <FileSignature aria-hidden className="size-4" /> Create quote
        </ButtonLink>
        <Button size="sm" icon="none" className={small} onClick={() => setDialog("convert")} disabled={prospect.hasProject}>
          <Rocket aria-hidden className="size-4" /> Convert to project
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon="none" className={small} disabled={pending} onClick={() => quick("mark_contacted", "Marked as contacted.")}>
          <Send aria-hidden className="size-4" /> Mark contacted
        </Button>
        <Button size="sm" variant="secondary" icon="none" className={small} disabled={pending} onClick={() => quick("reply_received", "Reply recorded.")}>
          <MessageSquareReply aria-hidden className="size-4" /> Reply received
        </Button>
        <Button size="sm" variant="secondary" icon="none" className={small} disabled={pending || prospect.status === "won"} onClick={() => quick("mark_won", "Marked as won.")}>
          <Trophy aria-hidden className="size-4" /> Mark won
        </Button>
        <Button size="sm" variant="secondary" icon="none" className={small} disabled={pending || prospect.status === "lost"} onClick={() => quick("mark_lost", "Marked as lost.")}>
          <ThumbsDown aria-hidden className="size-4" /> Mark lost
        </Button>
        {prospect.website && (
          <ButtonLink href={prospect.website} external variant="secondary" size="sm" icon="none" className={small}>
            <ExternalLink aria-hidden className="size-4" /> Open website
          </ButtonLink>
        )}
        {prospect.email && (
          <a
            href={`mailto:${prospect.email}`}
            className="glass inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors hover:border-line-strong hover:bg-glass-strong"
          >
            <Mail aria-hidden className="size-4" /> Send email
          </a>
        )}
        <Button size="sm" variant="secondary" icon="none" className={small} onClick={() => setDialog("preview")}>
          <Link2 aria-hidden className="size-4" /> {prospect.hasPreview ? "Change preview" : "Link preview"}
        </Button>
        <Button size="sm" variant="secondary" icon="none" className={small} onClick={() => setDialog("project")}>
          <Link2 aria-hidden className="size-4" /> {prospect.hasProject ? "Change project" : "Link project"}
        </Button>
        <Button size="sm" variant="secondary" icon="none" className={cn(small, "text-danger")} onClick={() => setDialog("delete")}>
          <Trash2 aria-hidden className="size-4" /> Delete
        </Button>
      </div>

      <p aria-live="polite" className={cn("min-h-5 text-sm", error ? "text-danger" : "text-muted")}>
        {error ?? note}
      </p>

      <FollowUpDialog
        key={`fu-${dialog === "followup"}`}
        open={dialog === "followup"}
        today={today}
        current={prospect.nextFollowUp}
        pending={pending}
        error={dialog === "followup" ? error : null}
        onClose={() => setDialog(null)}
        onSet={(day) => run(() => setFollowUpAction(prospect.id, day), undefined, day ? `Follow-up set for ${formatDay(day)}.` : "Follow-up cleared.")}
        onComplete={(next) => run(() => completeFollowUpAction(prospect.id, next), undefined, "Follow-up completed.")}
      />
      <ActivityDialog
        key={`ac-${dialog === "activity"}`}
        open={dialog === "activity"}
        today={today}
        pending={pending}
        error={dialog === "activity" ? error : null}
        onClose={() => setDialog(null)}
        onSave={(input) => run(() => addActivityAction(prospect.id, input), undefined, "Activity added.")}
      />
      <ConfirmDialog
        open={dialog === "convert"}
        title={`Convert ${prospect.name} to a project?`}
        confirmLabel="Convert"
        tone="primary"
        pending={pending}
        error={dialog === "convert" ? error : null}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          setError(null);
          startTransition(async () => {
            const result = await convertToProjectAction(prospect.id);
            if (!result.ok) return setError(result.error);
            setDialog(null);
            router.push(`/admin/projects/${result.projectId}/edit`);
          });
        }}
      >
        This marks the prospect as won and creates an <strong>unpublished</strong> project draft from its name, sector and website, linked back here. Nothing is
        published and no project content is invented.
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "delete"}
        title={`Delete ${prospect.name}?`}
        confirmLabel="Delete"
        pending={pending}
        error={dialog === "delete" ? error : null}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          setError(null);
          startTransition(async () => {
            const result = await deleteProspectAction(prospect.id);
            if (!result.ok) return setError(result.error);
            router.push("/admin/prospects");
            router.refresh();
          });
        }}
      >
        This permanently deletes the prospect and its activity history. A linked project or client preview is <strong>not</strong> deleted.
      </ConfirmDialog>
      <LinkDialog
        key={`lp-${dialog === "preview"}`}
        open={dialog === "preview"}
        title="Link a client preview"
        options={previews}
        canUnlink={prospect.hasPreview}
        pending={pending}
        error={dialog === "preview" ? error : null}
        onClose={() => setDialog(null)}
        onLink={(id) => run(() => linkPreviewAction(prospect.id, id), undefined, id ? "Preview linked." : "Preview unlinked.")}
      />
      <LinkDialog
        key={`lj-${dialog === "project"}`}
        open={dialog === "project"}
        title="Link an existing project"
        options={projects}
        canUnlink={prospect.hasProject}
        pending={pending}
        error={dialog === "project" ? error : null}
        onClose={() => setDialog(null)}
        onLink={(id) => run(() => linkProjectAction(prospect.id, id), undefined, id ? "Project linked." : "Project unlinked.")}
      />
    </div>
  );
}

function FollowUpDialog({
  open,
  today,
  current,
  pending,
  error,
  onClose,
  onSet,
  onComplete,
}: {
  open: boolean;
  today: string;
  current: string | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSet: (day: string | null) => void;
  onComplete: (next: string | null) => void;
}) {
  const [custom, setCustom] = useState(current ?? "");
  return (
    <ConfirmDialog open={open} title="Set follow-up" confirmLabel="Save date" tone="primary" pending={pending} error={error} onClose={onClose} onConfirm={() => custom && onSet(custom)}>
      <p className="mb-3 text-xs text-subtle">
        Today is {formatDay(today)} (Brussels).{current ? ` Current follow-up: ${formatDay(current)}.` : " No follow-up set."}
      </p>
      <div className="flex flex-wrap gap-2">
        {FOLLOW_UP_PRESETS.map((p) => (
          <Button key={p.id} size="sm" variant="secondary" icon="none" disabled={pending} onClick={() => onSet(addDays(today, p.days))}>
            {p.label}
          </Button>
        ))}
      </div>
      <Field id="fu-custom" label="Custom date" className="mt-4">
        <input id="fu-custom" type="date" value={custom} onChange={(e) => setCustom(e.target.value)} className={cn(adminInput, "h-10 [color-scheme:dark]")} />
      </Field>
      {current && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <Button size="sm" variant="secondary" icon="none" disabled={pending} onClick={() => onComplete(null)}>
            <Check aria-hidden className="size-4" /> Mark follow-up done
          </Button>
          <Button size="sm" variant="secondary" icon="none" disabled={pending} onClick={() => onComplete(addDays(today, 7))}>
            Done, next in 7 days
          </Button>
          <Button size="sm" variant="secondary" icon="none" disabled={pending} onClick={() => onSet(null)}>
            Clear follow-up
          </Button>
        </div>
      )}
    </ConfirmDialog>
  );
}

function ActivityDialog({
  open,
  today,
  pending,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  today: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: { type: ActivityType; title: string; description: string; occurredOn: string }) => void;
}) {
  const [type, setType] = useState<ActivityType>("note");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [day, setDay] = useState(today);
  const options = MANUAL_ACTIVITY_TYPES.map((t) => ({ value: t.value, label: t.label }));
  return (
    <ConfirmDialog
      open={open}
      title="Add activity"
      confirmLabel="Add"
      tone="primary"
      pending={pending}
      error={error}
      onClose={onClose}
      onConfirm={() => onSave({ type, title, description, occurredOn: day })}
    >
      <div className="space-y-3">
        <Field id="ac-type" label="Type">
          <AdminSelect id="ac-type" value={type} onChange={(v) => setType(v as ActivityType)} options={options} />
        </Field>
        <Field id="ac-title" label="Title">
          <input id="ac-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={cn(adminInput, "h-10")} placeholder="What happened?" />
        </Field>
        <Field id="ac-desc" label="Details (optional)">
          <textarea id="ac-desc" rows={3} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} className={cn(adminInput, "py-2")} />
        </Field>
        <Field id="ac-day" label="Date">
          <input id="ac-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className={cn(adminInput, "h-10 [color-scheme:dark]")} />
        </Field>
      </div>
    </ConfirmDialog>
  );
}

function LinkDialog({
  open,
  title,
  options,
  canUnlink,
  pending,
  error,
  onClose,
  onLink,
}: {
  open: boolean;
  title: string;
  options: Array<{ id: string; label: string }>;
  canUnlink: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onLink: (id: string | null) => void;
}) {
  const [choice, setChoice] = useState(options[0]?.id ?? "");
  return (
    <ConfirmDialog open={open} title={title} confirmLabel="Link" tone="primary" pending={pending} error={error} onClose={onClose} onConfirm={() => choice && onLink(choice)}>
      {options.length === 0 ? (
        <p>Nothing to link yet.</p>
      ) : (
        <Field id="link-choice" label="Choose one">
          <AdminSelect id="link-choice" value={choice} onChange={setChoice} options={options.map((o) => ({ value: o.id, label: o.label }))} />
        </Field>
      )}
      {canUnlink && (
        <Button size="sm" variant="secondary" icon="none" className="mt-4 gap-1.5" disabled={pending} onClick={() => onLink(null)}>
          <Unlink aria-hidden className="size-4" /> Remove the current link
        </Button>
      )}
      <p className="mt-3 text-xs text-subtle">Linking never changes the preview or project itself.</p>
    </ConfirmDialog>
  );
}

export function OpenLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs text-accent hover:underline">
      {children}
    </Link>
  );
}
