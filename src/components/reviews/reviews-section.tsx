import { ArrowRight } from "lucide-react";
import { getHomepageReviews } from "@/lib/reviews";
import { getI18n } from "@/i18n/server";
import { LocaleLink } from "@/i18n/locale-link";
import { getHomeContent } from "@/lib/site-content";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { ReviewCard } from "./review-card";

/** Homepage testimonials. Renders nothing until at least one review is approved. */
export async function ReviewsSection() {
  const { locale, dict } = await getI18n();
  const [reviews, { reviews: copy }] = await Promise.all([getHomepageReviews(), getHomeContent(locale)]);
  if (reviews.length === 0) return null;

  return (
    <section aria-labelledby="reviews-title" className="theme-light section-y">
      <div className="container-page">
        <Reveal className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {copy.eyebrow && <Eyebrow>{copy.eyebrow}</Eyebrow>}
            <h2 id="reviews-title" className="text-headline mt-3">
              {copy.heading}
            </h2>
            {copy.body && <p className="mt-3 max-w-xl text-muted">{copy.body}</p>}
          </div>
          <LocaleLink
            href="/reviews"
            className="group inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            {dict.reviews.viewAll}
            <ArrowRight
              aria-hidden
              className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
            />
          </LocaleLink>
        </Reveal>

        <ul className="no-scrollbar -mx-(--gutter) mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-(--gutter) pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0">
          {reviews.map((review, i) => (
            <Reveal
              as="li"
              key={review.id}
              delay={i * 0.09}
              className="w-[85%] shrink-0 snap-center sm:w-[60%] md:w-auto"
            >
              <ReviewCard review={review} locale={locale} />
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
