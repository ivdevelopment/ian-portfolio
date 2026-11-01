import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { OpenLink, ProspectActions } from "@/components/admin/prospect-detail-actions";
import { MarkRepliedButton } from "@/components/admin/prospect-mail";
import { ProspectNotes } from "@/components/admin/prospect-notes";
import { DeliveryBadge, FollowUpCell, PriorityBadge, ProspectStatusBadge } from "@/components/admin/prospect-ui";
import { QuoteStatusBadge } from "@/components/admin/quote-ui";
import { Badge, EmptyState, Panel, formatDateTime } from "@/components/admin/ui";
import { MailSyncButton } from "@/components/crm/mail-sync-button";
import { ProspectStatusSelect } from "@/components/crm/prospect-status-select";
import { Timeline } from "@/components/crm/timeline";
import { SectionSkeleton } from "@/components/ui/loading";
import { getPaths } from "@/lib/crm/server-paths";
import type { AppPaths } from "@/lib/crm/paths";
import { getZohoConfig } from "@/lib/mail/zoho/config";
import { getConnection, listProspectMail } from "@/lib/mail/zoho/service";
import { lastEmail, mergeTimeline, suggestReply, type PreviewEvent } from "@/lib/mail/timeline";
import { describeAccess, formatBrusselsDateTime, summarizeAccess } from "@/lib/preview/access-activity";
import { getPreviewConfig } from "@/lib/preview/config";
import { previewState } from "@/lib/preview/expiry";
import { brusselsToday, formatDay } from "@/lib/prospects/dates";
import { formatEur } from "@/lib/prospects/money";
import { getLinked, getProspect, listActivities, listLinkableOptions } from "@/lib/prospects/queries";
import type { ProspectRecord } from "@/lib/prospects/types";
import { latestActiveQuote } from "@/lib/quotes/metrics";
import { formatCents } from "@/lib/quotes/money";
import { listQuoteEventsForProspect, listQuotesForProspect } from "@/lib/quotes/queries";
import { idSchema } from "@/lib/schemas/prospect";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "email", label: "Email" },
  { id: "quotes", label: "Quotes" },
  { id: "projects", label: "Projects" },
  { id: "preview", label: "Preview" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * The prospect dossier: one header (who, where they stand, what to do), then one section at a time. Each section loads its own data
 * on its own, so switching sections never refetches the whole dossier, and the header is on screen first.
 */
export default async function ProspectDossierPage({ params, searchParams }: Props) {
  const P = await getPaths();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const rawTab = (await searchParams)?.tab;
  const tab: TabId = TABS.some((t) => t.id === rawTab) ? (rawTab as TabId) : "overview";

  const prospect = await getProspect(id);
  if (!prospect) notFound();
  const options = await listLinkableOptions();
  const today = brusselsToday();

  return (
    <>
      <div className="mb-1 text-xs text-subtle">
        <Link href={P.prospects} className="hover:text-ink">
          Prospects
        </Link>{" "}
        / {prospect.company_name}
      </div>
      <header className="mb-5">
        <h1 className="text-2xl font-medium tracking-tight">{prospect.company_name}</h1>
        <p className="mt-1 text-sm text-muted">{[prospect.sector, prospect.city].filter(Boolean).join(" · ") || "No sector or city yet"}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <ProspectStatusBadge status={prospect.status} />
          <PriorityBadge priority={prospect.priority} />
          <DeliveryBadge status={prospect.contact_delivery_status} />
          <span className="inline-flex items-center gap-2 text-xs text-muted">
            Next follow-up
            <FollowUpCell day={prospect.next_follow_up_on} status={prospect.status} today={today} compact />
          </span>
        </div>
        <div className="mt-4">
          <ProspectStatusSelect id={prospect.id} status={prospect.status} />
        </div>
        <div className="mt-4">
          <ProspectActions
            prospect={{
              id: prospect.id,
              name: prospect.company_name,
              status: prospect.status,
              email: prospect.email,
              website: prospect.website_url,
              nextFollowUp: prospect.next_follow_up_on,
              hasPreview: Boolean(prospect.linked_preview_id),
              hasProject: Boolean(prospect.linked_project_id),
            }}
            today={today}
            previews={options.previews.map((p) => ({ id: p.id, label: `${p.client_name} · ${p.subdomain}` }))}
            projects={options.projects.map((p) => ({ id: p.id, label: p.title }))}
          />
        </div>
      </header>

      <nav aria-label="Prospect sections" className="no-scrollbar mb-5 overflow-x-auto border-b border-line">
        <ul className="flex min-w-max gap-1">
          {TABS.map((t) => (
            <li key={t.id}>
              <Link
                href={P.prospectTab(id, t.id)}
                scroll={false}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn("-mb-px inline-block border-b-2 px-3 py-2.5 text-sm transition-colors", tab === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Suspense key={tab} fallback={<SectionSkeleton title={tab} lines={6} />}>
        {tab === "overview" && <OverviewTab prospect={prospect} P={P} today={today} />}
        {tab === "activity" && <ActivityTab prospect={prospect} P={P} />}
        {tab === "email" && <EmailTab prospect={prospect} />}
        {tab === "quotes" && <QuotesTab prospect={prospect} P={P} />}
        {tab === "projects" && <ProjectsTab prospect={prospect} P={P} />}
        {tab === "preview" && <PreviewTab prospect={prospect} P={P} />}
      </Suspense>
    </>
  );
}

/* ------------------------------ overview ------------------------------ */

async function OverviewTab({ prospect, P, today }: { prospect: ProspectRecord; P: AppPaths; today: string }) {
  const [linked, quotes, mail] = await Promise.all([getLinked(prospect), listQuotesForProspect(prospect.id), listProspectMail(prospect.id)]);
  const activeQuote = latestActiveQuote(quotes);
  const activeNet = activeQuote ? activeQuote.subtotalCents - activeQuote.discountCents : null;
  const manualValueCents = prospect.quote_value_eur === null ? null : Math.round(Number(prospect.quote_value_eur) * 100);
  const latest = lastEmail(mail);
  const access = linked.preview ? summarizeAccess(linked.preview) : null;

  const cards: Array<{ label: string; body: React.ReactNode; href?: string }> = [
    {
      label: "Latest active quote",
      href: activeQuote ? P.quote(activeQuote.id) : P.quoteNew(prospect.id),
      body: activeQuote && activeNet !== null ? (
        <>
          <span className="block text-lg font-medium tabular-nums">{formatCents(activeNet, activeQuote.currency, activeQuote.language)}</span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
            {activeQuote.number} <QuoteStatusBadge status={activeQuote.status} validUntil={activeQuote.validUntil} />
          </span>
        </>
      ) : (
        <span className="text-sm text-muted">No active quote. Create one.</span>
      ),
    },
    {
      label: "Estimated value",
      body: <span className="text-lg font-medium tabular-nums">{formatEur(prospect.estimated_value_eur)}</span>,
    },
    {
      label: "Preview",
      href: P.prospectTab(prospect.id, "preview"),
      body: linked.preview ? (
        <span className={cn("text-sm", access?.viewed ? "text-ink" : "text-muted")}>{access?.viewed ? describeAccess(linked.preview) : "Not viewed yet"}</span>
      ) : (
        <span className="text-sm text-muted">No preview linked</span>
      ),
    },
    {
      label: "Latest email",
      href: P.prospectTab(prospect.id, "email"),
      body: latest ? (
        <>
          <span className="block text-sm">{latest.direction === "incoming" ? "Received" : "Sent"} · {formatBrusselsDateTime(latest.sent_at)}</span>
          {latest.subject && <span className="mt-0.5 block truncate text-xs text-muted">{latest.subject}</span>}
        </>
      ) : (
        <span className="text-sm text-muted">{getZohoConfig().enabled ? "No mail yet" : "Email not connected"}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => {
          const inner = (
            <>
              <p className="mb-1.5 text-xs text-muted">{c.label}</p>
              {c.body}
            </>
          );
          return (
            <li key={c.label}>
              {c.href ? (
                <Link href={c.href} className="block h-full rounded-card border border-line bg-surface p-3.5 transition-colors hover:border-line-strong">
                  {inner}
                </Link>
              ) : (
                <div className="h-full rounded-card border border-line bg-surface p-3.5">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Contact">
          <dl className="divide-y divide-line">
            <Row label="Contact person">{prospect.contact_name ?? "—"}</Row>
            <Row label="Email">{prospect.email ? <a className="hover:text-accent" href={`mailto:${prospect.email}`}>{prospect.email}</a> : "—"}</Row>
            <Row label="Phone">{prospect.phone ?? "—"}</Row>
            <Row label="Website">
              {prospect.website_url ? (
                <a className="hover:text-accent" href={prospect.website_url} target="_blank" rel="noopener noreferrer">
                  {prospect.website_url.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Sector · city">{[prospect.sector, prospect.city].filter(Boolean).join(" · ") || "—"}</Row>
          </dl>
        </Panel>
        <Panel title="Contact history">
          <dl className="divide-y divide-line">
            <Row label="First contact">{formatDay(prospect.first_contact_on)}</Row>
            <Row label="Last contact">{formatDay(prospect.last_contact_on)}</Row>
            <Row label="Next follow-up">
              <FollowUpCell day={prospect.next_follow_up_on} status={prospect.status} today={today} />
            </Row>
            <Row label="Quote value (manual)">
              {formatEur(prospect.quote_value_eur)}
              {activeNet !== null && manualValueCents !== null && manualValueCents !== activeNet && <span className="mt-0.5 block text-xs text-subtle">differs from the active quote; not changed automatically</span>}
            </Row>
            <Row label="Source">{prospect.source ?? "—"}</Row>
          </dl>
        </Panel>
      </div>

      <Panel title="Notes">
        <ProspectNotes id={prospect.id} initial={prospect.notes ?? ""} />
      </Panel>
    </div>
  );
}

/* ------------------------------ activity ------------------------------ */

async function ActivityTab({ prospect, P }: { prospect: ProspectRecord; P: AppPaths }) {
  const [activities, mail, quoteEvents, linked] = await Promise.all([listActivities(prospect.id), listProspectMail(prospect.id), listQuoteEventsForProspect(prospect.id), getLinked(prospect)]);
  const previewEvents: PreviewEvent[] = [];
  if (linked.preview?.first_accessed_at) previewEvents.push({ id: "first", at: linked.preview.first_accessed_at, title: "Preview first viewed", detail: null });
  if (linked.preview?.last_accessed_at && linked.preview.last_accessed_at !== linked.preview.first_accessed_at) {
    previewEvents.push({ id: "last", at: linked.preview.last_accessed_at, title: "Preview viewed again", detail: `${linked.preview.successful_access_count} visits in total` });
  }
  const items = mergeTimeline(activities, mail, quoteEvents, previewEvents);
  return (
    <Panel title="Activity" description="Everything that happened with this prospect, newest first.">
      {items.length === 0 ? <EmptyState>No activity yet.</EmptyState> : <Timeline items={items} paths={P} />}
    </Panel>
  );
}

/* ------------------------------ email ------------------------------ */

async function EmailTab({ prospect }: { prospect: ProspectRecord }) {
  const config = getZohoConfig();
  const connection = config.enabled ? await getConnection() : null;
  const mail = await listProspectMail(prospect.id);
  const reply = suggestReply(prospect.status, mail);

  return (
    <Panel title="Email" description="Mail to and from this address, read from Zoho Mail. Read-only: nothing is sent from the CRM.">
      {!config.enabled || !connection ? (
        <p className="text-sm text-muted">Email is not connected. The CRM works the same without it.</p>
      ) : (
        <div className="mb-4">
          <MailSyncButton />
        </div>
      )}
      {reply && (
        <p className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          New reply detected{reply.mail.subject ? `: “${reply.mail.subject}”` : ""}. The status is still {reply.currentLabel}.
          <MarkRepliedButton id={prospect.id} />
        </p>
      )}
      {mail.length === 0 ? (
        connection ? <EmptyState>No mail linked to this prospect yet.</EmptyState> : null
      ) : (
        <ul className="divide-y divide-line" aria-label="Messages">
          {mail.map((m) => (
            <li key={m.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Badge tone={m.direction === "incoming" ? "accent" : "neutral"}>{m.direction === "incoming" ? "Received" : "Sent"}</Badge>
                <time dateTime={m.sent_at} className="text-xs text-subtle">
                  {formatBrusselsDateTime(m.sent_at)}
                </time>
              </div>
              <p className="mt-1 text-sm font-medium">{m.subject ?? "(no subject)"}</p>
              {m.snippet && <p className="mt-0.5 text-sm text-muted">{m.snippet}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------ quotes ------------------------------ */

async function QuotesTab({ prospect, P }: { prospect: ProspectRecord; P: AppPaths }) {
  const quotes = await listQuotesForProspect(prospect.id);
  return (
    <Panel title="Quotes" actions={<OpenLink href={P.quoteNew(prospect.id)}>Create quote</OpenLink>}>
      {quotes.length === 0 ? (
        <EmptyState>No quotes for this prospect yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {quotes.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link href={P.quote(q.id)} className="text-sm font-medium hover:text-accent">
                  {q.number}
                </Link>
                <p className="truncate text-xs text-muted">{q.title ?? "Untitled"}</p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <QuoteStatusBadge status={q.status} validUntil={q.validUntil} />
                <span className="tabular-nums">{formatCents(q.totalCents, q.currency, q.language)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------ projects ------------------------------ */

async function ProjectsTab({ prospect, P }: { prospect: ProspectRecord; P: AppPaths }) {
  const [linked, quotes] = await Promise.all([getLinked(prospect), listQuotesForProspect(prospect.id)]);
  const project = linked.project;
  return (
    <Panel title="Projects" description="The same project records the public portfolio uses. Content is edited in the website admin.">
      {project ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{project.title}</p>
            <Badge tone={project.published ? "success" : "neutral"}>{project.published ? "Published on the website" : "Not published"}</Badge>
          </div>
          <a href={P.website.projectEdit(project.id)} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            Edit content <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </div>
      ) : (
        <EmptyState>No project linked. Accept a quote and use Create project, convert this prospect, or link an existing project from the actions above.</EmptyState>
      )}
      {quotes.some((q) => q.projectId) && (
        <p className="mt-3 text-xs text-subtle">Quotes linked to a project: {quotes.filter((q) => q.projectId).map((q) => q.number).join(", ")}.</p>
      )}
    </Panel>
  );
}

/* ------------------------------ preview ------------------------------ */

async function PreviewTab({ prospect, P }: { prospect: ProspectRecord; P: AppPaths }) {
  const linked = await getLinked(prospect);
  const { baseDomain } = getPreviewConfig();
  const preview = linked.preview;
  if (!preview) return <Panel title="Client preview"><EmptyState>No client preview linked. Link one from the actions above.</EmptyState></Panel>;
  const state = previewState({ active: preview.active, expires_at: preview.expires_at }, new Date());
  const access = summarizeAccess(preview);
  const url = `https://${preview.subdomain}.${baseDomain}`;
  return (
    <Panel title="Client preview" description="What the client sees and whether they have looked. The access code and hosting are managed in the website admin.">
      <dl className="divide-y divide-line">
        <Row label="Address">
          <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
            {preview.subdomain}.{baseDomain}
          </a>
        </Row>
        <Row label="Status">
          <Badge tone={state === "active" ? "success" : state === "expired" ? "danger" : "neutral"}>{state === "active" ? "Active" : state === "expired" ? "Expired" : "Disabled"}</Badge>
        </Row>
        <Row label="Viewed">{access.viewed ? "Yes" : "Not yet"}</Row>
        <Row label="First viewed">{preview.first_accessed_at ? formatDateTime(preview.first_accessed_at) : "—"}</Row>
        <Row label="Last viewed">{preview.last_accessed_at ? formatDateTime(preview.last_accessed_at) : "—"}</Row>
        <Row label="Successful visits">{preview.successful_access_count}</Row>
      </dl>
      <div className="mt-3">
        <a href={P.website.previewEdit(preview.id)} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
          Manage in the website admin <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </div>
    </Panel>
  );
}
