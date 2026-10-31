/**
 * Pure helpers for the reverse proxy: which headers and cookies cross the boundary and how
 * references to the real site are rewritten to the preview hostname. Allow-lists, not block-lists:
 * only headers that are known to be safe are forwarded.
 */

/** Request headers forwarded to the client's site. Everything else (incl. Cookie, handled separately) is dropped. */
const FORWARD_REQUEST_HEADERS = [
  "accept", "accept-language", "content-type", "range", "if-none-match", "if-modified-since",
  "if-range", "user-agent", "authorization", "x-requested-with", "next-action", "next-router-state-tree",
  "next-router-prefetch", "next-url", "rsc",
];

/** Cookie names that belong to the portfolio or the gateway and must never reach the client's site. */
const PRIVATE_COOKIE = /^(__host-)?pv_|^sb-|^site-locale$|^__secure-pv_/i;

export function filterCookieHeader(cookie: string | null | undefined): string | undefined {
  if (!cookie) return undefined;
  const kept = cookie
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c && !PRIVATE_COOKIE.test(c.split("=")[0].trim()));
  return kept.length > 0 ? kept.join("; ") : undefined;
}

export type RewriteContext = {
  /** https://client-site.example */
  targetOrigin: string;
  /** https://geertkips.ianverlinden.com (or http://x.localhost:3000 in dev) */
  previewOrigin: string;
};

const swapOrigin = (value: string, from: string, to: string) =>
  value.split(from).join(to).split(from.replace("://", ":\\/\\/")).join(to.replace("://", ":\\/\\/"));

export function buildUpstreamHeaders(request: Headers, ctx: RewriteContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.get(name);
    if (value) out[name] = value;
  }
  const origin = request.get("origin");
  if (origin) out.origin = swapOrigin(origin, ctx.previewOrigin, ctx.targetOrigin);
  const referer = request.get("referer");
  if (referer) out.referer = swapOrigin(referer, ctx.previewOrigin, ctx.targetOrigin);
  const cookie = filterCookieHeader(request.get("cookie"));
  if (cookie) out.cookie = cookie;
  // Compressed bodies can't be rewritten; the CDN in front of the gateway compresses for the visitor.
  out["accept-encoding"] = "identity";
  return out;
}

/** Redirects that stay on the client's site keep the preview hostname; other destinations are left alone. */
export function rewriteLocation(location: string, upstreamUrl: URL, ctx: RewriteContext): string {
  let resolved: URL;
  try {
    resolved = new URL(location, upstreamUrl);
  } catch {
    return location;
  }
  if (resolved.origin === ctx.targetOrigin) {
    return `${ctx.previewOrigin}${resolved.pathname}${resolved.search}${resolved.hash}`;
  }
  return location;
}

/**
 * Cookies from the client's site are passed through but kept host-only (Domain removed) and can't
 * collide with the gateway's own cookie. Returns null to drop one.
 */
export function rewriteSetCookie(cookie: string): string | null {
  const name = cookie.split("=")[0].trim();
  if (PRIVATE_COOKIE.test(name)) return null;
  return cookie
    .split(";")
    .map((p) => p.trim())
    .filter((p) => !/^domain=/i.test(p))
    .join("; ");
}

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te",
  "trailer", "transfer-encoding", "upgrade",
]);

/** Upstream response headers that are never passed on (identity of the platform, transport, hop-by-hop). */
const DROP_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP, "set-cookie", "content-length", "server", "x-powered-by", "via", "alt-svc",
  "strict-transport-security", "public-key-pins", "report-to", "nel", "cache-control", "expires",
  "pragma", "age", "etag", "last-modified", "vary", "cdn-cache-control", "vercel-cdn-cache-control",
  "cloudflare-cdn-cache-control", "x-robots-tag", "x-frame-options",
]);

const REWRITE_VALUE_HEADERS = new Set(["content-security-policy", "content-security-policy-report-only", "link", "refresh", "access-control-allow-origin"]);

export function rewriteResponseHeaders(
  upstream: Record<string, string | string[] | undefined>,
  upstreamUrl: URL,
  ctx: RewriteContext,
): { headers: Headers; cookies: string[] } {
  const headers = new Headers();
  for (const [name, raw] of Object.entries(upstream)) {
    const key = name.toLowerCase();
    if (raw === undefined || DROP_RESPONSE_HEADERS.has(key) || key.startsWith("x-vercel-") || key.startsWith("cf-")) continue;
    const value = Array.isArray(raw) ? raw.join(", ") : raw;
    if (key === "location") headers.set(key, rewriteLocation(value, upstreamUrl, ctx));
    else if (REWRITE_VALUE_HEADERS.has(key)) headers.set(key, swapOrigin(value, ctx.targetOrigin, ctx.previewOrigin));
    else headers.set(key, value);
  }

  const rawCookies = upstream["set-cookie"];
  const cookies = (Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [])
    .map(rewriteSetCookie)
    .filter((c): c is string => c !== null);
  return { headers, cookies };
}

/** Text formats in which the site may mention its own absolute address. */
const REWRITABLE_TYPE =
  /^(text\/(html|css|javascript|x-component|xml|plain)|application\/(javascript|x-javascript|json|manifest\+json|xml|rss\+xml|atom\+xml)|image\/svg\+xml)\b/i;

export function isRewritableContentType(contentType: string | undefined): boolean {
  return Boolean(contentType && REWRITABLE_TYPE.test(contentType));
}

/** Replaces the client site's own origin (plain, JSON-escaped and protocol-relative) with the preview origin. */
export function rewriteBodyText(text: string, ctx: RewriteContext): string {
  const targetHost = ctx.targetOrigin.replace(/^https?:\/\//, "");
  const previewHost = ctx.previewOrigin.replace(/^https?:\/\//, "");
  return swapOrigin(text, ctx.targetOrigin, ctx.previewOrigin)
    .split(`//${targetHost}`)
    .join(`//${previewHost}`);
}

export const MAX_REWRITE_BYTES = 8 * 1024 * 1024;
export const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
