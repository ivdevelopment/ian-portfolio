import { describe, expect, it } from "vitest";
import { onlyApproved, rowToPublicReview, type ReviewRow } from "@/lib/review-filters";
import {
  invitationCreateSchema,
  isAvatarPathForReview,
  publicReviewSchema,
  reviewEditorSchema,
} from "@/lib/schemas/review";

const ID = "11111111-1111-4111-8111-111111111111";
const AV = "22222222-2222-4222-8222-222222222222";

const goodPublic = {
  name: "Test Client",
  company: "",
  role: "",
  rating: 5,
  review: "Working together was a great experience from start to finish.",
};

describe("publicReviewSchema", () => {
  it("accepts a valid review", () => {
    expect(publicReviewSchema.safeParse(goodPublic).success).toBe(true);
  });

  it.each([0, 6, -1, 3.5, NaN])("rejects rating %s", (rating) => {
    expect(publicReviewSchema.safeParse({ ...goodPublic, rating }).success).toBe(false);
  });
  it.each([1, 2, 3, 4, 5])("accepts rating %s", (rating) => {
    expect(publicReviewSchema.safeParse({ ...goodPublic, rating }).success).toBe(true);
  });

  it("requires a rating", () => {
    const { rating: _rating, ...rest } = goodPublic;
    void _rating;
    expect(publicReviewSchema.safeParse(rest).success).toBe(false);
  });

  it("enforces text limits", () => {
    expect(publicReviewSchema.safeParse({ ...goodPublic, review: "too short" }).success).toBe(false);
    expect(publicReviewSchema.safeParse({ ...goodPublic, review: "x".repeat(4001) }).success).toBe(false);
    expect(publicReviewSchema.safeParse({ ...goodPublic, name: "A" }).success).toBe(false);
    expect(publicReviewSchema.safeParse({ ...goodPublic, company: "c".repeat(121) }).success).toBe(false);
  });

  it("rejects a filled honeypot", () => {
    expect(publicReviewSchema.safeParse({ ...goodPublic, website: "https://spam.test" }).success).toBe(false);
    expect(publicReviewSchema.safeParse({ ...goodPublic, website: "" }).success).toBe(true);
  });
});

describe("reviewEditorSchema", () => {
  const good = {
    id: ID,
    name: "A. Client",
    company: "",
    role: "",
    rating: 4,
    reviewText: "Great work.",
    projectId: "",
    avatarPath: null,
    featured: false,
    sortOrder: 0,
    status: "pending" as const,
  };

  it("accepts a valid review and validates status and rating", () => {
    expect(reviewEditorSchema.safeParse(good).success).toBe(true);
    expect(reviewEditorSchema.safeParse({ ...good, status: "deleted" }).success).toBe(false);
    expect(reviewEditorSchema.safeParse({ ...good, rating: 9 }).success).toBe(false);
    expect(reviewEditorSchema.safeParse({ ...good, projectId: "not-a-uuid" }).success).toBe(false);
  });

  it("has no way to set the source (decided server-side)", () => {
    const parsed = reviewEditorSchema.parse({ ...good, source: "invitation" } as never);
    expect("source" in parsed).toBe(false);
  });
});

describe("avatar paths", () => {
  it("only accepts a png/jpg/webp inside the review's own folder", () => {
    expect(isAvatarPathForReview(`reviews/${ID}/${AV}.png`, ID)).toBe(true);
    expect(isAvatarPathForReview(`reviews/${ID}/${AV}.webp`, ID)).toBe(true);
    expect(isAvatarPathForReview(`reviews/${ID}/${AV}.gif`, ID)).toBe(false);
    expect(isAvatarPathForReview(`reviews/${ID}/${AV}.svg`, ID)).toBe(false);
    expect(isAvatarPathForReview(`reviews/${AV}/${AV}.png`, ID)).toBe(false);
    expect(isAvatarPathForReview(`projects/${ID}/${AV}.png`, ID)).toBe(false);
    expect(isAvatarPathForReview(`reviews/${ID}/../${AV}.png`, ID)).toBe(false);
  });
});

describe("invitationCreateSchema", () => {
  it("accepts 7, 14 and 30 day expiry only", () => {
    for (const d of [7, 14, 30]) {
      expect(invitationCreateSchema.safeParse({ clientName: "", email: "", projectId: "", expiresInDays: d }).success).toBe(true);
    }
    for (const d of [0, 1, 8, 365]) {
      expect(invitationCreateSchema.safeParse({ clientName: "", email: "", projectId: "", expiresInDays: d }).success).toBe(false);
    }
  });
  it("validates the optional email", () => {
    expect(invitationCreateSchema.safeParse({ clientName: "", email: "nope", projectId: "", expiresInDays: 7 }).success).toBe(false);
    expect(invitationCreateSchema.safeParse({ clientName: "A", email: "a@b.co", projectId: "", expiresInDays: 7 }).success).toBe(true);
  });
});

describe("public review filtering", () => {
  const row = (id: string, status: string): ReviewRow => ({
    id,
    project_id: null,
    name: id,
    company: null,
    role: null,
    rating: 5,
    review_text: "text",
    avatar_path: null,
    featured: false,
    status,
    projects: null,
  });

  it("only ever lets approved reviews through", () => {
    const rows = [row("a", "approved"), row("b", "pending"), row("c", "rejected"), row("d", "archived"), row("e", "approved")];
    expect(onlyApproved(rows).map((r) => r.id)).toEqual(["a", "e"]);
  });

  it("maps a row to a public review without private fields", () => {
    const review = rowToPublicReview({ ...row("a", "approved"), company: "Acme", role: "CEO", avatar_path: `reviews/${ID}/${AV}.png` });
    expect(review).toMatchObject({ id: "a", rating: 5, text: "text", company: "Acme", role: "CEO" });
    expect(review.avatar).toContain(`/site-media/reviews/${ID}/${AV}.png`);
    expect(Object.keys(review)).not.toContain("status");
    expect(Object.keys(review)).not.toContain("original_review_text");
  });
});
