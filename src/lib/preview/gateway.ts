import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { PreviewConfig } from "./config";
import { parsePreviewHost } from "./hostname";
import {
  ROBOTS_DISALLOW_ALL,
  GATEWAY_PAGE_CSP,
  accessPage,
  notFoundPage,
  safeNextPath,
  targetUnavailablePage,
  unavailablePage,
} from "./pages";
import {
  clearSessionCookie,
  readCookie,
  serializeSessionCookie,
  sessionCookieName,
  sessionExpiry,
  signSession,
  verifySession,
} from "./session";
import type { PreviewStore } from "./store";
import { validateTargetUrl } from "./target-url";
import {
  MAX_REQUEST_BODY_BYTES,
  MAX_REWRITE_BYTES,
  buildUpstreamHeaders,
  isRewritableContentType,
  rewriteBodyText,
  rewriteResponseHeaders,
} from "./upstream";
import type { UpstreamResponse } from "./safe-fetch";

/** Internal path prefix the proxy rewrites preview-host requests to. Never reachable on the main site. */
export const GATEWAY_PREFIX = "/gw-preview";
const LOGIN_PATH = "/__preview/login";
const LOGOUT_PATH = "/__preview/logout";
const MARKER_HEADER = "x-preview-gateway";

export type GatewayDeps = {
  config: PreviewConfig;
  store: PreviewStore;
  fetchUpstream: (opts: {
    url: URL;
    method: string;
    headers: Record<string, string>;
    body?: Buffer;
  }) => Promise<UpstreamResponse>;
  now?: () => Date;
  /** Safe, structured events only: never codes, tokens or IP addresses. */
  log?: (event: Record<string, unknown>) => void;
};

/** Headers on every response: protected content must never be cached by a shared cache or a search engine. */
function privateHeaders(h: Headers): Headers {
  h.set("cache-control", "private, no-store, max-age=0");
  h.set("cdn-cache-control", "no-store");
  h.set("vercel-cdn-cache-control", "no-store");
  h.set("vary", "Cookie");
  h.set("x-robots-tag", "noindex, nofollow, noarchive");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  h.set(MARKER_HEADER, "1");
  return h;
}

function page(html: string, status: number, extra: Record<string, string> = {}): Response {
  const headers = privateHeaders(new Headers({ "content-type": "text/html; charset=utf-8", ...extra }));
  headers.set("content-security-policy", GATEWAY_PAGE_CSP);
  return new Response(html, { status, headers });
}

function text(body: string, status: number, type = "text/plain; charset=utf-8"): Response {
  return new Response(body, { status, headers: privateHeaders(new Headers({ "content-type": type })) });
}

function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/** The path the visitor actually requested (the proxy prepends GATEWAY_PREFIX when rewriting). */
export function originalPath(url: URL): string {
  const p = url.pathname;
  const stripped = p === GATEWAY_PREFIX ? "/" : p.startsWith(`${GATEWAY_PREFIX}/`) ? p.slice(GATEWAY_PREFIX.length) : p;
  return stripped || "/";
}

