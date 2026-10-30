import type { Dictionary } from "@/i18n/dictionaries";
import { fmt } from "@/i18n/dictionaries";
import type { Project } from "@/types/project";

type LabelledProject = Pick<Project, "kind" | "projectType" | "isExample" | "client">;

/** Concept work and unofficial redesigns are never presented as client work. */
export function isConceptProject(p: Pick<Project, "kind" | "projectType">): boolean {
  return p.projectType === "concept" || p.kind === "concept";
}

/** Short labels shown on cards. Client work needs none. */
export function projectBadges(p: LabelledProject, dict: Dictionary): string[] {
  const badges: string[] = [];
  if (isConceptProject(p)) badges.push(dict.project.badges.concept);
  else if (p.projectType === "personal") badges.push(dict.project.badges.personal);
  if (p.isExample) badges.push(dict.project.badges.sample);
  return badges;
}

/** Sentence shown on the project page when the work wasn't commissioned or is placeholder content. */
export function projectDisclosure(p: LabelledProject, dict: Dictionary): string | null {
  const d = dict.project.disclosure;
  if (p.isExample) return d.sample;
  if (isConceptProject(p)) {
    return fmt(d.concept, { subject: p.client?.trim() ? p.client.trim() : d.conceptSubject });
  }
  if (p.projectType === "personal") return d.personal;
  return null;
}

/** Filter pills for the work grid, in display order. */
export const PROJECT_FILTER_KINDS = ["all", "website", "web-app", "redesign", "concept"] as const;
export type ProjectFilterKind = (typeof PROJECT_FILTER_KINDS)[number];

export function projectFilters(dict: Dictionary): { label: string; kind: ProjectFilterKind }[] {
  return PROJECT_FILTER_KINDS.map((kind) => ({ label: dict.work.filters[kind], kind }));
}
