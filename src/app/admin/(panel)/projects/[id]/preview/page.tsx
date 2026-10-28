import Link from "next/link";
import { notFound } from "next/navigation";
import { loadProjectForAdmin } from "@/lib/cms/admin-queries";
import { rowToProject } from "@/lib/cms/mappers";
import { getRelatedProjects } from "@/lib/projects";
import { getReviewsForProject } from "@/lib/reviews";
import { ProjectDetail } from "@/components/work/project-detail";

/** Renders the project exactly as the public page would — including drafts. Admin only. */
export default async function PreviewProjectPage({
  params,
}: PageProps<"/admin/projects/[id]/preview">) {
  const { id } = await params;
  const row = await loadProjectForAdmin(id);
  if (!row) notFound();

  const project = rowToProject(row);
  const [related, reviews] = await Promise.all([
    getRelatedProjects(project.slug),
    getReviewsForProject(project.id),
  ]);

  return (
    <div className="-mx-4 -my-6 sm:-mx-8 md:-my-8">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-elevated px-4 py-2 text-sm">
        <p>
          <strong className="font-medium">Preview</strong>
          <span className="text-muted">
            {" "}
            — {project.published ? "published" : "draft, not visible to the public"}
          </span>
        </p>
        <Link href={`/admin/projects/${project.id}/edit`} className="text-accent hover:underline">
          Back to editor
        </Link>
      </div>
      <ProjectDetail
        project={project}
        related={related}
        reviews={reviews}
        backHref={`/admin/projects/${project.id}/edit`}
        backLabel="Back to editor"
      />
    </div>
  );
}
