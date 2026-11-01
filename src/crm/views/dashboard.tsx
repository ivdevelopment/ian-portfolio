import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CalendarClock, CircleDot, Eye, FileSignature, FolderKanban, Mail, MessageSquareReply, Repeat2, type LucideIcon } from "lucide-react";
import { Panel } from "@/components/admin/ui";
import { CardSkeleton, SectionSkeleton, Skeleton, StatCardsSkeleton } from "@/components/ui/loading";
import { getPipeline, getRecentActivity, getToday, type ActivityItem } from "@/crm/queries/dashboard";
import { formatBrusselsDateTime } from "@/lib/preview/access-activity";
import { brusselsToday, formatDay } from "@/lib/prospects/dates";
import { formatCents } from "@/lib/quotes/money";
import { getPaths } from "@/lib/crm/server-paths";
import { cn } from "@/lib/utils";

/** "Good evening" for the Brussels hour: the CRM is used by one person, so it greets them. */
function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hour: "numeric", hour12: false }).format(now));
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default async function CrmDashboard() {
  // The greeting and "today" depend on the clock: read the request first so this is rendered per request, never prerendered.
  await connection();
  const today = brusselsToday();
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-medium tracking-tight">{greeting()}, Ian</h1>
        <p className="mt-1 text-sm text-muted">{formatDay(today)}</p>
      </header>

      <Suspense fallback={<TodaySkeleton />}>
        <TodaySection today={today} />
      </Suspense>
      <Suspense fallback={<PipelineSkeleton />}>
        <PipelineSection today={today} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="recent activity" lines={6} />}>
        <ActivitySection />
      </Suspense>
    </>
  );
}

const sectionTitle = "mb-3 text-xs font-medium tracking-wider text-subtle uppercase";

function TodaySkeleton() {
  return (
    <section role="status" aria-busy="true" className="mb-8">
      <span className="sr-only">Loading today…</span>
      <p className={sectionTitle}>Today</p>
      <StatCardsSkeleton count={3} className="lg:grid-cols-3" />
      <CardSkeleton lines={4} className="mt-3" />
    </section>
  );
}

