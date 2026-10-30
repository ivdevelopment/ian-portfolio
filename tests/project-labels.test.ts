import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n/dictionaries";
import { isConceptProject, projectBadges, projectDisclosure, projectFilters } from "@/lib/project-labels";

const en = getDictionary("en");
const nl = getDictionary("nl");
const base = { kind: "website", projectType: "client", isExample: false, client: undefined } as const;

describe("project labelling", () => {
  it("presents client work normally", () => {
    expect(projectBadges(base, en)).toEqual([]);
    expect(projectDisclosure(base, en)).toBeNull();
  });

  it("clearly marks concept work, by type or kind, as not commissioned", () => {
    expect(isConceptProject({ kind: "redesign", projectType: "concept" })).toBe(true);
    expect(isConceptProject({ kind: "concept", projectType: "client" })).toBe(true);
    const p = { ...base, kind: "redesign", projectType: "concept", client: "Afroton" } as const;
    expect(projectBadges(p, en)).toEqual(["Concept"]);
    expect(projectDisclosure(p, en)).toMatch(/not commissioned by, and is not affiliated with, Afroton/);
    expect(projectDisclosure(p, nl)).toMatch(/niet in opdracht van Afroton/);
  });

  it("does not name a client it doesn't have", () => {
    expect(projectDisclosure({ ...base, projectType: "concept" }, en)).toMatch(/the brand shown/);
    expect(projectDisclosure({ ...base, projectType: "concept" }, nl)).toMatch(/het getoonde merk/);
  });

  it("labels sample content and personal projects in each language", () => {
    const sample = { ...base, isExample: true, projectType: "concept" } as const;
    expect(projectBadges(sample, en)).toEqual(["Concept", "Sample"]);
    expect(projectBadges(sample, nl)).toEqual(["Concept", "Voorbeeld"]);
    expect(projectDisclosure(sample, en)).toMatch(/Sample project/);
    expect(projectBadges({ ...base, projectType: "personal" }, nl)).toEqual(["Persoonlijk project"]);
  });

  it("localizes the filter labels", () => {
    expect(projectFilters(nl).map((f) => f.label)).toEqual(["Alles", "Websites", "Webapps", "Redesigns", "Concepten"]);
    expect(projectFilters(en)[0]).toEqual({ label: "All", kind: "all" });
  });
});
