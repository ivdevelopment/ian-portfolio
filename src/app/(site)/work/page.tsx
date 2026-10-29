import { pageMetadata } from "@/lib/page-metadata";
import { CtaSection } from "@/components/cta/cta-section";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectGrid } from "@/components/work/project-grid";
import { getPublishedProjects, projectFilters } from "@/lib/projects";

export const metadata = pageMetadata({
  title: "Work",
  description:
    "Selected websites, web applications and redesigns — a look at projects I've designed and built.",
  path: "/work",
});

export default async function WorkPage() {
  const projects = await getPublishedProjects();

  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Projects I've designed and built."
        description="A selection of websites, web applications and redesigns. Open any project for the full story, screenshots and a live preview."
      />
      <section aria-labelledby="all-projects" className="container-page pb-(--section-y)">
        <h2 id="all-projects" className="sr-only">
          All projects
        </h2>
        {projects.length > 0 ? (
          <ProjectGrid
            projects={projects}
            filters={projectFilters}
            columnsClassName="md:grid-cols-2"
            sizes="(min-width: 768px) 50vw, 100vw"
          />
        ) : (
          <p className="rounded-card border border-line p-8 text-muted">
            New projects are on their way. Check back soon.
          </p>
        )}
      </section>
      <CtaSection />
    </>
  );
}
