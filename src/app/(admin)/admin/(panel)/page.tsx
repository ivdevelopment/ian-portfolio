import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { AdminPageHeader, Badge, EmptyState, Panel, formatDate } from "@/components/admin/ui";
import { InquiryStatusBadge } from "@/components/admin/inquiry-status";
import { ButtonLink } from "@/components/ui/button";
import { FollowUpCell, ProspectStatusBadge } from "@/components/admin/prospect-ui";
import { brusselsToday } from "@/lib/prospects/dates";
import { formatEur } from "@/lib/prospects/money";
import { getSummary, listFollowUpQueue } from "@/lib/prospects/queries";
import { formatCents } from "@/lib/quotes/money";
import { getQuoteMetrics } from "@/lib/quotes/queries";

export default async function AdminDashboardPage() {
  const { supabase } = await requireAdmin();
  const today = brusselsToday();
  const [crm, queue, quotes] = await Promise.all([getSummary(today), listFollowUpQueue(4, today), getQuoteMetrics(today)]);

  const [total, published, newInquiries, recentProjects, recentInquiries, pendingReviews, publishedReviews, recentReviews] =
    await Promise.all([
    supabase.from("projects").select("id", { count: "exact", head: true }),
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("published", true),
    supabase.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
    supabase
      .from("projects")
      .select("id, title, slug, published, updated_at")
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("inquiries")
      .select("id, name, project_type, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("reviews").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("reviews").select("id", { count: "exact", head: true }).eq("status", "approved"),
    supabase
      .from("reviews")
      .select("id, name, rating, status, created_at")
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const failed = [
    total,
    published,
    newInquiries,
    recentProjects,
    recentInquiries,
    pendingReviews,
    publishedReviews,
    recentReviews,
  ].find(
    (r) => r.error,
  );
  if (failed?.error) {
    console.error("[admin] dashboard query failed:", failed.error.message);
    throw new Error("Dashboard data unavailable");
  }

  const totalCount = total.count ?? 0;
  const publishedCount = published.count ?? 0;
  const stats = [
    { label: "Total projects", value: totalCount },
    { label: "Published", value: publishedCount },
    { label: "Drafts", value: totalCount - publishedCount },
    { label: "New inquiries", value: newInquiries.count ?? 0 },
    { label: "Pending reviews", value: pendingReviews.count ?? 0 },
    { label: "Published reviews", value: publishedReviews.count ?? 0 },
  ];

  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="A quick look at your portfolio."
        actions={
          <ButtonLink href="/admin/projects/new" size="sm" icon="none">
            New project
          </ButtonLink>
        }
      />

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col-reverse rounded-card border border-line bg-glass p-4">
            <dt className="mt-0.5 text-xs text-muted">{s.label}</dt>
            <dd className="text-2xl font-medium tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      <Panel
        className="mt-6"
        title="Sales follow-ups"
        actions={
          <span className="flex gap-3 text-xs">
            <Link href="/admin/prospects/kanban" className="text-muted hover:text-ink">
              Open pipeline
            </Link>
            <Link href="/admin/prospects?view=list" className="text-muted hover:text-ink">
              View prospects
            </Link>
          </span>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <Link href="/admin/prospects?followup=overdue" className="rounded-md border border-line p-2.5 hover:border-line-strong">
                <dd className={"text-lg font-medium tabular-nums " + (crm.followups_overdue > 0 ? "text-danger" : "")}>{crm.followups_overdue}</dd>
                <dt className="text-xs text-muted">Overdue</dt>
              </Link>
              <Link href="/admin/prospects?followup=today" className="rounded-md border border-line p-2.5 hover:border-line-strong">
                <dd className="text-lg font-medium tabular-nums">{crm.followups_today}</dd>
                <dt className="text-xs text-muted">Today</dt>
              </Link>
              <Link href="/admin/prospects?followup=week" className="rounded-md border border-line p-2.5 hover:border-line-strong">
                <dd className="text-lg font-medium tabular-nums">{crm.followups_week}</dd>
                <dt className="text-xs text-muted">Later this week</dt>
              </Link>
            </dl>
            <p className="mt-3 text-xs text-muted">
              {crm.total} prospects · {crm.replies} {crm.replies === 1 ? "reply" : "replies"}
              {crm.pipeline_count > 0 ? ` · pipeline ${formatEur(crm.pipeline_value)}` : ""}
            </p>
          </div>
          {queue.length === 0 ? (
            <EmptyState>No follow-ups coming up.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {queue.map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link href={`/admin/prospects/${q.id}`} className="block truncate text-sm font-medium hover:text-accent">
                      {q.company_name}
                    </Link>
                    <ProspectStatusBadge status={q.status} />
                  </div>
                  <FollowUpCell day={q.next_follow_up_on} status={q.status} today={today} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel
        className="mt-4"
        title="Quotes"
        actions={
          <span className="flex gap-3 text-xs">
            <Link href="/admin/quotes/new" className="text-muted hover:text-ink">
              New quote
            </Link>
            <Link href="/admin/quotes" className="text-muted hover:text-ink">
              View quotes
            </Link>
          </span>
        }
      >
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <Link href="/admin/quotes?status=draft" className="rounded-md border border-line p-2.5 hover:border-line-strong">
            <dd className="text-lg font-medium tabular-nums">{quotes.draft.count + quotes.ready.count}</dd>
            <dt className="text-xs text-muted">Draft{quotes.ready.count > 0 ? ` (${quotes.ready.count} ready)` : ""}</dt>
          </Link>
          <Link href="/admin/quotes?status=sent" className="rounded-md border border-line p-2.5 hover:border-line-strong">
            <dd className="text-lg font-medium tabular-nums">{quotes.sent.count}</dd>
            <dt className="text-xs text-muted">Sent{quotes.expired.count > 0 ? ` (${quotes.expired.count} expired)` : ""}</dt>
          </Link>
          <Link href="/admin/quotes?status=accepted" className="rounded-md border border-line p-2.5 hover:border-line-strong">
            <dd className="text-lg font-medium tabular-nums">{quotes.accepted.count}</dd>
            <dt className="text-xs text-muted">Accepted{quotes.accepted.count > 0 ? ` · ${formatCents(quotes.accepted.netCents)}` : ""}</dt>
          </Link>
          <div className="rounded-md border border-line p-2.5">
            <dd className="text-lg font-medium tabular-nums">{quotes.open.count > 0 ? formatCents(quotes.open.netCents) : "—"}</dd>
            <dt className="text-xs text-muted">Open quoted value, excl. VAT</dt>
          </div>
        </dl>
      </Panel>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Recent projects"
          actions={
            <Link href="/admin/projects" className="text-xs text-muted hover:text-ink">
              View all
            </Link>
          }
        >
          {(recentProjects.data ?? []).length === 0 ? (
            <EmptyState>No projects yet. Create your first project.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {recentProjects.data!.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/projects/${p.id}/edit`}
                      className="block truncate text-sm font-medium hover:text-accent"
                    >
                      {p.title}
                    </Link>
                    <p className="text-xs text-subtle">Edited {formatDate(p.updated_at)}</p>
                  </div>
                  <Badge tone={p.published ? "success" : "neutral"}>
                    {p.published ? "Published" : "Draft"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent inquiries"
          actions={
            <Link href="/admin/inquiries" className="text-xs text-muted hover:text-ink">
              View all
            </Link>
          }
        >
          {(recentInquiries.data ?? []).length === 0 ? (
            <EmptyState>No inquiries yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {recentInquiries.data!.map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/inquiries/${q.id}`}
                      className="block truncate text-sm font-medium hover:text-accent"
                    >
                      {q.name}
                    </Link>
                    <p className="text-xs text-subtle">
                      {q.project_type} · {formatDate(q.created_at)}
                    </p>
                  </div>
                  <InquiryStatusBadge status={q.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        className="mt-4"
        title="Latest reviews"
        actions={
          <Link href="/admin/reviews" className="text-xs text-muted hover:text-ink">
            View all
          </Link>
        }
      >
        {(recentReviews.data ?? []).length === 0 ? (
          <EmptyState>No reviews yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {recentReviews.data!.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link href={`/admin/reviews/${r.id}/edit`} className="block truncate text-sm font-medium hover:text-accent">
                    {r.name}
                  </Link>
                  <p className="text-xs text-subtle">
                    {r.rating}/5 · {formatDate(r.created_at)}
                  </p>
                </div>
                <Badge tone={r.status === "approved" ? "success" : r.status === "pending" ? "accent" : "neutral"}>
                  {r.status === "approved" ? "Published" : r.status[0].toUpperCase() + r.status.slice(1)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
