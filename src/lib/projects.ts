import { projects } from "@/data/projects";
import type { Project, ProjectKind } from "@/types/project";

/**
 * Data access for projects. Today it reads local data; in P1 these
 * functions are the only place that changes (Supabase queries).
 */

const bySortOrder = (a: Project, b: Project) => a.sortOrder - b.sortOrder;

export function getPublishedProjects(): Project[] {
  return projects.filter((p) => p.published).sort(bySortOrder);
}

export function getFeaturedProjects(): Project[] {
  return getPublishedProjects().filter((p) => p.featured);
}

export function getProjectBySlug(slug: string): Project | undefined {
  return getPublishedProjects().find((p) => p.slug === slug);
}

export function getRelatedProjects(slug: string, limit = 3): Project[] {
  return getPublishedProjects()
    .filter((p) => p.slug !== slug)
    .slice(0, limit);
}

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
