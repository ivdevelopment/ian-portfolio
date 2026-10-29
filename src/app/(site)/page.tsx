import type { Metadata } from "next";
import { CtaSection } from "@/components/cta/cta-section";
import { Hero } from "@/components/hero/hero";
import { StatsStrip } from "@/components/hero/stats-strip";
import { ReviewsSection } from "@/components/reviews/reviews-section";
import { ServicesSection } from "@/components/services/services-section";
import { FeaturedProject } from "@/components/work/featured-project";
import { SelectedWork } from "@/components/work/selected-work";
import { getFeaturedProjects } from "@/lib/projects";
import { siteConfig } from "@/config/site";
import { getHomeContent, getSiteSettings } from "@/lib/site-content";
import { buildSiteStructuredData, serializeJsonLd } from "@/lib/structured-data";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const [featured, { featured: featuredIntro }, settings] = await Promise.all([
    getFeaturedProjects(),
    getHomeContent(),
    getSiteSettings(),
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(buildSiteStructuredData(settings, siteConfig.url)),
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
