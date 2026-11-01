import Link from "next/link";
import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { AdminPageHeader, Badge, EmptyState } from "@/components/admin/ui";
import { TableSkeleton } from "@/components/ui/loading";
import { getProjects } from "@/crm/queries/dashboard";
import { getPaths } from "@/lib/crm/server-paths";
import { formatDate } from "@/components/admin/ui";

export default function ProjectsPage() {
  return (
    <>
      <AdminPageHeader title="Projects" description="Work for clients. These are the same project records the public portfolio uses; the CRM shows the ones that belong to a client." />
      <Suspense fallback={<TableSkeleton rows={4} filters={false} />}>
        <ProjectList />
      </Suspense>
    </>
  );
}

async function ProjectList() {
  const P = await getPaths();
  const { linked, portfolioOnly } = await getProjects();
  return (
    <>
      {linked.length === 0 ? (
        <EmptyState>No client projects yet. Accept a quote and use Create project, or link a project from a prospect.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-glass">
          {linked.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {p.client && (
                    <Link href={P.prospect(p.client.id)} className="hover:text-ink">
                      {p.client.company}
                    </Link>
                  )}
                  {p.quoteNumbers.map((n) => (
                    <span key={n}>{n}</span>
                  ))}
                  <span>Edited {formatDate(p.updatedAt)}</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={p.published ? "success" : "neutral"}>{p.published ? "Published on the website" : "Not published"}</Badge>
                <a href={P.website.projectEdit(p.id)} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  Edit content <ExternalLink aria-hidden className="size-3" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      {portfolioOnly > 0 && (
        <p className="mt-3 text-xs text-subtle">
          {portfolioOnly} more {portfolioOnly === 1 ? "project is" : "projects are"} portfolio content only (no client attached). They are managed in the{" "}
          <a href={P.website.home} className="underline underline-offset-4 hover:text-ink">
            website admin
          </a>
          .
        </p>
      )}
    </>
  );
}
