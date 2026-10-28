import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { PROJECT_SELECT, rowToProject, type ProjectRow } from "@/lib/cms/mappers";
import type { Project, ProjectKind } from "@/types/project";

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

export const projectFilters: { label: string; kind: ProjectKind | "all" }[] = [
  { label: "All", kind: "all" },
  { label: "Websites", kind: "website" },
  { label: "Web Apps", kind: "web-app" },
  { label: "Redesigns", kind: "redesign" },
  { label: "Concepts", kind: "concept" },
];

export const projectKindLabels: Record<ProjectKind, string> = {
  website: "Website",
  "web-app": "Web App",
  redesign: "Redesign",
  concept: "Concept",
};

export async function getPublishedProjects(): Promise<Project[]> {
  "use cache";
  cacheTag(PROJECTS_TAG);
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

  return (data as ProjectRow[]).map(rowToProject);
}

export async function getFeaturedProjects(): Promise<Project[]> {
  "use cache";
  cacheTag(PROJECTS_TAG);
  cacheLife("hours");

  return (await getPublishedProjects()).filter((p) => p.featured);
}

export async function getProjectBySlug(slug: string): Promise<Project | undefined> {
  "use cache";
  cacheTag(PROJECTS_TAG, projectTag(slug));
  cacheLife("hours");

  return (await getPublishedProjects()).find((p) => p.slug === slug);
}

export async function getRelatedProjects(slug: string, limit = 3): Promise<Project[]> {
  "use cache";
  cacheTag(PROJECTS_TAG);
  cacheLife("hours");

  return (await getPublishedProjects()).filter((p) => p.slug !== slug).slice(0, limit);
}
