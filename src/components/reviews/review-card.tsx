import Image from "next/image";
import type { Review } from "@/types/review";
import { initialsOf } from "@/lib/utils";
import { Stars } from "@/components/ui/stars";

export function ReviewCard({ review }: { review: Review }) {
  const byline = [review.role, review.company].filter(Boolean).join(", ");

  return (
    <figure className="flex h-full flex-col rounded-card border border-line bg-glass p-6 shadow-card">
      <Stars rating={review.rating} />
      <blockquote className="mt-4 flex-1 text-[0.95rem] leading-relaxed text-ink">
        “{review.body}”
      </blockquote>
      <figcaption className="mt-6 flex items-center gap-3">
        {review.avatar ? (
          <Image
            src={review.avatar}
            alt=""
            width={40}
            height={40}
            className="size-10 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="inline-flex size-10 items-center justify-center rounded-full bg-accent-soft text-sm font-medium text-accent"
          >
            {initialsOf(review.name)}
          </span>
        )}
        <span className="min-w-0 text-sm">
          <span className="block font-medium">{review.name}</span>
          {byline && <span className="block truncate text-muted">{byline}</span>}
        </span>
        {review.placeholder && (
          <span className="ml-auto shrink-0 rounded-full border border-line px-2 py-0.5 text-[0.7rem] tracking-wide text-subtle uppercase">
            Sample
          </span>
        )}
      </figcaption>
    </figure>
  );
}
