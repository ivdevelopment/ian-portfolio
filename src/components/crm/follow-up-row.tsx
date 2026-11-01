"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { completeFollowUpAction, setFollowUpAction } from "@/app/(admin)/admin/(panel)/prospects/actions";
import { NETWORK_ERROR } from "@/components/admin/use-action-runner";
import { ProspectStatusBadge } from "@/components/admin/prospect-ui";
import { Spinner } from "@/components/ui/loading";
import { useAppPaths } from "@/lib/crm/paths-context";
import type { ProspectStatus } from "@/lib/prospects/constants";
import { FOLLOW_UP_PRESETS, addDays, formatDay } from "@/lib/prospects/dates";
import { usePendingAction } from "@/lib/use-pending-action";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { adminInput } from "@/components/admin/ui";

export type FollowUpItem = { id: string; company: string; status: ProspectStatus; priority: string; day: string | null; lastActivity: string | null };

const smallButton =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-muted transition-colors hover:border-line-strong hover:bg-glass-strong hover:text-ink disabled:pointer-events-none disabled:opacity-50";

/**
 * One prospect in the follow-up planner, with the three things you do about it: open it, mark the follow-up done, or move it.
 * Each action runs one at a time, shows what it is doing, and puts the row back in a usable state if it fails.
 */
export function FollowUpRow({ item, today }: { item: FollowUpItem; today: string }) {
  const P = useAppPaths();
  const router = useRouter();
  const { pending, run } = usePendingAction();
  const [active, setActive] = useState<"complete" | "move" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [open, setOpen] = useState(false);

  const perform = (kind: "complete" | "move", job: () => Promise<{ ok: boolean; error?: string }>) =>
    run(async () => {
      setActive(kind);
      setError(null);
      try {
        const result = await job();
        if (!result.ok) return setError(result.error ?? "That couldn't be saved.");
        setOpen(false);
        router.refresh();
      } catch {
        setError(NETWORK_ERROR);
      } finally {
        setActive(null);
      }
    });

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <Link href={P.prospect(item.id)} className="block truncate text-sm font-medium hover:text-accent">
            {item.company}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <ProspectStatusBadge status={item.status} />
            {item.day ? <span>{formatDay(item.day)}</span> : <span className="text-subtle">No date</span>}
            {item.lastActivity && <span className="truncate text-subtle">· {item.lastActivity}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-busy={pending}>
          {item.day && (
            <button type="button" className={smallButton} disabled={pending} onClick={() => perform("complete", () => completeFollowUpAction(item.id, null))}>
              {active === "complete" ? <Spinner className="size-3" /> : <Check aria-hidden className="size-3.5" />}
              {active === "complete" ? "Completing…" : "Done"}
            </button>
          )}
          <button type="button" className={smallButton} disabled={pending} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {active === "move" ? <Spinner className="size-3" /> : <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-180")} />}
            {active === "move" ? "Rescheduling…" : item.day ? "Reschedule" : "Schedule"}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-glass p-2">
          {FOLLOW_UP_PRESETS.map((p) => (
            <button key={p.id} type="button" className={smallButton} disabled={pending} onClick={() => perform("move", () => setFollowUpAction(item.id, addDays(today, p.days)))}>
              {p.label}
            </button>
          ))}
          <input type="date" aria-label={`Follow-up date for ${item.company}`} value={custom} min={today} onChange={(e) => setCustom(e.target.value)} className={cn(adminInput, "h-8 w-40 text-xs [color-scheme:dark]")} />
          <button type="button" className={smallButton} disabled={pending || !custom} onClick={() => perform("move", () => setFollowUpAction(item.id, custom))}>
            Set date
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
