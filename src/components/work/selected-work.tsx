import { ArrowRight } from "lucide-react";
import { getI18n } from "@/i18n/server";
import { LocaleLink } from "@/i18n/locale-link";
import { projectFilters } from "@/lib/project-labels";
import { getPublishedProjects } from "@/lib/projects";
import { Reveal } from "@/components/ui/reveal";
import { ProjectGrid } from "./project-grid";

export async function SelectedWork() {
  const { locale, dict } = await getI18n();
  const projects = await getPublishedProjects(locale);
  if (projects.length === 0) return null;

  return (
    <section aria-labelledby="selected-work-title" className="section-y pt-0">
      <div className="container-page">
        <Reveal className="mb-8 flex items-end justify-between gap-6">
          <h2 id="selected-work-title" className="text-title">
            {dict.work.selectedWork}
          </h2>
          <LocaleLink
            href="/work"
            className="group inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            {dict.work.viewAll}
            <ArrowRight
              aria-hidden
              className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
            />
          </LocaleLink>
        </Reveal>

        <Reveal delay={0.08}>
          <ProjectGrid
            projects={projects}
            filters={projectFilters(dict)}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          />
        </Reveal>
      </div>
    </section>
  );
}
