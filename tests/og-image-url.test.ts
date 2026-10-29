import { describe, expect, it } from "vitest";
import { isShareableRaster } from "@/lib/og-image-url";

describe("isShareableRaster", () => {
  it("accepts PNG, JPEG and WebP (with or without a query string)", () => {
    for (const src of ["/a.png", "https://x.supabase.co/p/a.JPG", "b.jpeg", "c.webp?v=2"]) {
      expect(isShareableRaster(src)).toBe(true);
    }
  });

  it("rejects SVG, GIF, video and missing images so the generated card is used", () => {
    for (const src of ["/media/projects/placeholder.svg", "a.gif", "a.mp4", "", undefined]) {
      expect(isShareableRaster(src)).toBe(false);
    }
  });
});
