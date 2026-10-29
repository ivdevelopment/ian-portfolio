import type { Metadata } from "next";

/**
 * Metadata for a static public page. A page-level `openGraph` replaces the
 * layout's entirely, so everything a share card needs is restated here: the
 * canonical URL, site-wide share image and Twitter card.
 */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const images = [{ url: "/opengraph-image", width: 1200, height: 630 }];
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", url: path, title, description, images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
