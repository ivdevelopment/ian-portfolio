import { createHash, randomBytes } from "node:crypto";

/**
 * The agent's connection token: 256 random bits, prefixed so it is recognisable in a secret scanner. It is shown to the admin once; only its
 * SHA-256 hash is stored (the database function compares hashes, so even a database leak reveals nothing that can be used).
 */
export const TOKEN_PREFIX = "ipa_";
/** `ipa_` + 43 base64url characters (32 bytes). */
export const TOKEN_PATTERN = /^ipa_[A-Za-z0-9_-]{43}$/;

export function generateAgentToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A short, non-secret handle to tell devices apart in the list (the prefix plus the first characters). */
export function tokenHint(token: string): string {
  return token.slice(0, 8);
}

export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec((header ?? "").trim());
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}
