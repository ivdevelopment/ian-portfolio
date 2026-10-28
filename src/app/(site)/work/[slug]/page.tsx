import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { CtaSection } from "@/components/cta/cta-section";
import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { ProjectCard } from "@/components/work/project-card";
import { ProjectOverview } from "@/components/work/project-overview";
import { ProjectPreview } from "@/components/work/project-preview";
import {
  getProjectBySlug,
  getPublishedProjects,
  getRelatedProjects,
  projectKindLabels,
} from "@/lib/projects";

export function generateStaticParams() {
  return getPublishedProjects().map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/work/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!project) return {};

  return {
    title: project.title,
    description: project.shortDescription,
    alternates: { canonical: `/work/${project.slug}` },
    openGraph: {
      type: "article",
      url: `/work/${project.slug}`,
      title: project.title,
      description: project.shortDescription,
      // TODO: add a raster (PNG/JPG) share image per project — SVG isn't supported by most platforms.
    },
  };
}

export default function ProjectPage({ params }: PageProps<"/work/[slug]">) {
  return (
    <Suspense fallback={<div className="page-top min-h-dvh" aria-hidden />}>
      <ProjectContent params={params} />
    </Suspense>
  );
}

async function ProjectContent({ params }: Pick<PageProps<"/work/[slug]">, "params">) {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!project) notFound();

  const related = getRelatedProjects(project.slug);
  const isExternalPreview = project.previewMode === "external" && project.liveUrl;

  return (
    <>
      <article className="container-page page-top">
        <Reveal y={8}>
          <Link
            href="/work"
            className="group inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft
              aria-hidden
              className="size-4 transition-transform duration-300 group-hover:-translate-x-0.5"
            />
            Back to projects
          </Link>
        </Reveal>

        <div className="mt-8 grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Reveal delay={0.05} className="lg:pt-6">
            <h1 className="text-display text-balance">{project.title}</h1>
            <p className="mt-4 text-sm text-muted">
              {[projectKindLabels[project.kind], ...project.tags].join(" · ")}
              {project.year ? ` · ${project.year}` : ""}
            </p>
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
