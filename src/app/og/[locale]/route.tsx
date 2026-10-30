import { isLocale } from "@/i18n/config";
import { renderOgCard } from "@/lib/og-image";
import { getHomeContent, getSiteSettings } from "@/lib/site-content";

const DISCIPLINE = { nl: "Webdesign & ontwikkeling", en: "Web Design & Development" } as const;
const EYEBROW = { nl: "Portfolio", en: "Portfolio" } as const;

export function generateStaticParams() {
  return [{ locale: "nl" }, { locale: "en" }];
}

/** Site-wide share card per language: display name, discipline and the hero headline from the CMS. */
export async function GET(_request: Request, { params }: RouteContext<"/og/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) return new Response("Not found", { status: 404 });

  const [settings, { hero }] = await Promise.all([getSiteSettings(locale), getHomeContent(locale)]);
  const { line1, line2, accent } = hero.headline;

  return renderOgCard({
    eyebrow: EYEBROW[locale],
    title: settings.displayName,
    subtitle: [line1, line2, accent].filter(Boolean).join(" "),
    brand: settings.displayName,
    footer: settings.location || undefined,
    discipline: DISCIPLINE[locale],
  });
}
