/**
 * Cloudflare Turnstile server-side verification.
 *
 * Enforced only when TURNSTILE_SECRET_KEY is set, so local development works
 * with no keys (or with Cloudflare's published test keys — see the README).
 * Verification failures never reveal details to the visitor.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileOutcome =
  /** No secret configured: not enforced. */
  | "skipped"
  | "ok"
  /** Token missing or rejected by Cloudflare. */
  | "failed"
  /** Cloudflare could not be reached; treated as a failure so bots can't bypass it. */
  | "unavailable";

export function isTurnstileEnforced(secret: string | undefined = process.env.TURNSTILE_SECRET_KEY): boolean {
  return Boolean(secret && secret.trim());
}

export async function verifyTurnstile(
  token: unknown,
  remoteIp: string | undefined,
  {
    secret = process.env.TURNSTILE_SECRET_KEY,
    fetchImpl = fetch,
  }: { secret?: string; fetchImpl?: typeof fetch } = {},
): Promise<TurnstileOutcome> {
  if (!isTurnstileEnforced(secret)) return "skipped";
  // Cloudflare tokens are well under 2048 characters.
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return "failed";

  const body = new URLSearchParams({ secret: secret!.trim(), response: token });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return "unavailable";
    const result = (await response.json()) as { success?: boolean };
    return result.success === true ? "ok" : "failed";
  } catch {
    return "unavailable";
  }
}
