import { Badge } from "./ui";
import {
  DELIVERY_LABELS,
  PRIORITY_LABELS,
  PRIORITY_TONES,
  STATUS_LABELS,
  STATUS_TONES,
  isClosed,
  type DeliveryStatus,
  type ProspectPriority,
  type ProspectStatus,
} from "@/lib/prospects/constants";
import { classifyFollowUp, followUpLabel, formatDay } from "@/lib/prospects/dates";
import { cn } from "@/lib/utils";

export const iconButton =
  "inline-flex size-8 items-center justify-center rounded-md border border-line text-muted transition-colors " +
  "hover:border-line-strong hover:bg-glass-strong hover:text-ink disabled:opacity-50";

export function ProspectStatusBadge({ status }: { status: ProspectStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: ProspectPriority }) {
  return <Badge tone={PRIORITY_TONES[priority]}>{PRIORITY_LABELS[priority]}</Badge>;
}

export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  if (status === "unknown") return null;
  return <Badge tone={status === "confirmed" ? "success" : "warn"}>{DELIVERY_LABELS[status]}</Badge>;
}

/**
 * The follow-up as a date plus a derived indicator ("Overdue 2 days"). The pipeline status is never changed
 * because a date passed: this is display only. Closed prospects show the date without an alarm.
 */
export function FollowUpCell({
  day,
  status,
  today,
  compact,
}: {
  day: string | null;
  status: ProspectStatus;
  today: string;
  compact?: boolean;
}) {
  if (!day) return <span className="text-subtle">—</span>;
  const state = classifyFollowUp(day, today);
  const closed = isClosed(status);
  const tone =
    closed || state.kind === "upcoming" || state.kind === "tomorrow"
      ? "text-muted"
      : state.kind === "overdue"
        ? "text-danger"
        : "text-amber-200";
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className={cn("text-sm", closed ? "text-muted" : "text-ink")}>{formatDay(day)}</span>
      {!closed && !compact && <span className={cn("text-xs", tone)}>{followUpLabel(state)}</span>}
    </span>
  );
}
