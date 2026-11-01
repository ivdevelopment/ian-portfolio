import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Token storage boundary. A refresh token is only ever written to the database as AES-256-GCM ciphertext
 * ("v1.<iv>.<tag>.<data>", base64url); the key lives only in the server environment (ZOHO_TOKEN_ENCRYPTION_KEY).
 * The tag authenticates the ciphertext, so a tampered value fails to decrypt instead of yielding garbage.
 */
const VERSION = "v1";

export function encryptToken(plain: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptToken(stored: string, key: Buffer): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("unrecognised token format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** A separate subkey for signing, derived from the same secret, so one key is never used for two purposes. */
const signingKey = (key: Buffer) => Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), "zoho-oauth-state", 32));

export type OAuthStatePayload = { nonce: string; uid: string; exp: number };

/** CSRF protection for the OAuth round trip: `state` binds the redirect to this admin, this browser and a short window. */
export function createOAuthState(uid: string, key: Buffer, now = Date.now(), ttlMs = 10 * 60_000): { state: string; cookie: string } {
  const nonce = randomBytes(24).toString("base64url");
  const payload: OAuthStatePayload = { nonce, uid, exp: now + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", signingKey(key)).update(body).digest("base64url");
  return { state: nonce, cookie: `${body}.${sig}` };
}

export function verifyOAuthState(
  cookie: string | undefined,
  stateParam: string | null,
  uid: string,
  key: Buffer,
  now = Date.now(),
): { ok: true } | { ok: false; reason: "missing" | "tampered" | "expired" | "mismatch" | "wrong_user" } {
  if (!cookie || !stateParam) return { ok: false, reason: "missing" };
  const [body, sig] = cookie.split(".");
  if (!body || !sig) return { ok: false, reason: "tampered" };
  const expected = createHmac("sha256", signingKey(key)).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "tampered" };
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthStatePayload;
  } catch {
    return { ok: false, reason: "tampered" };
  }
  if (payload.exp < now) return { ok: false, reason: "expired" };
  const a = Buffer.from(payload.nonce);
  const b = Buffer.from(stateParam);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "mismatch" };
  if (payload.uid !== uid) return { ok: false, reason: "wrong_user" };
  return { ok: true };
}
