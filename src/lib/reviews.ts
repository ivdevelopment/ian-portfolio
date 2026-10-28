import { reviews } from "@/data/reviews";
import type { Review } from "@/types/review";

export function getPublishedReviews(): Review[] {
  return reviews.filter((r) => r.published);
}
