import { z } from "zod";
import { getDictionary, type Dictionary } from "@/i18n/dictionaries";
import { EXPIRY_OPTIONS_DAYS } from "@/lib/review-tokens";

export const REVIEW_STATUSES = ["pending", "approved", "rejected", "archived"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "Pending",
  approved: "Published",
  rejected: "Rejected",
  archived: "Archived",
};

export const reviewStatusSchema = z.enum(REVIEW_STATUSES);

const rating = z
  .number({ error: "Choose a rating." })
  .int()
  .min(1, "Choose a rating from 1 to 5.")
  .max(5, "Choose a rating from 1 to 5.");

/** `reviews/<review-id>/<uuid>.<png|jpg|webp>` inside the site-media bucket. */
export function isAvatarPathForReview(path: string, reviewId: string): boolean {
  return (
    path.startsWith(`reviews/${reviewId}/`) &&
    /^reviews\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(path)
  );
}

/** Admin review editor (create + edit). `source` is decided on the server, never sent by the client. */
export const reviewEditorSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name is required.").max(120, "Keep the name under 120 characters."),
  company: z.string().trim().max(120, "Keep the company under 120 characters."),
  role: z.string().trim().max(120, "Keep the role under 120 characters."),
  rating,
  reviewText: z
    .string()
    .trim()
    .min(1, "The review text is required.")
    .max(4000, "Keep the review under 4000 characters."),
  projectId: z.union([z.uuid(), z.literal("")]),
  avatarPath: z.string().max(300).nullable(),
  featured: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  status: z.enum(REVIEW_STATUSES),
});
export type ReviewEditorValues = z.infer<typeof reviewEditorSchema>;

/** What a client submits through an invitation link. Messages come from the visitor's language. */
export function createPublicReviewSchema(m: Dictionary["review"]["validation"]) {
  return z.object({
    name: z.string().trim().min(2, m.nameRequired).max(120, m.nameLong),
    company: z.string().trim().max(120, m.fieldLong),
    role: z.string().trim().max(120, m.fieldLong),
    rating: z
      .number({ error: m.ratingRequired })
      .int()
      .min(1, m.ratingRange)
      .max(5, m.ratingRange),
    review: z.string().trim().min(20, m.reviewShort).max(4000, m.reviewLong),
    /** Honeypot: real visitors never see or fill this. */
    website: z.string().max(0).optional(),
  });
}
export const publicReviewSchema = createPublicReviewSchema(getDictionary("en").review.validation);
export type PublicReviewValues = z.infer<typeof publicReviewSchema>;

export type ReviewSubmitResult =
  | { status: "invalid-input"; fieldErrors: Record<string, string[] | undefined> }
  /** One generic answer for unknown / expired / revoked / used links. */
  | { status: "invalid-link" }
  | { status: "submitted" }
  | { status: "error"; message: string };

export const invitationCreateSchema = z.object({
  clientName: z.string().trim().max(120, "Keep the name under 120 characters."),
  email: z.union([z.literal(""), z.email("Enter a valid email address.").max(200)]),
  projectId: z.union([z.uuid(), z.literal("")]),
  expiresInDays: z.union(
    EXPIRY_OPTIONS_DAYS.map((d) => z.literal(d)) as [
      z.ZodLiteral<7>,
      z.ZodLiteral<14>,
      z.ZodLiteral<30>,
    ],
  ),
});
export type InvitationCreateValues = z.infer<typeof invitationCreateSchema>;
