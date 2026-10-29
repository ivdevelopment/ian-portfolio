/**
 * Decides, from a site's response headers, whether a browser will let `origin`
 * frame it. Pure so it can be tested without a network.
 */
export function isFramingAllowed(
  headers: { xFrameOptions?: string | null; contentSecurityPolicy?: string | null },
  origin: string,
): boolean {
  const xfo = headers.xFrameOptions?.trim().toLowerCase();
  // DENY / SAMEORIGIN (and the obsolete ALLOW-FROM) all stop a cross-origin framer.
  if (xfo && /^(deny|sameorigin|allow-from)/.test(xfo)) return false;

  const csp = headers.contentSecurityPolicy;
  if (csp) {
    // Several policies may arrive comma-joined; every one that sets frame-ancestors must allow us.
    for (const policy of csp.split(",")) {
      const directive = policy
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.toLowerCase().startsWith("frame-ancestors"));
      if (!directive) continue;
      const sources = directive.split(/\s+/).slice(1).map((s) => s.toLowerCase());
      const ours = new URL(origin);
      const allowed = sources.some(
        (s) =>
          s === "*" ||
          s === ours.origin.toLowerCase() ||
          s === `${ours.protocol}` ||
          (s.startsWith("*.") && ours.hostname.endsWith(s.slice(1))),
      );
      if (!allowed) return false;
    }
  }
  return true;
}

/** Only public https sites are probed: never loopback, private ranges or IP literals. */
export function isProbeableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return false;
  }
  // IPv4 / IPv6 literals.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":")) return false;
  return true;
}
