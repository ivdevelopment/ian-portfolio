import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CtaSection } from "@/components/cta/cta-section";
import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { projectDisclosure } from "@/lib/project-labels";
import { projectKindLabels } from "@/lib/projects";
import type { Project } from "@/types/project";
import { ReviewCard } from "@/components/reviews/review-card";
import type { PublicReview } from "@/types/review";
import { ProjectCard } from "./project-card";
import { ProjectOverview } from "./project-overview";
import { ProjectPreview } from "./project-preview";

type ProjectDetailProps = {
  project: Project;
  related: Project[];
  /** Approved reviews linked to this project. */
  reviews?: PublicReview[];
  /** Where the back link goes (the admin preview points back to the editor). */
  backHref?: string;
  backLabel?: string;
};

/** Full case-study page body. Shared by the public route and the admin preview. */
export function ProjectDetail({
  project,
  related,
  reviews = [],
  backHref = "/work",
  backLabel = "Back to projects",
}: ProjectDetailProps) {
  const isExternalPreview = project.previewMode === "external" && project.liveUrl;
  const disclosure = projectDisclosure(project);

  return (
    <>
      <article className="container-page page-top">
        <Reveal y={8}>
          <Link
            href={backHref}
            className="group inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft
              aria-hidden
              className="size-4 transition-transform duration-300 group-hover:-translate-x-0.5"
            />
            {backLabel}
          </Link>
        </Reveal>

        <div className="mt-8 grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Reveal delay={0.05} className="lg:pt-6">
            <h1 className="text-display text-balance">{project.title}</h1>
            <p className="mt-4 text-sm text-muted">
              {[projectKindLabels[project.kind], ...project.tags].join(" · ")}
              {project.year ? ` · ${project.year}` : ""}
            </p>
            {disclosure && (
              <p
                role="note"
                className="mt-4 rounded-md border border-line bg-glass px-4 py-3 text-sm text-muted"
              >
                {disclosure}
              </p>
            )}
            <p className="mt-6 text-lg text-muted">{project.shortDescription}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              {isExternalPreview ? (
                <ButtonLink href={project.liveUrl!} external>
                  Live preview
                </ButtonLink>
              ) : (
                <ButtonLink href="#live-preview">Live preview</ButtonLink>
              )}
              {project.liveUrl && !isExternalPreview && (
                <ButtonLink href={project.liveUrl} external variant="secondary">
                  Visit website
                </ButtonLink>
              )}
              {project.githubUrl && (
                <ButtonLink href={project.githubUrl} external variant="secondary">
                  Source
                </ButtonLink>
              )}
            </div>
          </Reveal>

          <Reveal delay={0.12}>
            <ProjectPreview project={project} />
          </Reveal>
        </div>
      </article>

      <ProjectOverview project={project} />

      {reviews.length > 0 && (
        <section aria-labelledby="client-feedback" className="container-page pb-(--section-y)">
          <h2 id="client-feedback" className="text-title mb-8">
            Client feedback
          </h2>
          <ul className="theme-light grid gap-4 rounded-panel p-4 sm:p-6 md:grid-cols-2">
            {reviews.slice(0, 2).map((review) => (
              <li key={review.id}>
                <ReviewCard review={review} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section aria-labelledby="more-projects" className="container-page pb-(--section-y)">
          <h2 id="more-projects" className="text-title mb-8">
            More projects
          </h2>
          <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((p) => (
              <Reveal as="li" key={p.id}>
                <ProjectCard
                  project={p}
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                />
              </Reveal>
            ))}
          </ul>
        </section>
      )}

      <CtaSection />
    </>
  );
}
