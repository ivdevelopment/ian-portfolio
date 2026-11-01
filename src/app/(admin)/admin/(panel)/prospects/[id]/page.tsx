import Link from "next/link";
import { notFound } from "next/navigation";
import { OpenLink, ProspectActions } from "@/components/admin/prospect-detail-actions";
import { ProspectNotes } from "@/components/admin/prospect-notes";
import { DeliveryBadge, FollowUpCell, PriorityBadge, ProspectStatusBadge } from "@/components/admin/prospect-ui";
import { Badge, EmptyState, Panel, formatDate } from "@/components/admin/ui";
import { describeAccess, summarizeAccess } from "@/lib/preview/access-activity";
import { previewState } from "@/lib/preview/expiry";
import { getPreviewConfig } from "@/lib/preview/config";
import { MarkRepliedButton } from "@/components/admin/prospect-mail";
import { listProspectMail } from "@/lib/mail/zoho/service";
import { lastEmail, mergeTimeline, suggestReply } from "@/lib/mail/timeline";
import { formatBrusselsDateTime } from "@/lib/preview/access-activity";
import { activityHeading } from "@/lib/prospects/events";
import { brusselsToday, formatDay } from "@/lib/prospects/dates";
import { formatEur } from "@/lib/prospects/money";
import { getLinked, getProspect, listActivities, listLinkableOptions } from "@/lib/prospects/queries";
import { idSchema } from "@/lib/schemas/prospect";
import { QuoteStatusBadge } from "@/components/admin/quote-ui";
import { latestActiveQuote } from "@/lib/quotes/metrics";
import { listQuoteEventsForProspect, listQuotesForProspect } from "@/lib/quotes/queries";
import { formatCents } from "@/lib/quotes/money";

