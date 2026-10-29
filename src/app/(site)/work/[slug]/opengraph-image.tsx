import { renderOgCard, OG_SIZE } from "@/lib/og-image";
import { projectBadges } from "@/lib/project-labels";
import { getProjectBySlug, getPublishedProjects, projectKindLabels } from "@/lib/projects";
import { getSiteSettings } from "@/lib/site-content";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Project preview";

export async function generateStaticParams() {
  const projects = await getPublishedProjects();
  return projects.length > 0 ? projects.map((p) => ({ slug: p.slug })) : [{ slug: "_" }];
}

/**
 * Branded share card used when a project has no raster thumbnail (the page's
 * metadata prefers the project's own PNG/JPG/WebP image). Drafts and unknown
 * slugs get the generic card — nothing about them is revealed.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [project, settings] = await Promise.all([getProjectBySlug(slug), getSiteSettings()]);

  if (!project) {
    return renderOgCard({
      eyebrow: "Portfolio",
      title: settings.displayName,
      brand: settings.displayName,
    });
  }

  const label = [projectKindLabels[project.kind], ...projectBadges(project)];
  return renderOgCard({
    eyebrow: [...new Set(label)].join(" · "),
    title: project.title,
    subtitle: project.category,
    brand: settings.displayName,
    footer: project.year ? String(project.year) : undefined,
  });
}
