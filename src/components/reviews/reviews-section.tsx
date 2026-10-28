import { getPublishedReviews } from "@/lib/reviews";
import { homeContent } from "@/data/content";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { ReviewCard } from "./review-card";

export function ReviewsSection() {
  const reviews = getPublishedReviews();
  const { reviews: copy } = homeContent;

  if (reviews.length === 0) return null;

  return (
    <section aria-labelledby="reviews-title" className="theme-light section-y">
      <div className="container-page">
        <Reveal className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Eyebrow>{copy.eyebrow}</Eyebrow>
            <h2 id="reviews-title" className="text-headline mt-3">
              {copy.title}
            </h2>
          </div>
          {reviews.some((r) => r.placeholder) && (
            <p className="max-w-xs text-sm text-subtle sm:text-right">{copy.note}</p>
          )}
        </Reveal>

        <ul className="no-scrollbar -mx-(--gutter) mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-(--gutter) pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0">
          {reviews.map((review, i) => (
            <Reveal
              as="li"
              key={review.id}
              delay={i * 0.09}
              className="w-[85%] shrink-0 snap-center sm:w-[60%] md:w-auto"
            >
              <ReviewCard review={review} />
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
