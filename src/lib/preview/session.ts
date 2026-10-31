import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Preview sessions are stateless signed cookies:  v1.<payload>.<signature>
 * The payload binds the session to ONE preview (id + subdomain) and to its session generation
 * (`ver`), so a code reset, a disable, or a different preview invalidates it. The gateway also
 * re-checks the preview's live state on every request. The access code is never in the cookie.
 */
export type SessionPayload = {
  /** preview id */
  pid: string;
  /** subdomain the session was issued for */
  sub: string;
  /** session version at issue time */
  ver: number;
  /** issued-at / expiry, unix seconds */
  iat: number;
  exp: number;
};

export const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 1024;

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

function signingKey(secret: string): Buffer {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("PREVIEW_SESSION_SECRET is too short");
  // Domain-separate the key so the same secret could never validate another kind of token.
  return createHmac("sha256", secret).update("preview-session/v1").digest();
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = b64(JSON.stringify(payload));
  const signature = createHmac("sha256", signingKey(secret)).update(`v1.${body}`).digest();
  return `v1.${body}.${b64(signature)}`;
}

export type SessionFailure = "malformed" | "signature" | "expired" | "preview" | "version";
export type SessionCheck = { ok: true; payload: SessionPayload } | { ok: false; reason: SessionFailure };

export function verifySession(
  token: string | undefined,
  secret: string,
  expected: { pid: string; sub: string; ver: number },
  now: Date,
): SessionCheck {
  if (!token || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return { ok: false, reason: "malformed" };

  const expectedSig = createHmac("sha256", signingKey(secret)).update(`v1.${parts[1]}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(parts[2], "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (given.length !== expectedSig.length || !timingSafeEqual(given, expectedSig)) {
    return { ok: false, reason: "signature" };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload.pid !== "string" || typeof payload.sub !== "string" ||
    !Number.isInteger(payload.ver) || !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat)
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (payload.exp <= Math.floor(now.getTime() / 1000)) return { ok: false, reason: "expired" };
  if (payload.pid !== expected.pid || payload.sub !== expected.sub) return { ok: false, reason: "preview" };
  if (payload.ver !== expected.ver) return { ok: false, reason: "version" };
  return { ok: true, payload };
}

/** Expiry for a new session: the preview's session length, never beyond the preview's own expiry. */
export function sessionExpiry(now: Date, ttlHours: number, previewExpiresAt: string | null): number {
  const byTtl = Math.floor(now.getTime() / 1000) + ttlHours * 3600;
  if (!previewExpiresAt) return byTtl;
  const byPreview = Math.floor(new Date(previewExpiresAt).getTime() / 1000);
  return Number.isFinite(byPreview) ? Math.min(byTtl, byPreview) : byTtl;
}

/** `__Host-` pins the cookie to this exact host (no Domain, Path=/, Secure). Plain name for local http. */
export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-pv_session" : "pv_session";
}

export function serializeSessionCookie(
  name: string,
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  return [
    `${name}=${token}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(name: string, secure: boolean): string {
  return serializeSessionCookie(name, "", 0, secure);
}

/** Reads one cookie from a Cookie header. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}
