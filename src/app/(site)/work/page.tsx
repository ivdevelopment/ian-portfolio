import type { Metadata } from "next";
import { CtaSection } from "@/components/cta/cta-section";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectGrid } from "@/components/work/project-grid";
import { getPublishedProjects, projectFilters } from "@/lib/projects";

export const metadata: Metadata = {
  title: "Work",
  description:
    "Selected websites, web applications and redesigns — a look at projects I've designed and built.",
  alternates: { canonical: "/work" },
  openGraph: { url: "/work", title: "Work" },
};

export default function WorkPage() {
  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Projects I've designed and built."
        description="A selection of websites, web applications and redesigns. Open any project for the full story, screenshots and a live preview."
      />
      <section aria-label="All projects" className="container-page pb-(--section-y)">
        <ProjectGrid
          projects={getPublishedProjects()}
          filters={projectFilters}
          columnsClassName="md:grid-cols-2"
          sizes="(min-width: 768px) 50vw, 100vw"
        />
      </section>
      <CtaSection />
    </>
  );
}
