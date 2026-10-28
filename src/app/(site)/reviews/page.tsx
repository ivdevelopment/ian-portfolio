import type { Metadata } from "next";
import { CtaSection } from "@/components/cta/cta-section";
import { ReviewCard } from "@/components/reviews/review-card";
import { PageHeader } from "@/components/ui/page-header";
import { Reveal } from "@/components/ui/reveal";
import { getApprovedReviews } from "@/lib/reviews";

export const metadata: Metadata = {
  title: "Reviews",
  description: "What people say about working with me.",
  alternates: { canonical: "/reviews" },
  openGraph: { url: "/reviews", title: "Reviews" },
};

export default async function ReviewsPage() {
  const reviews = await getApprovedReviews();

  return (
    <>
      <PageHeader
        eyebrow="Reviews"
        title="Client stories"
        description="What people say about working with me."
      />

      <section aria-label="Client reviews" className="theme-light section-y pt-12">
        <div className="container-page">
          {reviews.length === 0 ? (
            <p className="rounded-card border border-line p-8 text-center text-muted">
              Reviews will appear here once clients have shared their experience.
            </p>
          ) : (
            <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {reviews.map((review, i) => (
                <Reveal as="li" key={review.id} delay={(i % 3) * 0.07}>
                  <ReviewCard review={review} showProject />
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