const QUOTE_EVENT_LABELS: Record<string, string> = { created: "Quote created", sent: "Quote sent", accepted: "Quote accepted", rejected: "Quote rejected", cancelled: "Quote cancelled" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

export default async function ProspectDetailPage({ params }: PageProps<"/admin/prospects/[id]">) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();

  const prospect = await getProspect(id);
  if (!prospect) notFound();

  // The timeline and the link options are separate queries: the list page never loads them.
  const [activities, linked, options, mail, quotes, quoteEvents] = await Promise.all([
    listActivities(id),
    getLinked(prospect),
    listLinkableOptions(),
    listProspectMail(id),
    listQuotesForProspect(id),
    listQuoteEventsForProspect(id),
  ]);
  const timeline = mergeTimeline(activities, mail, quoteEvents);
  const activeQuote = latestActiveQuote(quotes);
  // The list query carries the stored header figures (no lines): net = subtotal - quote-level discount.
  const activeNet = activeQuote ? activeQuote.subtotalCents - activeQuote.discountCents : null;
  const manualValueCents = prospect.quote_value_eur === null ? null : Math.round(Number(prospect.quote_value_eur) * 100);
  const reply = suggestReply(prospect.status, mail);
  const latestMail = lastEmail(mail);
  const today = brusselsToday();
  const { baseDomain } = getPreviewConfig();

  const previewUrl = linked.preview ? `https://${linked.preview.subdomain}.${baseDomain}` : null;
  const previewBadge = linked.preview
    ? previewState({ active: linked.preview.active, expires_at: linked.preview.expires_at }, new Date())
    : null;

  return (
    <>
      <div className="mb-1 text-xs text-subtle">
        <Link href="/admin/prospects" className="hover:text-ink">
          Prospects
        </Link>{" "}
        / {prospect.company_name}
      </div>
      <header className="mb-6">
        <h1 className="text-2xl font-medium tracking-tight">{prospect.company_name}</h1>
        <p className="mt-1 text-sm text-muted">{[prospect.sector, prospect.city].filter(Boolean).join(" · ") || "No sector or city yet"}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Status</span>
          <ProspectStatusBadge status={prospect.status} />
          <span className="ml-2 text-xs text-muted">Priority</span>
          <PriorityBadge priority={prospect.priority} />
          <DeliveryBadge status={prospect.contact_delivery_status} />
        </div>
        <div className="mt-5">
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

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Contact">
          <dl className="divide-y divide-line">
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
            <Row label="Contact person">{prospect.contact_name ?? "—"}</Row>
            <Row label="City">{prospect.city ?? "—"}</Row>
          </dl>
        </Panel>

        <Panel title="Sales">
          <dl className="divide-y divide-line">
            <Row label="Status">
              <ProspectStatusBadge status={prospect.status} />
            </Row>
            <Row label="Priority">
              <PriorityBadge priority={prospect.priority} />
            </Row>
            <Row label="Estimated value">{formatEur(prospect.estimated_value_eur)}</Row>
            <Row label="Quote value">{formatEur(prospect.quote_value_eur)}</Row>
            <Row label="Source">{prospect.source ?? "—"}</Row>
          </dl>
        </Panel>

        <Panel title="Follow-up">
          <dl className="divide-y divide-line">
            <Row label="First contact">{formatDay(prospect.first_contact_on)}</Row>
            <Row label="Last contact">{formatDay(prospect.last_contact_on)}</Row>
            <Row label="Next follow-up">
              <FollowUpCell day={prospect.next_follow_up_on} status={prospect.status} today={today} />
            </Row>
          </dl>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Related" description="Links never change the preview or project themselves.">
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs text-muted">Client Preview</p>
              {linked.preview && previewUrl ? (
                <div className="mt-1">
                  <p className="font-medium">{linked.preview.subdomain}.{baseDomain}</p>
                  <p className={"mt-1 text-xs " + (summarizeAccess(linked.preview).viewed ? "text-ink" : "text-subtle")}>{describeAccess(linked.preview)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone={previewBadge === "active" ? "success" : previewBadge === "expired" ? "danger" : "neutral"}>
                      {previewBadge === "active" ? "Active" : previewBadge === "expired" ? "Expired" : "Disabled"}
                    </Badge>
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
                      Open preview
                    </a>
                    <OpenLink href={`/admin/previews/${linked.preview.id}/edit`}>Manage</OpenLink>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-subtle">No preview linked.</p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted">Quotes</p>
              {quotes.length === 0 ? (
                <p className="mt-1 text-subtle">No quotes yet.</p>
              ) : (
                <ul className="mt-1 space-y-1.5">
                  {quotes.slice(0, 5).map((q) => (
                    <li key={q.id} className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/quotes/${q.id}`} className="font-medium hover:text-accent">
                        {q.number}
                      </Link>
                      <QuoteStatusBadge status={q.status} validUntil={q.validUntil} />
                      <span className="text-xs text-muted tabular-nums">{formatCents(q.totalCents, q.currency, q.language)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {activeQuote && activeNet !== null && (
                <p className="mt-2 text-xs text-muted">
                  Latest active quote: {formatCents(activeNet, activeQuote.currency, activeQuote.language)} excl. VAT.
                  {manualValueCents !== null && manualValueCents !== activeNet && (
                    <> The quote value above ({formatCents(manualValueCents, activeQuote.currency, activeQuote.language)}) is entered by hand and is not changed automatically.</>
                  )}
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <OpenLink href={`/admin/quotes/new?prospect=${prospect.id}`}>Create quote</OpenLink>
                {quotes.length > 0 && <OpenLink href={`/admin/quotes?prospect=${prospect.id}`}>All quotes</OpenLink>}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted">Project</p>
              {linked.project ? (
                <div className="mt-1">
                  <p className="font-medium">{linked.project.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge tone={linked.project.published ? "success" : "neutral"}>{linked.project.published ? "Published" : "Draft"}</Badge>
                    <OpenLink href={`/admin/projects/${linked.project.id}/edit`}>Open project</OpenLink>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-subtle">No project linked.</p>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Notes" className="lg:col-span-2">
          <ProspectNotes id={prospect.id} initial={prospect.notes ?? ""} />
        </Panel>
      </div>

      {/* Only exists once Zoho Mail is enabled and has linked mail to this prospect. */}
      {mail.length > 0 && (
        <Panel title="Email" description="Mail to and from this address, read from Zoho Mail." className="mt-4">
          {reply && (
            <p className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              New reply detected{reply.mail.subject ? `: “${reply.mail.subject}”` : ""}. The status is still {reply.currentLabel}.
              <MarkRepliedButton id={prospect.id} />
            </p>
          )}
          {latestMail && (
            <p className="text-sm text-muted">
              Last email: {formatBrusselsDateTime(latestMail.sent_at)} · {latestMail.direction === "incoming" ? "received" : "sent"}
              {latestMail.subject ? ` · ${latestMail.subject}` : ""}
            </p>
          )}
        </Panel>
      )}

      <Panel title="Activity" description="Newest first." className="mt-4">
        {timeline.length === 0 ? (
          <EmptyState>No activity yet.</EmptyState>
        ) : (
          <ol className="relative space-y-5 border-l border-line pl-5">
            {timeline.map((item) => {
              if (item.kind === "email") {
                const m = item.mail;
                return (
                  <li key={item.key} className="relative">
                    <span aria-hidden className="absolute -left-[1.62rem] top-1.5 size-2 rounded-full bg-sky-400" />
                    <p className="text-xs text-subtle">{formatBrusselsDateTime(m.sent_at)}</p>
                    <p className="text-sm font-medium">{m.direction === "incoming" ? "Email received" : "Email sent"}</p>
                    {m.subject && <p className="text-sm">{m.subject}</p>}
                    {/* Plain text only, rendered as text: mail HTML is never stored or displayed. */}
                    {m.snippet && <p className="mt-0.5 text-sm text-muted">{m.snippet}</p>}
                  </li>
                );
              }
              if (item.kind === "quote") {
                const e = item.quote;
                return (
                  <li key={item.key} className="relative">
                    <span aria-hidden className="absolute -left-[1.62rem] top-1.5 size-2 rounded-full bg-violet-400" />
                    <p className="text-xs text-subtle">{formatDay(item.day)}</p>
                    <p className="text-sm font-medium">
                      {QUOTE_EVENT_LABELS[e.type] ?? "Quote updated"}{" "}
                      <Link href={`/admin/quotes/${e.quoteId}`} className="text-accent hover:underline">
                        {e.quoteNumber}
                      </Link>
                    </p>
                  </li>
                );
              }
              const a = item.activity;
              const heading = activityHeading(a);
              return (
                <li key={item.key} className="relative">
                  <span aria-hidden className="absolute -left-[1.62rem] top-1.5 size-2 rounded-full bg-accent" />
                  <p className="text-xs text-subtle" title={a.occurred_at ? formatDate(a.occurred_at) : undefined}>
                    {formatDay(a.occurred_on)}
                  </p>
                  <p className="text-sm font-medium">{heading.title}</p>
                  {heading.detail && <p className="text-xs text-muted">{heading.detail}</p>}
                  {a.description && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{a.description}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </>
  );
}
