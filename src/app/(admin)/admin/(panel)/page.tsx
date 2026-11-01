import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { AdminPageHeader, Badge, EmptyState, Panel, formatDate } from "@/components/admin/ui";
import { InquiryStatusBadge } from "@/components/admin/inquiry-status";
import { ButtonLink } from "@/components/ui/button";
import { SectionSkeleton } from "@/components/ui/loading";
import { crmOrigin } from "@/lib/crm/host";

export default async function AdminDashboardPage() {
  const { supabase } = await requireAdmin();

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
        description="Your website: portfolio, reviews, inquiries and media."
        actions={
          <>
            <ButtonLink href={crmOrigin()} external variant="secondary" size="sm">
              Open CRM
            </ButtonLink>
            <ButtonLink href="/admin/projects/new" size="sm" icon="none">
              New project
            </ButtonLink>
          </>
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

      {/* The business side (prospects, pipeline, quotes, email) lives in the CRM. */}
      <Panel className="mt-6" title="CRM" description="Prospects, follow-ups, pipeline, quotes and email are in the CRM workspace.">
        <a href={crmOrigin()} className="inline-flex items-center gap-2 text-sm text-accent underline-offset-4 hover:underline">
          Open CRM <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </Panel>

      <Suspense fallback={<SectionSkeleton title="client previews" lines={2} />}>
        <PreviewsPanel />
      </Suspense>

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

/** Client preview hosting is website infrastructure: how many are live, and the way into them. */
async function PreviewsPanel() {
  const { supabase } = await requireAdmin();
  const [all, active] = await Promise.all([
    supabase.from("client_previews").select("id", { count: "exact", head: true }),
    supabase.from("client_previews").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  return (
    <Panel
      className="mt-4"
      title="Client previews"
      actions={
        <Link href="/admin/previews" className="text-xs text-muted hover:text-ink">
          Manage
        </Link>
      }
    >
      <p className="text-sm text-muted">
        <span className="text-lg font-medium text-ink tabular-nums">{active.count ?? 0}</span> active of {all.count ?? 0} client {all.count === 1 ? "preview" : "previews"}.
      </p>
    </Panel>
  );
}