export async function handleGatewayRequest(request: Request, deps: GatewayDeps): Promise<Response> {
  const { config, store } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const url = new URL(request.url);

  // 1. Hostname: never trusted blindly. Anything that is not exactly <label>.<base domain> is not ours.
  const host = request.headers.get("host");
  const subdomain = parsePreviewHost(host, { baseDomain: config.baseDomain, allowLocalhost: config.allowLocalhost });
  if (!subdomain) return page(notFoundPage(), 404);

  const secure = config.production;
  const previewOrigin = `${secure ? "https" : "http"}://${host!.toLowerCase()}`;
  const path = originalPath(url);
  const method = request.method.toUpperCase();

  // 2. Fail closed when the gateway isn't configured.
  if (!config.sessionSecret || !config.ipSalt) {
    log({ event: "preview_misconfigured", subdomain });
    return page(unavailablePage(), 503);
  }

  // 3. Crawlers: always "no", with or without access.
  if (path === "/robots.txt" && (method === "GET" || method === "HEAD")) return text(ROBOTS_DISALLOW_ALL, 200);

  // 4. Preview state, checked on EVERY request (disable / expiry / reset apply immediately, bounded by the tiny state cache).
  let gate;
  try {
    gate = await store.gate(subdomain);
  } catch {
    log({ event: "preview_lookup_failed", subdomain });
    return page(targetUnavailablePage(), 503);
  }
  if (gate.state === "missing") return page(notFoundPage(), 404);
  if (gate.state !== "ok") return page(unavailablePage(), 503);

  const cookieName = sessionCookieName(secure);

  // 5. Login / logout endpoints.
  if (path === LOGIN_PATH) {
    if (method !== "POST") return page(accessPage(), 405, { allow: "POST" });
    return handleLogin(request, subdomain, previewOrigin, deps, now, log);
  }
  if (path === LOGOUT_PATH && method === "POST") {
    const res = new Response(null, { status: 303, headers: privateHeaders(new Headers({ location: "/" })) });
    res.headers.append("set-cookie", clearSessionCookie(cookieName, secure));
    return res;
  }
  if (path.startsWith("/__preview/")) return page(notFoundPage(), 404);

  // 6. Session: signed, bound to this preview, this subdomain and the current session generation.
  const session = verifySession(
    readCookie(request.headers.get("cookie"), cookieName),
    config.sessionSecret,
    { pid: gate.id, sub: subdomain, ver: gate.sessionVersion },
    now(),
  );
  if (!session.ok) {
    const next = method === "GET" ? `${path}${url.search}` : "/";
    const res = page(accessPage({ next }), 401);
    // A cookie that no longer validates (reset / expired / tampered) is removed.
    if (request.headers.get("cookie")?.includes(cookieName)) res.headers.append("set-cookie", clearSessionCookie(cookieName, secure));
    return res;
  }

  // 7. Authorised: resolve the target (never exposed to the browser) and proxy.
  let targetRaw: string | null;
  try {
    targetRaw = await store.target(gate.id, gate.sessionVersion);
  } catch {
    return page(targetUnavailablePage(), 503);
  }
  if (!targetRaw) return page(unavailablePage(), 503);
  const target = validateTargetUrl(targetRaw, { blockedDomains: [config.baseDomain] });
  if (!target.ok) {
    log({ event: "preview_target_rejected", subdomain, id: gate.id });
    return page(targetUnavailablePage(), 502);
  }

  const ctx = { targetOrigin: target.origin, previewOrigin };
  // Built by concatenation, never by resolving the visitor's path against the origin (blocks "//evil.com" tricks).
  const upstreamUrl = new URL(`${target.origin}${path}${url.search}`);
  if (upstreamUrl.origin !== target.origin) return page(notFoundPage(), 400);

  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_REQUEST_BODY_BYTES) return text("Payload too large", 413);
    const buffer = Buffer.from(await request.arrayBuffer());
    if (buffer.length > MAX_REQUEST_BODY_BYTES) return text("Payload too large", 413);
    body = buffer.length > 0 ? buffer : undefined;
  }

  let upstream: UpstreamResponse;
  try {
    upstream = await deps.fetchUpstream({
      url: upstreamUrl,
      method,
      headers: buildUpstreamHeaders(request.headers, ctx),
      body,
    });
  } catch (error) {
    const kind = (error as { kind?: string }).kind;
    log({ event: "preview_upstream_failed", subdomain, id: gate.id, kind: kind ?? "unknown" });
    return page(targetUnavailablePage(), kind === "timeout" ? 504 : 502);
  }

  // 8. Build the visitor's response.
  const { headers, cookies } = rewriteResponseHeaders(upstream.headers, upstreamUrl, ctx);
  privateHeaders(headers);
  for (const c of cookies) headers.append("set-cookie", c);

  const contentType = headers.get("content-type") ?? undefined;
  const status = upstream.status;
  const noBody = method === "HEAD" || status === 204 || status === 304 || (status >= 300 && status < 400);
  const length = Number(upstream.headers["content-length"] ?? "NaN");
  const encoded = Boolean(upstream.headers["content-encoding"]) && upstream.headers["content-encoding"] !== "identity";

  if (noBody) {
    upstream.body.resume();
    return new Response(null, { status, headers });
  }

  const rewritable =
    isRewritableContentType(contentType) && !encoded && status !== 206 && !(Number.isFinite(length) && length > MAX_REWRITE_BYTES);
  if (rewritable) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of upstream.body) {
      size += (chunk as Buffer).length;
      if (size > MAX_REWRITE_BYTES) {
        upstream.body.destroy();
        return page(targetUnavailablePage(), 502);
      }
      chunks.push(chunk as Buffer);
    }
    const rewritten = rewriteBodyText(Buffer.concat(chunks).toString("utf8"), ctx);
    return new Response(rewritten, { status, headers });
  }

  if (Number.isFinite(length)) headers.set("content-length", String(length));
  return new Response(Readable.toWeb(upstream.body) as ReadableStream, { status, headers });
}

async function handleLogin(
  request: Request,
  subdomain: string,
  previewOrigin: string,
  deps: GatewayDeps,
  now: () => Date,
  log: (event: Record<string, unknown>) => void,
): Promise<Response> {
  const { config, store } = deps;
  const secure = config.production;

  // CSRF: a login must come from this very page. A real Origin must match exactly; browsers send "null"
  // or nothing under some referrer policies, so then require the browser's own same-origin signals.
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const fetchSite = request.headers.get("sec-fetch-site");
  const refererOk = Boolean(referer && referer.startsWith(`${previewOrigin}/`));
  const sameOrigin = origin && origin !== "null" ? origin === previewOrigin : fetchSite === "same-origin" || refererOk;
  if (!sameOrigin) return text("Forbidden", 403);

  const raw = await request.text();
  if (raw.length > 4096) return text("Payload too large", 413);
  const form = new URLSearchParams(raw);
  const code = (form.get("code") ?? "").trim();
  const next = safeNextPath(form.get("next"));

  const ipHash = createHash("sha256").update(`${config.ipSalt}:${clientIp(request.headers)}`).digest("hex");

  let outcome;
  try {
    outcome = await store.verify(subdomain, code, ipHash);
  } catch {
    log({ event: "preview_login_error", subdomain });
    return page(targetUnavailablePage(), 503);
  }

  if (outcome.result === "ok") {
    log({ event: "preview_login", subdomain, id: outcome.id, outcome: "success" });
    const exp = sessionExpiry(now(), outcome.sessionTtlHours, outcome.expiresAt);
    const iat = Math.floor(now().getTime() / 1000);
    const token = signSession(
      { pid: outcome.id, sub: subdomain, ver: outcome.sessionVersion, iat, exp },
      config.sessionSecret!,
    );
    const res = new Response(null, { status: 303, headers: privateHeaders(new Headers({ location: next })) });
    res.headers.append("set-cookie", serializeSessionCookie(sessionCookieName(secure), token, exp - iat, secure));
    return res;
  }

  if (outcome.result === "missing") return page(notFoundPage(), 404);
  if (outcome.result === "unavailable") return page(unavailablePage(), 503);
  if (outcome.result === "limited") {
    log({ event: "preview_login", subdomain, outcome: "rate_limited" });
    return page(accessPage({ error: "limited", next }), 429, { "retry-after": "900" });
  }
  log({ event: "preview_login", subdomain, outcome: "denied" });
  return page(accessPage({ error: "invalid", next }), 401);
}
