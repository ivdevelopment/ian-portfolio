import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getPublishedProjects, projectFilters } from "@/lib/projects";
import { Reveal } from "@/components/ui/reveal";
import { ProjectGrid } from "./project-grid";

export async function SelectedWork() {
  const projects = await getPublishedProjects();
  if (projects.length === 0) return null;

  return (
    <section aria-labelledby="selected-work-title" className="section-y pt-0">
      <div className="container-page">
        <Reveal className="mb-8 flex items-end justify-between gap-6">
          <h2 id="selected-work-title" className="text-title">
            Selected work
          </h2>
          <Link
            href="/work"
            className="group inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            View all projects
            <ArrowRight
              aria-hidden
              className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
            />
          </Link>
        </Reveal>

        <Reveal delay={0.08}>
          <ProjectGrid
            projects={projects}
            filters={projectFilters}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          />
        </Reveal>
      </div>
    </section>
  );
}
