import type { Metadata } from "next";
import { CtaSection } from "@/components/cta/cta-section";
import { Hero } from "@/components/hero/hero";
import { StatsStrip } from "@/components/hero/stats-strip";
import { ReviewsSection } from "@/components/reviews/reviews-section";
import { ServicesSection } from "@/components/services/services-section";
import { FeaturedProject } from "@/components/work/featured-project";
import { SelectedWork } from "@/components/work/selected-work";
import { isLocale, ogLocale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { localizeHref } from "@/i18n/paths";
import { localeAlternates, ogImageFor } from "@/lib/page-metadata";
import { getFeaturedProjects } from "@/lib/projects";
import { siteConfig } from "@/config/site";
import { getHomeContent, getSiteSettings } from "@/lib/site-content";
import { buildSiteStructuredData, serializeJsonLd } from "@/lib/structured-data";

/** Home keeps the CMS-managed default title/description (per language) and adds canonical + hreflang. */
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const s = await getSiteSettings(locale);
  const title = s.seoOgTitle || s.seoDefaultTitle;
  const images = ogImageFor(locale);
  return {
    alternates: localeAlternates(locale, "/"),
    openGraph: {
      type: "website",
      url: localizeHref(locale, "/"),
      locale: ogLocale[locale],
      siteName: s.siteName,
      title,
      description: s.seoDefaultDescription,
      images,
    },
    twitter: { card: "summary_large_image", title, description: s.seoDefaultDescription, images },
  };
}

export default async function HomePage() {
  const locale = await getLocale();
  const [featured, { featured: featuredIntro }, settings] = await Promise.all([
    getFeaturedProjects(locale),
    getHomeContent(locale),
    getSiteSettings(locale),
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(buildSiteStructuredData(settings, siteConfig.url, locale)),
        }}
      />
      <Hero />
      <StatsStrip />
      <FeaturedProject projects={featured} intro={featuredIntro} />
      <ServicesSection />
      <SelectedWork />
      <ReviewsSection />
      <CtaSection />
    </>
  );
}
