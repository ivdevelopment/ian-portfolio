import Link from "next/link";
import { Star } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { PROJECT_SELECT, rowToProject, type ProjectRow } from "@/lib/cms/mappers";
import { AdminPageHeader, Badge, EmptyState, formatDate } from "@/components/admin/ui";
import { ProjectRowActions } from "@/components/admin/project-row-actions";
import { ButtonLink } from "@/components/ui/button";

export default async function AdminProjectsPage() {
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[admin] failed to list projects:", error.message);
    throw new Error("Projects unavailable");
  }
  const projects = (data as ProjectRow[]).map((row) => rowToProject(row));

  return (
    <>
      <AdminPageHeader
        title="Projects"
        description="Everything on your public portfolio, including drafts."
        actions={
          <ButtonLink href="/admin/projects/new" size="sm" icon="none">
            New project
          </ButtonLink>
        }
      />

      {projects.length === 0 ? (
        <EmptyState>No projects yet. Create your first project.</EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-glass">
          {projects.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 p-3 xl:flex-nowrap xl:p-4"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnails: small, no optimiser needed */}
              <img
                src={p.thumbnail}
                alt=""
                width={96}
                height={60}
                loading="lazy"
                decoding="async"
                className="h-[3.75rem] w-24 shrink-0 rounded-md border border-line bg-surface object-cover"
              />

              <div className="min-w-40 flex-1 basis-40">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/projects/${p.id}/edit`}
                    className="truncate text-sm font-medium hover:text-accent"
                  >
                    {p.title}
                  </Link>
                  {p.featured && (
                    <Star aria-label="Featured" className="size-3.5 fill-accent text-accent" />
                  )}
                  {p.isExample && <Badge>Sample</Badge>}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {p.category} · /work/{p.slug}
                </p>
              </div>

              <div className="flex items-center gap-4 xl:w-56 xl:justify-between">
                <Badge tone={p.published ? "success" : "neutral"}>
                  {p.published ? "Published" : "Draft"}
                </Badge>
                <span className="text-xs text-subtle">
                  {p.updatedAt ? `Updated ${formatDate(p.updatedAt)}` : ""}
                </span>
              </div>

              <div className="ml-auto">
              <ProjectRowActions
                project={{
                  id: p.id,
                  title: p.title,
                  published: p.published,
                  featured: p.featured,
                }}
              />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
