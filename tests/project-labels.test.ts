import { describe, expect, it } from "vitest";
import { isConceptProject, projectBadges, projectDisclosure } from "@/lib/project-labels";

const base = { kind: "website", projectType: "client", isExample: false, client: undefined } as const;

describe("project labelling", () => {
  it("presents client work normally", () => {
    expect(projectBadges(base)).toEqual([]);
    expect(projectDisclosure(base)).toBeNull();
  });

  it("clearly marks concept work, by type or kind, as not commissioned", () => {
    expect(isConceptProject({ kind: "redesign", projectType: "concept" })).toBe(true);
    expect(isConceptProject({ kind: "concept", projectType: "client" })).toBe(true);
    const p = { ...base, kind: "redesign", projectType: "concept", client: "Afroton" } as const;
    expect(projectBadges(p)).toEqual(["Concept"]);
    expect(projectDisclosure(p)).toMatch(/not commissioned by, and is not affiliated with, Afroton/);
  });

  it("does not name a client it doesn't have", () => {
    expect(projectDisclosure({ ...base, projectType: "concept" })).toMatch(/the brand shown/);
  });

  it("labels sample content first and personal projects", () => {
    const sample = { ...base, isExample: true, projectType: "concept" } as const;
    expect(projectBadges(sample)).toEqual(["Concept", "Sample"]);
    expect(projectDisclosure(sample)).toMatch(/Sample project/);
    expect(projectBadges({ ...base, projectType: "personal" })).toEqual(["Personal project"]);
  });
});
