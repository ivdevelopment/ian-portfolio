import { cacheLife, cacheTag } from "next/cache";
import type { Locale } from "@/i18n/config";
import { createPublicClient } from "@/lib/supabase/public";
import { PROJECT_SELECT, rowToProject, type ProjectRow } from "@/lib/cms/mappers";
import type { Project } from "@/types/project";

/**
 * Public project data access. Reads run as the anonymous role, so Row Level
 * Security guarantees only published projects can ever be returned — the
 * `published` filter below is a second, explicit layer.
 *
 * Results are cached and tagged "projects" (plus "project:<slug>"); admin
 * server actions call `updateTag` so edits show up immediately.
 */

export const PROJECTS_TAG = "projects";
export const projectTag = (slug: string) => `project:${slug}`;
/** Per-language tag: editing Dutch text expires Dutch output only; publishing expires both. */
export const projectsLocaleTag = (locale: Locale) => `${PROJECTS_TAG}:${locale}`;

export async function getPublishedProjects(locale: Locale): Promise<Project[]> {
  "use cache";
  cacheTag(PROJECTS_TAG, projectsLocaleTag(locale));
  cacheLife("hours");

  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("published", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    // Throw (rather than return []) so a failure is never cached as "no projects".
    console.error("[projects] failed to load published projects:", error.message);
    throw new Error("Projects are temporarily unavailable.");
  }

  return (data as ProjectRow[]).map((row) => rowToProject(row, locale));
}

export async function getFeaturedProjects(locale: Locale): Promise<Project[]> {
  "use cache";
  cacheTag(PROJECTS_TAG, projectsLocaleTag(locale));
  cacheLife("hours");

  return (await getPublishedProjects(locale)).filter((p) => p.featured);
}

export async function getProjectBySlug(slug: string, locale: Locale): Promise<Project | undefined> {
  "use cache";
  cacheTag(PROJECTS_TAG, projectTag(slug), projectsLocaleTag(locale));
  cacheLife("hours");

  return (await getPublishedProjects(locale)).find((p) => p.slug === slug);
}

export async function getRelatedProjects(slug: string, locale: Locale, limit = 3): Promise<Project[]> {
  "use cache";
  cacheTag(PROJECTS_TAG, projectsLocaleTag(locale));
  cacheLife("hours");

  return (await getPublishedProjects(locale)).filter((p) => p.slug !== slug).slice(0, limit);
}
