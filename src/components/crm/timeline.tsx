import Link from "next/link";
import { ArrowRightLeft, CircleDot, Eye, FileSignature, FolderKanban, Mail, MailOpen, type LucideIcon } from "lucide-react";
import { formatBrusselsDateTime } from "@/lib/preview/access-activity";
import type { TimelineItem } from "@/lib/mail/timeline";
import type { AppPaths } from "@/lib/crm/paths";
import { activityHeading } from "@/lib/prospects/events";
import { formatDay } from "@/lib/prospects/dates";
import { cn } from "@/lib/utils";

const QUOTE_EVENT_LABELS: Record<string, string> = { created: "Quote created", sent: "Quote sent", accepted: "Quote accepted", rejected: "Quote rejected", cancelled: "Quote cancelled" };

type Look = { icon: LucideIcon; tone: string; label: string };
const LOOK = {
  activity: { icon: CircleDot, tone: "text-accent", label: "Activity" },
  status: { icon: ArrowRightLeft, tone: "text-violet-300", label: "Status" },
  project: { icon: FolderKanban, tone: "text-emerald-300", label: "Project" },
  quote: { icon: FileSignature, tone: "text-violet-300", label: "Quote" },
  preview: { icon: Eye, tone: "text-amber-200", label: "Preview" },
  emailIn: { icon: MailOpen, tone: "text-sky-300", label: "Email received" },
  emailOut: { icon: Mail, tone: "text-sky-300", label: "Email sent" },
} satisfies Record<string, Look>;

/**
 * The unified timeline, newest first. Each event comes from the one table it lives in (CRM activities, synced mail, quote activity,
 * the preview record) and is shown once; the icon says what kind of event it is, so the list can be scanned.
 */
export function Timeline({ items, paths }: { items: TimelineItem[]; paths: AppPaths }) {
  return (
    <ol className="relative space-y-4 border-l border-line pl-6" aria-label="Activity timeline">
      {items.map((item) => {
        let look: Look = LOOK.activity;
        let title: React.ReactNode = null;
        let detail: React.ReactNode = null;
        let when = "";
        if (item.kind === "email") {
          const m = item.mail;
          look = m.direction === "incoming" ? LOOK.emailIn : LOOK.emailOut;
          title = m.direction === "incoming" ? "Email received" : "Email sent";
          detail = (
            <>
              {m.subject && <span className="block text-sm">{m.subject}</span>}
              {/* Plain text only: mail HTML is never stored or displayed. */}
              {m.snippet && <span className="mt-0.5 block text-sm text-muted">{m.snippet}</span>}
            </>
          );
          when = formatBrusselsDateTime(m.sent_at);
        } else if (item.kind === "quote") {
          look = LOOK.quote;
          title = (
            <>
              {QUOTE_EVENT_LABELS[item.quote.type] ?? "Quote updated"}{" "}
              <Link href={paths.quote(item.quote.quoteId)} className="text-accent hover:underline">
                {item.quote.quoteNumber}
              </Link>
            </>
          );
          when = formatBrusselsDateTime(item.quote.createdAt);
        } else if (item.kind === "preview") {
          look = LOOK.preview;
          title = item.preview.title;
          detail = item.preview.detail ? <span className="block text-xs text-muted">{item.preview.detail}</span> : null;
          when = formatBrusselsDateTime(item.preview.at);
        } else {
          const a = item.activity;
          const heading = activityHeading(a);
          look = a.type === "status_changed" ? LOOK.status : a.type.startsWith("project_") || a.type === "won" ? LOOK.project : LOOK.activity;
          title = heading.title;
          detail = (
            <>
              {heading.detail && <span className="block text-xs text-muted">{heading.detail}</span>}
              {a.description && <span className="mt-0.5 block text-sm whitespace-pre-wrap text-muted">{a.description}</span>}
            </>
          );
          // Day-only history (imports, manual dates) has no clock time: show the calendar day it belongs to.
          when = a.occurred_at ? formatBrusselsDateTime(a.occurred_at) : formatDay(a.occurred_on);
        }
        return (
          <li key={item.key} className="relative">
            <span aria-hidden className={cn("absolute -left-[2.15rem] top-0 flex size-6 items-center justify-center rounded-full border border-line bg-surface", look.tone)}>
              <look.icon className="size-3.5" />
            </span>
            <p className="text-xs text-subtle">
              <span className="sr-only">{look.label}: </span>
              {when}
            </p>
            <p className="text-sm font-medium">{title}</p>
            {detail}
          </li>
        );
      })}
    </ol>
  );
}
