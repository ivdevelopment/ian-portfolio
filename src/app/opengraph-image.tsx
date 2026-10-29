import { renderOgCard, OG_SIZE } from "@/lib/og-image";
import { getHomeContent, getSiteSettings } from "@/lib/site-content";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Web design and development portfolio";

/** Site-wide share image: display name, discipline and the hero headline from the CMS. */
export default async function Image() {
  const [settings, { hero }] = await Promise.all([getSiteSettings(), getHomeContent()]);
  const { line1, line2, accent } = hero.headline;

  return renderOgCard({
    eyebrow: "Portfolio",
    title: settings.displayName,
    subtitle: [line1, line2, accent].filter(Boolean).join(" "),
    brand: settings.displayName,
    footer: settings.location || undefined,
  });
}
