/**
 * CSRF guard for cookie-less public POST endpoints: a browser always sends an
 * Origin header on cross-site POSTs, so a mismatch with the request's own host
 * is rejected. A missing Origin (non-browser client) is allowed; the other
 * layers (Turnstile, honeypot, timing, rate limit) cover scripted abuse.
 */
export function isSameOriginRequest(origin: string | null, host: string | null): boolean {
  if (!origin) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
