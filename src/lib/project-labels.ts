import type { Project } from "@/types/project";

type LabelledProject = Pick<Project, "kind" | "projectType" | "isExample" | "client">;

/** Concept work and unofficial redesigns are never presented as client work. */
export function isConceptProject(p: Pick<Project, "kind" | "projectType">): boolean {
  return p.projectType === "concept" || p.kind === "concept";
}

/** Short labels shown on cards. Client work needs none. */
export function projectBadges(p: LabelledProject): string[] {
  const badges: string[] = [];
  if (isConceptProject(p)) badges.push("Concept");
  else if (p.projectType === "personal") badges.push("Personal project");
  if (p.isExample) badges.push("Sample");
  return badges;
}

/** Sentence shown on the project page when the work wasn't commissioned or is placeholder content. */
export function projectDisclosure(p: LabelledProject): string | null {
  if (p.isExample) {
    return "Sample project — placeholder content that demonstrates how work appears here. It is not a real engagement.";
  }
  if (isConceptProject(p)) {
    const subject = p.client?.trim() ? p.client.trim() : "the brand shown";
    return `Concept project — an independent, unofficial design exercise. It was not commissioned by, and is not affiliated with, ${subject}.`;
  }
  if (p.projectType === "personal") return "Personal project — built for myself, not for a client.";
  return null;
}
