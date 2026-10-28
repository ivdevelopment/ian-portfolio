import { describe, expect, it } from "vitest";
import {
  defaultAboutContent,
  defaultContactContent,
  defaultHomeContent,
  defaultSiteSettings,
} from "@/data/default-content";
import {
  aboutContentSchema,
  contactContentSchema,
  homeContentSchema,
  isSafeHref,
  isSafeImageSrc,
  servicesListSchema,
  siteSettingsSchema,
  skillsListSchema,
  visibleStats,
} from "@/lib/schemas/site-content";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

describe("defaults are valid content", () => {
  it("passes the same schemas the admin uses", () => {
    expect(homeContentSchema.safeParse(defaultHomeContent).success).toBe(true);
    expect(aboutContentSchema.safeParse(defaultAboutContent).success).toBe(true);
    expect(contactContentSchema.safeParse(defaultContactContent).success).toBe(true);
    expect(siteSettingsSchema.safeParse(defaultSiteSettings).success).toBe(true);
  });
});

describe("links and images", () => {
  it("accepts internal paths and https URLs only", () => {
    for (const ok of ["/work", "/work#top", "https://example.com/x", "http://localhost:3000"]) expect(isSafeHref(ok)).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.test", "work", "", "mailto:a@b.c", "/\\evil"]) {
      expect(isSafeHref(bad)).toBe(false);
    }
  });

  it("accepts storage paths, /media paths and https images only", () => {
    expect(isSafeImageSrc(`site/hero/${ID1}.png`)).toBe(true);
    expect(isSafeImageSrc("/media/scenes/hero-workspace.svg")).toBe(true);
    expect(isSafeImageSrc("https://cdn.example.com/a.png")).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:image/svg+xml;base64,AAA", "site/../x.png", `site/hero/${ID1}.svg`, "/etc/passwd", "reviews/x"]) {
      expect(isSafeImageSrc(bad)).toBe(false);
    }
  });
});

describe("home content", () => {
  it("rejects unsafe CTA links and missing required text", () => {
    const bad = structuredClone(defaultHomeContent);
    bad.hero.primaryCta.href = "javascript:alert(1)";
    bad.hero.body = "";
    const result = homeContentSchema.safeParse(bad);
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["hero.primaryCta.href", "hero.body"]));
  });

  it("limits stats to 6 and requires value + label", () => {
    const stat = { value: "1", label: "x", enabled: true };
    const home = { ...defaultHomeContent, stats: Array.from({ length: 7 }, () => stat) };
    expect(homeContentSchema.safeParse(home).success).toBe(false);
    expect(homeContentSchema.safeParse({ ...defaultHomeContent, stats: [{ ...stat, value: "" }] }).success).toBe(false);
  });

  it("shows only enabled stats, in order", () => {
    const stats = [
      { value: "1", label: "a", enabled: true },
      { value: "2", label: "b", enabled: false },
      { value: "3", label: "c", enabled: true },
    ];
    expect(visibleStats(stats).map((s) => s.label)).toEqual(["a", "c"]);
  });
});

describe("about and contact content", () => {
  it("rejects an unsafe portrait and an invalid email", () => {
    expect(aboutContentSchema.safeParse({ ...defaultAboutContent, portrait: { src: "javascript:x", alt: "" } }).success).toBe(false);
    expect(contactContentSchema.safeParse({ ...defaultContactContent, email: "not-an-email" }).success).toBe(false);
    expect(contactContentSchema.safeParse({ ...defaultContactContent, email: "me@example.com" }).success).toBe(true);
  });
});

describe("site settings", () => {
  it("requires %s in the title template", () => {
    expect(siteSettingsSchema.safeParse({ ...defaultSiteSettings, seoTitleTemplate: "Just a title" }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...defaultSiteSettings, seoTitleTemplate: "%s | Me" }).success).toBe(true);
  });

  it("only accepts https social URLs", () => {
    expect(siteSettingsSchema.safeParse({ ...defaultSiteSettings, githubUrl: "https://github.com/me" }).success).toBe(true);
    expect(siteSettingsSchema.safeParse({ ...defaultSiteSettings, githubUrl: "http://github.com/me" }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...defaultSiteSettings, linkedinUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("validates the public email and requires core fields", () => {
    expect(siteSettingsSchema.safeParse({ ...defaultSiteSettings, contactEmail: "bad" }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...defaultSiteSettings, siteName: "" }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...defaultSiteSettings, seoDefaultDescription: "" }).success).toBe(false);
  });
});

describe("services", () => {
  const service = {
    id: ID1,
    slug: "web-design",
    title: "Web Design",
    description: "Clean designs.",
    icon: "design" as const,
    includes: [{ label: "Layout" }],
    enabled: true,
  };

  it("accepts a valid service and only controlled icon identifiers", () => {
    expect(servicesListSchema.safeParse([service]).success).toBe(true);
    expect(servicesListSchema.safeParse([{ ...service, icon: "<svg onload=alert(1)>" }]).success).toBe(false);
    expect(servicesListSchema.safeParse([{ ...service, icon: "unknown" }]).success).toBe(false);
  });

  it("validates slug, required fields and limits", () => {
    expect(servicesListSchema.safeParse([{ ...service, slug: "Bad Slug" }]).success).toBe(false);
    expect(servicesListSchema.safeParse([{ ...service, title: "" }]).success).toBe(false);
    expect(servicesListSchema.safeParse([{ ...service, includes: Array.from({ length: 9 }, () => ({ label: "x" })) }]).success).toBe(false);
  });

  it("requires unique slugs", () => {
    const result = servicesListSchema.safeParse([service, { ...service, id: ID2 }]);
    expect(result.success).toBe(false);
  });
});

describe("skills", () => {
  it("validates names, ids and the list size", () => {
    expect(skillsListSchema.safeParse([{ id: ID1, name: "Next.js", enabled: true }]).success).toBe(true);
    expect(skillsListSchema.safeParse([{ id: ID1, name: "", enabled: true }]).success).toBe(false);
    expect(skillsListSchema.safeParse([{ id: "nope", name: "x", enabled: true }]).success).toBe(false);
    expect(skillsListSchema.safeParse(Array.from({ length: 41 }, (_, i) => ({ id: `${i}`.padStart(8, "0") + ID1.slice(8), name: "x", enabled: true }))).success).toBe(false);
  });
});
