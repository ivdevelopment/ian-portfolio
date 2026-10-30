import { Star } from "lucide-react";

export function Stars({ rating, max = 5, label }: { rating: number; max?: number; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          aria-hidden
          className={
            i < rating
              ? "size-4 fill-accent text-accent"
              : "size-4 text-line-strong"
          }
        />
      ))}
    </div>
  );
}
