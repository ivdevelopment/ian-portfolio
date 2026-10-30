import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { renderOgCard } from "@/lib/og-image";
import { projectBadges } from "@/lib/project-labels";
import { getProjectBySlug } from "@/lib/projects";
import { getSiteSettings } from "@/lib/site-content";

const DISCIPLINE = { nl: "Webdesign & ontwikkeling", en: "Web Design & Development" } as const;

/**
 * Branded share card used when a project has no raster thumbnail (the page's
 * metadata prefers the project's own PNG/JPG/WebP image). Drafts and unknown
 * slugs get the generic card — nothing about them is revealed.
 */
export async function GET(_request: Request, { params }: RouteContext<"/og/[locale]/work/[slug]">) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return new Response("Not found", { status: 404 });
  const dict = getDictionary(locale);
  const [project, settings] = await Promise.all([getProjectBySlug(slug, locale), getSiteSettings(locale)]);

  if (!project) {
    return renderOgCard({
      eyebrow: "Portfolio",
      title: settings.displayName,
      brand: settings.displayName,
      discipline: DISCIPLINE[locale],
    });
  }

  const label = [dict.project.kinds[project.kind], ...projectBadges(project, dict)];
  return renderOgCard({
    eyebrow: [...new Set(label)].join(" · "),
    title: project.title,
    subtitle: project.category,
    brand: settings.displayName,
    footer: project.year ? String(project.year) : undefined,
    discipline: DISCIPLINE[locale],
  });
}
