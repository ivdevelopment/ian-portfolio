import type { Metadata } from "next";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getI18n } from "@/i18n/server";
import { pageMetadata } from "@/lib/page-metadata";
import { CtaSection } from "@/components/cta/cta-section";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectGrid } from "@/components/work/project-grid";
import { projectFilters } from "@/lib/project-labels";
import { getPublishedProjects } from "@/lib/projects";

export async function generateMetadata({ params }: PageProps<"/[locale]/work">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = getDictionary(locale);
  return pageMetadata({ locale, title: dict.work.title, description: dict.work.description, path: "/work" });
}

export default async function WorkPage() {
  const { locale, dict } = await getI18n();
  const projects = await getPublishedProjects(locale);

  return (
    <>
      <PageHeader
        eyebrow={dict.work.eyebrow}
        title={dict.work.heading}
        description={dict.work.intro}
      />
      <section aria-labelledby="all-projects" className="container-page pb-(--section-y)">
        <h2 id="all-projects" className="sr-only">
          {dict.work.allProjects}
        </h2>
        {projects.length > 0 ? (
          <ProjectGrid
            projects={projects}
            filters={projectFilters(dict)}
            columnsClassName="md:grid-cols-2"
            sizes="(min-width: 768px) 50vw, 100vw"
          />
        ) : (
          <p className="rounded-card border border-line p-8 text-muted">
            {dict.work.empty}
          </p>
        )}
      </section>
      <CtaSection />
    </>
  );
}
