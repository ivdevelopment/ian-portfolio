import { createHash, randomBytes } from "node:crypto";

/**
 * Review invitation tokens.
 *
 * - 32 random bytes from the OS CSPRNG = 256 bits of entropy, base64url (43 chars).
 * - Only the SHA-256 hash is ever stored. The raw token exists in memory while
 *   the invitation is created and in the one link shown to the admin.
 * - Lookups hash the incoming token and compare hashes in the database.
 */

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const EXPIRY_OPTIONS_DAYS = [7, 14, 30] as const;
export type ExpiryDays = (typeof EXPIRY_OPTIONS_DAYS)[number];

export function generateReviewToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashReviewToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cheap shape check before touching the database. A malformed token is simply "invalid". */
export function isPlausibleToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function expiryDate(days: ExpiryDays, from: Date): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export type InvitationRecord = {
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};

/** What an admin sees in the invitations list. */
export type InvitationStatus = "active" | "used" | "revoked" | "expired";

export function invitationStatus(inv: InvitationRecord, now: Date): InvitationStatus {
  if (inv.used_at) return "used";
  if (inv.revoked_at) return "revoked";
  if (new Date(inv.expires_at).getTime() <= now.getTime()) return "expired";
  return "active";
}

/**
 * The only question the public cares about. It mirrors the SQL conditions in
 * `get_review_invitation` / `submit_review` and deliberately collapses
 * unknown / expired / revoked / used into one answer.
 */
export function isInvitationUsable(inv: InvitationRecord | null | undefined, now: Date): boolean {
  return Boolean(inv) && invitationStatus(inv as InvitationRecord, now) === "active";
}

export const INVALID_REVIEW_LINK_MESSAGE = "This review link is no longer valid.";
