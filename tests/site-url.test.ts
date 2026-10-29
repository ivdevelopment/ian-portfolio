import { describe, expect, it } from "vitest";
import { isLocalUrl, resolveSiteUrl } from "@/lib/site-url";

describe("resolveSiteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL, normalised", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.com/" })).toBe("https://example.com");
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: " example.com " })).toBe("https://example.com");
  });

  it("falls back to the Vercel production domain", () => {
    expect(resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "site.vercel.app" })).toBe("https://site.vercel.app");
  });

  it("uses localhost only outside a production deployment", () => {
    expect(resolveSiteUrl({})).toBe("http://localhost:3000");
    expect(resolveSiteUrl({ VERCEL_ENV: "preview" })).toBe("http://localhost:3000");
  });

  it("refuses to build a production deployment without a real origin", () => {
    expect(() => resolveSiteUrl({ VERCEL_ENV: "production" })).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it("detects local URLs", () => {
    expect(isLocalUrl("http://localhost:3000")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:3000/x")).toBe(true);
    expect(isLocalUrl("https://example.com")).toBe(false);
    expect(isLocalUrl("https://localhost.example.com")).toBe(false);
  });
});
