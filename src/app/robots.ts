import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

/** Public pages in both languages (/ and /en) are crawlable; admin and review links never are. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/review/", "/en/review/", "/api/"],
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
