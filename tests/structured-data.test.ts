import { describe, expect, it } from "vitest";
import { buildSiteStructuredData, serializeJsonLd } from "@/lib/structured-data";
import type { SiteSettings } from "@/lib/schemas/site-content";

const settings: SiteSettings = {
  siteName: "Ian Verlinden",
  displayName: "Ian Verlinden",
  location: "Belgium",
  contactEmail: "",
  githubUrl: "",
  linkedinUrl: "https://www.linkedin.com/in/example",
  instagramUrl: "",
  xUrl: "",
  seoDefaultTitle: "Title",
  seoTitleTemplate: "%s | X",
  seoDefaultDescription: "Description",
  seoOgTitle: "",
};

describe("structured data", () => {
  it("is built only from settings and omits empty fields", () => {
    const json = JSON.stringify(buildSiteStructuredData(settings, "https://example.com"));
    expect(json).toContain('"@type":"WebSite"');
    expect(json).toContain('"@type":"Person"');
    expect(json).toContain('"@type":"ProfessionalService"');
    expect(json).toContain("linkedin.com/in/example");
    expect(json).not.toContain('"email"');
    expect(json).not.toContain("github");
  });

  it("never emits review or rating markup", () => {
    const json = JSON.stringify(buildSiteStructuredData(settings, "https://example.com"));
    expect(json).not.toMatch(/aggregateRating|"Review"|ratingValue/);
  });

  it("escapes < so CMS text can't close the script tag", () => {
    const out = serializeJsonLd({ name: "</script><b>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out).name).toBe("</script><b>");
  });
});
