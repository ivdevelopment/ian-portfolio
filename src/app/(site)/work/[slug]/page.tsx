import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectDetail } from "@/components/work/project-detail";
import {
  getProjectBySlug,
  getPublishedProjects,
  getRelatedProjects,
} from "@/lib/projects";
import { getReviewsForProject } from "@/lib/reviews";

/**
 * `params` is awaited at the top level on purpose (no <Suspense> around it):
 * a slug that doesn't exist — or belongs to a draft — must produce a real
 * HTTP 404 rather than a 200 streamed shell. Listed slugs are prerendered;
 * new ones render on first request and are cached until the CMS invalidates them.
 */
export async function generateStaticParams() {
  const projects = await getPublishedProjects();
  // Cache Components requires at least one param; "_" simply resolves to a 404.
  return projects.length > 0 ? projects.map((p) => ({ slug: p.slug })) : [{ slug: "_" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/work/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project) return { title: "Project not found", robots: { index: false } };

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

export default async function ProjectPage({ params }: PageProps<"/work/[slug]">) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project) notFound();

  const [related, reviews] = await Promise.all([
    getRelatedProjects(project.slug),
    getReviewsForProject(project.id),
  ]);
  return <ProjectDetail project={project} related={related} reviews={reviews} />;
}
