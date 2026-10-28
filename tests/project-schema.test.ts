import { describe, expect, it } from "vitest";
import { emptyEditorValues } from "@/lib/cms/editor";
import { isHttpUrl, projectEditorSchema, type ProjectEditorValues } from "@/lib/schemas/project";

const ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "22222222-2222-4222-8222-222222222222";

function valid(overrides: Partial<ProjectEditorValues> = {}): ProjectEditorValues {
  return {
    ...emptyEditorValues(ID),
    title: "Example",
    slug: "example",
    shortDescription: "A short description.",
    category: "Websites",
    ...overrides,
  };
}

const issuePaths = (v: ProjectEditorValues) => {
  const r = projectEditorSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("projectEditorSchema", () => {
  it("accepts a minimal valid project", () => {
    expect(projectEditorSchema.safeParse(valid()).success).toBe(true);
  });

  it("requires title, short description and category", () => {
    const paths = issuePaths(valid({ title: " ", shortDescription: "", category: "" }));
    expect(paths).toEqual(expect.arrayContaining(["title", "shortDescription", "category"]));
  });

  it("validates slugs", () => {
    expect(issuePaths(valid({ slug: "Not A Slug" }))).toContain("slug");
    expect(issuePaths(valid({ slug: "-bad-" }))).toContain("slug");
    expect(issuePaths(valid({ slug: "good-slug-1" }))).not.toContain("slug");
  });

  it("only allows http(s) URLs (no javascript:/data:)", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>")).toBe(false);
    expect(issuePaths(valid({ liveUrl: "javascript:alert(1)" }))).toContain("liveUrl");
    expect(issuePaths(valid({ githubUrl: "not a url" }))).toContain("githubUrl");
    expect(issuePaths(valid({ liveUrl: "" }))).not.toContain("liveUrl");
  });

  it("checks the year format", () => {
    expect(issuePaths(valid({ year: "26" }))).toContain("year");
    expect(issuePaths(valid({ year: "2026" }))).not.toContain("year");
    expect(issuePaths(valid({ year: "" }))).not.toContain("year");
  });

  it("requires a URL for embed and external preview modes", () => {
    expect(issuePaths(valid({ previewMode: "embed" }))).toContain("previewUrl");
    expect(issuePaths(valid({ previewMode: "embed", liveUrl: "https://example.com" }))).toEqual([]);
    expect(issuePaths(valid({ previewMode: "external" }))).toContain("liveUrl");
    expect(issuePaths(valid({ previewMode: "external", liveUrl: "https://example.com" }))).toEqual([]);
  });

  it("limits tags and chip length", () => {
    expect(issuePaths(valid({ tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }))).toContain("tags");
    expect(issuePaths(valid({ technologies: ["x".repeat(41)] })).length).toBeGreaterThan(0);
  });

  it("rejects empty features", () => {
    expect(issuePaths(valid({ features: [{ label: " " }] }))).toContain("features.0.label");
  });

  it("requires exactly one media source and an https/app-relative external URL", () => {
    const base = { mediaId: MEDIA_ID, type: "image" as const, alt: "", posterPath: null };
    const both = valid({ media: [{ ...base, storagePath: "p", externalUrl: "https://x.test/a.png" }] });
    const none = valid({ media: [{ ...base, storagePath: null, externalUrl: null }] });
    const http = valid({ media: [{ ...base, storagePath: null, externalUrl: "http://x.test/a.png" }] });
    const ok = valid({ media: [{ ...base, storagePath: null, externalUrl: "https://x.test/a.png" }] });
    expect(projectEditorSchema.safeParse(both).success).toBe(false);
    expect(projectEditorSchema.safeParse(none).success).toBe(false);
    expect(projectEditorSchema.safeParse(http).success).toBe(false);
    expect(projectEditorSchema.safeParse(ok).success).toBe(true);
  });
});
