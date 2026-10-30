import { describe, expect, it } from "vitest";
import { PLACEHOLDER_THUMBNAIL, resolveMediaUrl, rowToProject, type ProjectRow } from "@/lib/cms/mappers";

const BASE = "http://127.0.0.1:55321";

function row(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "example",
    title: "Example",
    subtitle: null,
    short_description: "Short",
    description: null,
    category: "Websites",
    kind: "website",
    year: null,
    client: null,
    project_type: null,
    thumbnail_path: null,
    tags: [],
    technologies: [],
    live_url: null,
    preview_url: null,
    github_url: null,
    preview_mode: "media",
    featured: false,
    published: true,
    is_example: false,
    sort_order: 0,
    translations: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    published_at: "2026-01-01T00:00:00Z",
    project_media: [],
    project_features: [],
    ...overrides,
  };
}

describe("resolveMediaUrl", () => {
  it("passes through absolute and app-relative URLs", () => {
    expect(resolveMediaUrl("https://cdn.test/a.png", BASE)).toBe("https://cdn.test/a.png");
    expect(resolveMediaUrl("/media/projects/a.svg", BASE)).toBe("/media/projects/a.svg");
  });
  it("turns storage keys into public bucket URLs", () => {
    expect(resolveMediaUrl("projects/abc/def.png", `${BASE}/`)).toBe(
      `${BASE}/storage/v1/object/public/project-media/projects/abc/def.png`,
    );
  });
  it("returns undefined for empty values", () => {
    expect(resolveMediaUrl(null, BASE)).toBeUndefined();
    expect(resolveMediaUrl("", BASE)).toBeUndefined();
  });
});

describe("rowToProject", () => {
  const media = (id: string, sort: number, extra: object = {}) => ({
    id,
    project_id: "p",
    type: "image" as const,
    storage_path: null,
    external_url: `https://cdn.test/${id}.png`,
    alt: null,
    poster_path: null,
    sort_order: sort,
    translations: {},
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  });

  it("orders media and features by sort_order", () => {
    const p = rowToProject(
      row({
        project_media: [media("b", 1), media("a", 0)],
        project_features: [
          { id: "2", project_id: "p", label: "Second", sort_order: 1 },
          { id: "1", project_id: "p", label: "First", sort_order: 0 },
        ],
      }),
    );
    expect(p.gallery.map((m) => m.src)).toEqual(["https://cdn.test/a.png", "https://cdn.test/b.png"]);
    expect(p.keyFeatures).toEqual(["First", "Second"]);
  });

  it("falls back: chosen thumbnail -> first still -> placeholder", () => {
    expect(rowToProject(row({ thumbnail_path: "https://cdn.test/t.png" })).thumbnail).toBe("https://cdn.test/t.png");
    expect(rowToProject(row({ project_media: [media("a", 0)] })).thumbnail).toBe("https://cdn.test/a.png");
    expect(rowToProject(row()).thumbnail).toBe(PLACEHOLDER_THUMBNAIL);
  });

  it("never uses a video as the hero still, and keeps posters", () => {
    const video = media("v", 0, { type: "video", external_url: "https://cdn.test/v.mp4", poster_path: "https://cdn.test/p.png" });
    const p = rowToProject(row({ project_media: [video, media("i", 1)] }));
    expect(p.heroMedia?.type).toBe("image");
    expect(p.gallery[0]).toMatchObject({ type: "video", poster: "https://cdn.test/p.png" });
  });

  it("maps flags and optional fields", () => {
    const p = rowToProject(row({ featured: true, is_example: true, year: 2026, subtitle: "Sub" }));
    expect(p).toMatchObject({ featured: true, isExample: true, year: 2026, subtitle: "Sub", published: true });
  });
});
