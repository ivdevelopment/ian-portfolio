import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { hreflang, locales } from "@/i18n/config";
import { absoluteAlternates } from "@/i18n/paths";
import { getPublishedProjects } from "@/lib/projects";

const STATIC_ROUTES = ["/", "/work", "/services", "/about", "/reviews", "/contact"];

/** One entry per language per page, each listing every language version as an alternate. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const projects = await getPublishedProjects("nl");
  const entries: { path: string; priority: number; lastModified?: string }[] = [
    ...STATIC_ROUTES.map((path) => ({ path, priority: path === "/" ? 1 : 0.8 })),
    ...projects.map((p) => ({ path: `/work/${p.slug}`, priority: 0.6, lastModified: p.updatedAt })),
  ];

  return entries.flatMap(({ path, priority, lastModified }) => {
    const alternates = absoluteAlternates(siteConfig.url, path);
    const languages = {
      ...Object.fromEntries(locales.map((l) => [hreflang[l], alternates[l]])),
      "x-default": alternates.nl,
    };
    return locales.map((locale) => ({
      url: alternates[locale] === "" ? siteConfig.url : alternates[locale],
      lastModified,
      priority,
      alternates: { languages },
    }));
  });
}

