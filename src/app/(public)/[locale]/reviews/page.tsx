import type { Metadata } from "next";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getI18n } from "@/i18n/server";
import { pageMetadata } from "@/lib/page-metadata";
import { CtaSection } from "@/components/cta/cta-section";
import { ReviewCard } from "@/components/reviews/review-card";
import { PageHeader } from "@/components/ui/page-header";
import { Reveal } from "@/components/ui/reveal";
import { getApprovedReviews } from "@/lib/reviews";

export async function generateMetadata({ params }: PageProps<"/[locale]/reviews">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = getDictionary(locale);
  return pageMetadata({ locale, title: dict.reviews.title, description: dict.reviews.description, path: "/reviews" });
}

export default async function ReviewsPage() {
  const { locale, dict } = await getI18n();
  const reviews = await getApprovedReviews();

  return (
    <>
      <PageHeader
        eyebrow={dict.reviews.eyebrow}
        title={dict.reviews.heading}
        description={dict.reviews.intro}
      />

      <section aria-label={dict.reviews.sectionLabel} className="theme-light section-y pt-12">
        <div className="container-page">
          {reviews.length === 0 ? (
            <p className="rounded-card border border-line p-8 text-center text-muted">
              {dict.reviews.empty}
            </p>
          ) : (
            <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {reviews.map((review, i) => (
                <Reveal as="li" key={review.id} delay={(i % 3) * 0.07}>
                  <ReviewCard review={review} showProject locale={locale} />
                </Reveal>
              ))}
            </ul>
          )}
        </div>
      </section>

      <CtaSection />
    </>
  );
}
