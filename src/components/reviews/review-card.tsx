import Image from "next/image";
import Link from "next/link";
import type { PublicReview } from "@/types/review";
import { initialsOf } from "@/lib/utils";
import { Stars } from "@/components/ui/stars";

type ReviewCardProps = {
  review: PublicReview;
  /** Show a link to the related project (used on /reviews). */
  showProject?: boolean;
};

export function ReviewCard({ review, showProject }: ReviewCardProps) {
  const byline = [review.role, review.company].filter(Boolean).join(", ");

  return (
    <figure className="flex h-full flex-col rounded-card border border-line bg-glass p-6 shadow-card">
      <Stars rating={review.rating} />
      {/* Plain text only: React escapes it. */}
      <blockquote className="mt-4 flex-1 text-[0.95rem] leading-relaxed whitespace-pre-line text-ink">
        “{review.text}”
      </blockquote>
      <figcaption className="mt-6">
        <span className="flex items-center gap-3">
          {review.avatar ? (
            <Image
              src={review.avatar}
              alt=""
              width={40}
              height={40}
              loading="lazy"
              className="size-10 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-medium text-accent"
            >
              {initialsOf(review.name)}
            </span>
          )}
          <span className="min-w-0 text-sm">
            <span className="block font-medium">{review.name}</span>
            {byline && <span className="block truncate text-muted">{byline}</span>}
          </span>
        </span>
        {showProject && review.project && (
          <Link
            href={`/work/${review.project.slug}`}
            className="mt-4 inline-block text-sm text-accent underline-offset-4 hover:underline"
          >
            About: {review.project.title}
          </Link>
        )}
      </figcaption>
    </figure>
  );
}