function PipelineSkeleton() {
  return (
    <section role="status" aria-busy="true" className="mb-8">
      <span className="sr-only">Loading pipeline…</span>
      <p className={sectionTitle}>Pipeline</p>
      <StatCardsSkeleton count={4} />
      <div aria-hidden className="mt-3 space-y-2 rounded-card border border-line bg-glass p-4">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value, hint, href, tone }: { label: string; value: string; hint?: string; href?: string; tone?: "alert" }) {
  const body = (
    <>
      <p className={cn("text-2xl font-medium tabular-nums", tone === "alert" && "text-danger")}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </>
  );
  const classes = "block rounded-card border border-line bg-surface p-4";
  return href ? (
    <Link href={href} className={cn(classes, "transition-colors hover:border-line-strong")}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

async function TodaySection({ today }: { today: string }) {
  const P = await getPaths();
  const t = await getToday(today);
  const due = t.summary.followups_overdue + t.summary.followups_today;
  const attention: Array<{ key: string; icon: LucideIcon; tone: "alert" | "warn" | "info"; text: React.ReactNode; href: string }> = [];

  for (const p of t.overdue.slice(0, 4)) {
    attention.push({ key: `o:${p.id}`, icon: CalendarClock, tone: "alert", text: <><strong className="font-medium">{p.company}</strong> follow-up overdue since {formatDay(p.day)}</>, href: P.prospect(p.id) });
  }
  for (const p of t.dueToday.slice(0, 4)) {
    attention.push({ key: `t:${p.id}`, icon: CalendarClock, tone: "warn", text: <><strong className="font-medium">{p.company}</strong> follow-up due today</>, href: P.prospect(p.id) });
  }
  for (const r of t.replies) {
    attention.push({ key: `r:${r.id}`, icon: MessageSquareReply, tone: "warn", text: <><strong className="font-medium">{r.company}</strong> replied{r.subject ? `: “${r.subject}”` : ""}</>, href: P.prospectTab(r.id, "email") });
  }
  for (const q of t.expiringQuotes) {
    attention.push({ key: `e:${q.id}`, icon: FileSignature, tone: "warn", text: <>Quote <strong className="font-medium">{q.number}</strong> for {q.client} {q.days === 0 ? "expires today" : `expires in ${q.days} day${q.days === 1 ? "" : "s"}`}</>, href: P.quote(q.id) });
  }
  for (const p of t.noNextAction.slice(0, 3)) {
    attention.push({ key: `n:${p.id}`, icon: CircleDot, tone: "info", text: <><strong className="font-medium">{p.company}</strong> has no next step planned</>, href: P.prospect(p.id) });
  }
  const awaiting = t.awaitingQuotes.filter((q) => !t.expiringQuotes.some((e) => e.id === q.id)).slice(0, 3);
  for (const q of awaiting) {
    attention.push({ key: `w:${q.id}`, icon: FileSignature, tone: "info", text: <>Quote <strong className="font-medium">{q.number}</strong> for {q.client} awaits an answer{q.sentAt ? `, sent ${formatDay(q.sentAt.slice(0, 10))}` : ""}</>, href: P.quote(q.id) });
  }

  const tones = { alert: "text-danger", warn: "text-amber-200", info: "text-muted" } as const;

  return (
    <section className="mb-8" aria-labelledby="today-h">
      <h2 id="today-h" className={sectionTitle}>
        Today
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Follow-ups due" value={String(due)} hint={t.summary.followups_overdue > 0 ? `${t.summary.followups_overdue} overdue` : undefined} tone={t.summary.followups_overdue > 0 ? "alert" : undefined} href={P.followUps ?? P.prospects} />
        <Stat label="New replies" value={t.zohoEnabled ? String(t.repliesTotal) : "—"} hint={t.zohoEnabled ? undefined : "Email not connected"} href={t.repliesTotal > 0 ? P.followUps ?? P.prospects : undefined} />
        <Stat label="Quotes expiring (7 days)" value={String(t.expiringQuotes.length)} hint={t.awaitingQuotes.length ? `${t.awaitingQuotes.length} sent, awaiting an answer` : undefined} href={`${P.quotes}?status=sent`} />
      </div>
      <Panel title="Needs attention" description="What to do next." className="mt-3">
        {attention.length === 0 ? (
          <p className="text-sm text-muted">Nothing needs attention right now.</p>
        ) : (
          <ul className="divide-y divide-line">
            {attention.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="flex items-start gap-3 py-2.5 text-sm transition-colors hover:text-accent">
                  <a.icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tones[a.tone])} />
                  <span className="min-w-0">{a.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}

const STAGES = ["new", "contacted", "replied", "interested", "concept_sent", "quote_sent", "won"] as const;

async function PipelineSection({ today }: { today: string }) {
  const P = await getPaths();
  const d = await getPipeline(today);
  const counts = new Map(d.stages.map((s) => [s.status, s]));
  const max = Math.max(1, ...STAGES.map((s) => counts.get(s)?.count ?? 0));
  const closed = d.stages.filter((s) => ["lost", "not_interested", "no_response"].includes(s.status)).reduce((n, s) => n + s.count, 0);

  return (
    <section className="mb-8" aria-labelledby="pipeline-h">
      <h2 id="pipeline-h" className={sectionTitle}>
        Pipeline
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Prospects" value={String(d.summary.total)} href={P.prospects} />
        <Stat label="Open opportunities" value={String(d.summary.active_opportunities)} hint="replied, interested, concept, quote" href={P.pipeline} />
        <Stat label="Quoted value" value={d.quotes.open.count ? formatCents(d.quotes.open.netCents) : "—"} hint={d.quotes.open.count ? `${d.quotes.open.count} open quote${d.quotes.open.count === 1 ? "" : "s"}, excl. VAT` : "No open quotes"} href={P.quotes} />
        <Stat label="Accepted quotes" value={d.quotes.accepted.count ? formatCents(d.quotes.accepted.netCents) : "—"} hint={d.quotes.accepted.count ? `${d.quotes.accepted.count} accepted, excl. VAT` : "None yet"} href={`${P.quotes}?status=accepted`} />
      </div>

      <Panel title="Pipeline snapshot" className="mt-3" actions={<Link href={P.pipeline} className="text-xs text-muted hover:text-ink">Open pipeline</Link>}>
        <ul className="space-y-2.5">
          {STAGES.map((status) => {
            const s = counts.get(status)!;
            return (
              <li key={status} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                <Link href={`${P.prospects}?status=${status}`} className="truncate text-muted hover:text-ink">
                  {s.label}
                </Link>
                <div aria-hidden className="h-2 overflow-hidden rounded-full bg-glass-strong">
                  <div className={cn("h-full rounded-full", status === "won" ? "bg-emerald-400/70" : "bg-accent-strong/70")} style={{ width: `${(s.count / max) * 100}%` }} />
                </div>
                <span className="text-right tabular-nums">{s.count}</span>
              </li>
            );
          })}
        </ul>
        {closed > 0 && <p className="mt-3 text-xs text-subtle">{closed} closed (lost, not interested or no response) are not shown.</p>}
      </Panel>
    </section>
  );
}

const ICONS: Record<ActivityItem["kind"], LucideIcon> = { email: Mail, quote: FileSignature, preview: Eye, status: Repeat2, activity: CircleDot, project: FolderKanban };

async function ActivitySection() {
  const P = await getPaths();
  const items = await getRecentActivity(12);
  return (
    <section aria-labelledby="activity-h">
      <h2 id="activity-h" className={sectionTitle}>
        Recent activity
      </h2>
      <Panel>
        {items.length === 0 ? (
          <p className="text-sm text-muted">No recent activity.</p>
        ) : (
          <ol className="divide-y divide-line">
            {items.map((item) => {
              const Icon = ICONS[item.kind];
              const href = item.href ? (item.href.type === "quote" ? P.quote(item.href.id) : P.prospect(item.href.id)) : null;
              const body = (
                <>
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      {item.title}
                      {item.prospectName && <span className="text-muted"> · {item.prospectName}</span>}
                    </span>
                    {item.detail && <span className="block truncate text-xs text-muted">{item.detail}</span>}
                  </span>
                  <time dateTime={item.at} className="shrink-0 text-xs text-subtle">
                    {formatBrusselsDateTime(item.at)}
                  </time>
                </>
              );
              return (
                <li key={item.key}>
                  {href ? (
                    <Link href={href} className="flex items-start gap-3 py-2.5 transition-colors hover:text-accent">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </section>
  );
}

