import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rowToEditorValues } from "@/lib/cms/editor";
import type { ProjectRow } from "@/lib/cms/mappers";
import { rowToProject } from "@/lib/cms/mappers";
import { isStoragePathForProject } from "@/lib/media-rules";
import { projectEditorSchema } from "@/lib/schemas/project";
import { projectTranslationSchema } from "@/lib/schemas/project-translation";
import { CONCEPTS } from "../scripts/portfolio-import/curation.mjs";
import { DEFAULT_MANIFEST, buildPlan, projectIdFor, readManifest } from "../scripts/portfolio-import/plan.mjs";

describe("portfolio import identity", () => {
  it("derives a stable, valid project id from the slug", () => {
    expect(projectIdFor("struct")).toBe(projectIdFor("struct"));
    expect(projectIdFor("struct")).not.toBe(projectIdFor("haven"));
    expect(projectIdFor("struct")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("keeps the curated order unique", () => {
    expect(new Set(CONCEPTS.map((c) => c.sortOrder)).size).toBe(CONCEPTS.length);
    expect(new Set(CONCEPTS.map((c) => c.slug)).size).toBe(CONCEPTS.length);
  });
});

// The manifest lives beside the demo assets, not in this repository.
describe.skipIf(!existsSync(DEFAULT_MANIFEST))("portfolio import plan", async () => {
  const plan = existsSync(DEFAULT_MANIFEST) ? await buildPlan(readManifest()) : [];

  const asRow = (p: (typeof plan)[number]) =>
    ({
      ...p.row,
      translations: { nl: p.translationNl },
      created_at: "",
      updated_at: "",
      published_at: null,
      project_media: p.media.map((m, i) => ({
        id: m.id,
        project_id: p.row.id,
        type: "image",
        storage_path: m.storagePath,
        external_url: null,
        alt: m.alt,
        poster_path: null,
        sort_order: i,
        created_at: "",
      })),
      project_features: p.features.map((label: string, i: number) => ({ id: `f${i}`, project_id: p.row.id, label, sort_order: i })),
    }) as unknown as ProjectRow;

  it.each(CONCEPTS.map((c) => c.slug))("%s passes the admin editor's own validation", (slug) => {
    const p = plan.find((x) => x.row.slug === slug)!;
    const parsed = projectEditorSchema.safeParse(rowToEditorValues(asRow(p)));
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    const nl = projectTranslationSchema.safeParse(p.translationNl);
    expect(nl.success ? [] : nl.error.issues).toEqual([]);
    for (const m of p.media) expect(isStoragePathForProject(m.storagePath, p.row.id)).toBe(true);
  });

  it("labels every project as a concept with an external preview", () => {
    for (const p of plan) {
      expect(p.row).toMatchObject({ kind: "concept", project_type: "concept", preview_mode: "external", client: null });
      expect(p.row.live_url).toMatch(/^https:\/\/[a-z]+\.ianverlinden\.com$/);
      expect(p.row.title).not.toMatch(/portfolio|website/i);
    }
  });

  it("uses the cover as thumbnail and a concise gallery", () => {
    for (const p of plan) {
      expect(p.row.thumbnail_path).toBe(p.media[0].storagePath);
      expect(p.media.length).toBeGreaterThanOrEqual(5);
      expect(p.media.length).toBeLessThanOrEqual(6);
      expect(new Set(p.media.map((m) => m.storagePath)).size).toBe(p.media.length);
    }
  });

  it("lists implementation technologies only", () => {
    for (const p of plan) {
      expect(p.row.technologies).toEqual(expect.arrayContaining(["Next.js", "React", "TypeScript", "Cloudflare Workers"]));
      for (const t of p.row.technologies) expect(t).toMatch(/^(Next\.js|React|TypeScript|CSS|Tailwind CSS|Cloudflare Workers)$/);
    }
  });

  it("renders Dutch copy and captions, with English as the base", () => {
    const p = plan[0];
    const nl = rowToProject(asRow(p), "nl");
    const en = rowToProject(asRow(p), "en");
    expect(nl.description).toBe(p.translationNl.description);
    expect(nl.keyFeatures).toEqual(p.translationNl.features);
    expect(nl.gallery[0].alt).toBe(p.media[0].altNl);
    expect(nl.tags).toEqual(["Webdesign", "Ontwikkeling", "Bouw"]);
    expect(en.description).toBe(p.row.description);
    expect(en.gallery[0].alt).toBe(p.media[0].alt);
    expect(en.keyFeatures).toEqual(p.features);
  });
});
