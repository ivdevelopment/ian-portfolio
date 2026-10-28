/** A review as shown on the public site (approved only; no private fields). */
export type PublicReview = {
  id: string;
  rating: number;
  text: string;
  name: string;
  role?: string;
  company?: string;
  /** Resolved public URL, when an avatar was uploaded. */
  avatar?: string;
  featured: boolean;
  project?: { id: string; title: string; slug: string };
};
