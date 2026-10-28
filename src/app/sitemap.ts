import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { getPublishedProjects } from "@/lib/projects";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = ["", "/work", "/services", "/about", "/contact"];
  const projects = await getPublishedProjects();

  return [
    ...staticRoutes.map((path) => ({
      url: `${siteConfig.url}${path}`,
      priority: path === "" ? 1 : 0.8,
    })),
    ...projects.map((project) => ({
      url: `${siteConfig.url}/work/${project.slug}`,
      lastModified: project.updatedAt,
      priority: 0.6,
    })),
  ];
}
