import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectDetail } from "@/components/work/project-detail";
import { isLocale, ogLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { localizeHref } from "@/i18n/paths";
import { getLocale } from "@/i18n/server";
import { localeAlternates, ogImageFor } from "@/lib/page-metadata";
import { getProjectBySlug, getPublishedProjects, getRelatedProjects } from "@/lib/projects";
import { getReviewsForProject } from "@/lib/reviews";
import { isShareableRaster } from "@/lib/og-image-url";

/**
 * `params` is awaited at the top level on purpose (no <Suspense> around it):
 * a slug that doesn't exist — or belongs to a draft — must produce a real
 * HTTP 404 rather than a 200 streamed shell. Listed slugs are prerendered;
 * new ones render on first request and are cached until the CMS invalidates them.
 *
 * Slugs are shared between languages. A project without a Dutch translation
 * still renders in Dutch (its English text is used for missing fields) rather
 * than returning a 404.
 */
export async function generateStaticParams() {
  const projects = await getPublishedProjects("nl");
  // Cache Components requires at least one param; "_" simply resolves to a 404.
  return projects.length > 0 ? projects.map((p) => ({ slug: p.slug })) : [{ slug: "_" }];
}

export async function generateMetadata({ params }: PageProps<"/[locale]/work/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const project = await getProjectBySlug(slug, locale);
  if (!project) return { title: getDictionary(locale).project.notFound, robots: { index: false } };

  const path = `/work/${project.slug}`;
  // The project's own screenshot when it is a raster image; otherwise the branded card for this language.
  const shareImage = isShareableRaster(project.thumbnail)
    ? [{ url: project.thumbnail, alt: `${project.title} — ${project.category}` }]
    : [{ url: `/og/${locale}/work/${project.slug}`, width: 1200, height: 630 }];

  return {
    title: project.title,
    description: project.shortDescription,
    alternates: localeAlternates(locale, path),
    openGraph: {
      type: "article",
      url: localizeHref(locale, path),
      locale: ogLocale[locale],
      title: project.title,
      description: project.shortDescription,
      images: shareImage.length > 0 ? shareImage : ogImageFor(locale),
    },
    twitter: {
      card: "summary_large_image",
      title: project.title,
      description: project.shortDescription,
      images: shareImage,
    },
  };
}

export default async function ProjectPage({ params }: PageProps<"/[locale]/work/[slug]">) {
  const { slug } = await params;
  const locale = await getLocale();
  const project = await getProjectBySlug(slug, locale);
  if (!project) notFound();

  const [related, reviews] = await Promise.all([
    getRelatedProjects(project.slug, locale),
    getReviewsForProject(project.id),
  ]);
  return <ProjectDetail project={project} related={related} reviews={reviews} locale={locale} />;
}
