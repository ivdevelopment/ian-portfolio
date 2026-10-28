import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { AdminPageHeader, Badge, EmptyState, Panel, formatDate } from "@/components/admin/ui";
import { InquiryStatusBadge } from "@/components/admin/inquiry-status";
import { ButtonLink } from "@/components/ui/button";

export default async function AdminDashboardPage() {
  const { supabase } = await requireAdmin();

  const [total, published, newInquiries, recentProjects, recentInquiries] = await Promise.all([
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
  ]);

  const failed = [total, published, newInquiries, recentProjects, recentInquiries].find(
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

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col-reverse rounded-card border border-line bg-glass p-4">
            <dt className="mt-0.5 text-xs text-muted">{s.label}</dt>
            <dd className="text-2xl font-medium tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

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
    </>
  );
}
