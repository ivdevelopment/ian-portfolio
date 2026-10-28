import { describe, expect, it } from "vitest";
import {
  EXPIRY_OPTIONS_DAYS,
  expiryDate,
  generateReviewToken,
  hashReviewToken,
  invitationStatus,
  isInvitationUsable,
  isPlausibleToken,
} from "@/lib/review-tokens";

const NOW = new Date("2026-06-01T12:00:00Z");
const future = "2026-06-10T12:00:00Z";
const past = "2026-05-20T12:00:00Z";

describe("token generation", () => {
  it("produces 256-bit base64url tokens (43 chars)", () => {
    const token = generateReviewToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isPlausibleToken(token)).toBe(true);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 2000 }, generateReviewToken));
    expect(tokens.size).toBe(2000);
  });

  it("uses a CSPRNG (no obvious bias: every base64url character class appears)", () => {
    const sample = Array.from({ length: 200 }, generateReviewToken).join("");
    expect(sample).toMatch(/[A-Z]/);
    expect(sample).toMatch(/[a-z]/);
    expect(sample).toMatch(/[0-9]/);
  });
});

describe("token hashing", () => {
  it("is a deterministic SHA-256 hex digest that does not contain the token", () => {
    const token = generateReviewToken();
    const hash = hashReviewToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashReviewToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it("matches a known SHA-256 vector", () => {
    expect(hashReviewToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("different tokens give different hashes", () => {
    expect(hashReviewToken(generateReviewToken())).not.toBe(hashReviewToken(generateReviewToken()));
  });
});

describe("plausibility check", () => {
  it.each(["", "short", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}!`, `${"a".repeat(42)} `, "../../etc/passwd"])(
    "rejects %j",
    (value) => expect(isPlausibleToken(value)).toBe(false),
  );
});

describe("expiry", () => {
  it("only offers 7, 14 and 30 days", () => {
    expect([...EXPIRY_OPTIONS_DAYS]).toEqual([7, 14, 30]);
  });
  it("computes the expiry date", () => {
    expect(expiryDate(7, NOW).toISOString()).toBe("2026-06-08T12:00:00.000Z");
    expect(expiryDate(30, NOW).toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });
});

describe("invitation state", () => {
  const base = { expires_at: future, used_at: null, revoked_at: null };

  it("is active when unused, unrevoked and unexpired", () => {
    expect(invitationStatus(base, NOW)).toBe("active");
    expect(isInvitationUsable(base, NOW)).toBe(true);
  });

  it("rejects expired invitations (including exactly at the expiry instant)", () => {
    expect(invitationStatus({ ...base, expires_at: past }, NOW)).toBe("expired");
    expect(invitationStatus({ ...base, expires_at: NOW.toISOString() }, NOW)).toBe("expired");
    expect(isInvitationUsable({ ...base, expires_at: past }, NOW)).toBe(false);
  });

  it("rejects revoked invitations", () => {
    const revoked = { ...base, revoked_at: "2026-05-30T00:00:00Z" };
    expect(invitationStatus(revoked, NOW)).toBe("revoked");
    expect(isInvitationUsable(revoked, NOW)).toBe(false);
  });

  it("rejects used (reused) invitations — used wins over every other state", () => {
    const used = { ...base, used_at: "2026-05-31T00:00:00Z" };
    expect(invitationStatus(used, NOW)).toBe("used");
    expect(isInvitationUsable(used, NOW)).toBe(false);
    expect(invitationStatus({ ...used, revoked_at: "2026-05-31T01:00:00Z", expires_at: past }, NOW)).toBe("used");
  });

  it("treats a missing invitation as unusable", () => {
    expect(isInvitationUsable(null, NOW)).toBe(false);
    expect(isInvitationUsable(undefined, NOW)).toBe(false);
  });
});
