import type { Metadata } from "next";
import { CtaSection } from "@/components/cta/cta-section";
import { Hero } from "@/components/hero/hero";
import { StatsStrip } from "@/components/hero/stats-strip";
import { ReviewsSection } from "@/components/reviews/reviews-section";
import { ServicesSection } from "@/components/services/services-section";
import { FeaturedProject } from "@/components/work/featured-project";
import { SelectedWork } from "@/components/work/selected-work";
import { getFeaturedProjects } from "@/lib/projects";
import { getHomeContent } from "@/lib/site-content";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const [featured, { featured: featuredIntro }] = await Promise.all([
    getFeaturedProjects(),
    getHomeContent(),
  ]);

  return (
    <>
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
