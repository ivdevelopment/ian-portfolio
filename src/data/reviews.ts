import type { Review } from "@/types/review";

/**
 * TEMPORARY sample reviews. They are not real client feedback and must be
 * replaced (or removed) before launch. `placeholder: true` marks them.
 */
export const reviews: Review[] = [
  {
    id: "rev-1",
    rating: 5,
    body: "Ian completely redesigned our website and the result is amazing. Modern, fast and exactly what we needed. Communication was always smooth and professional.",
    name: "Sarah Johnson",
    role: "Owner",
    company: "Example Company",
    published: true,
    placeholder: true,
  },
  {
    id: "rev-2",
    rating: 5,
    body: "Working with Ian was a great experience. He understood our vision immediately and delivered a website that looks incredible.",
    name: "Michael Brown",
    role: "Founder",
    company: "Example Company",
    published: true,
    placeholder: true,
  },
  {
    id: "rev-3",
    rating: 5,
    body: "Fast, professional and high quality work. Our new website has helped us attract more customers and really represents our brand perfectly.",
    name: "Lisa Carter",
    role: "Owner",
    company: "Example Company",
    published: true,
    placeholder: true,
  },
];
