/** Suffixes that can only mean "internal" or "not a real public website". */
const BLOCKED_SUFFIXES = [
  ".localhost", ".local", ".internal", ".lan", ".home", ".home.arpa", ".intranet", ".corp",
  ".private", ".localdomain", ".test", ".invalid", ".example", ".onion", ".arpa",
];

export type TargetCheck =
  | { ok: true; origin: string; hostname: string; value: string }
  | { ok: false; error: string };

/**
 * Validates the website a preview points at (SSRF guard, first layer).
 *
 * Rules: https only, no credentials, no non-standard port, a real public DNS
 * name (no IP literals in any notation, no localhost/internal suffixes), the
 * site root only (no path, query or hash), and never this site or the preview
 * domain itself (which would loop the gateway into itself).
 *
 * This is checked when the preview is saved AND again on every request; the
 * resolved IP address is additionally checked at connection time (see
 * `safe-fetch.ts`), which defeats DNS rebinding.
 */
export function validateTargetUrl(raw: string, opts: { blockedDomains?: string[] } = {}): TargetCheck {
  const input = raw.trim();
  if (input.length === 0) return { ok: false, error: "Enter the website this preview should show." };
  if (input.length > 500) return { ok: false, error: "That URL is too long." };
  if (/[\s\u0000-\u001f\\]/.test(input)) return { ok: false, error: "That doesn't look like a valid URL." };

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }

  if (url.protocol !== "https:") return { ok: false, error: "Use a secure https:// URL." };
  if (url.username || url.password) return { ok: false, error: "The URL can't contain a username or password." };
  if (url.port && url.port !== "443") return { ok: false, error: "Only the standard https port is allowed." };
  if (url.search || url.hash) return { ok: false, error: "Use the site address only (no query or #fragment)." };
  if (url.pathname !== "/" && url.pathname !== "") {
    return { ok: false, error: "Use the site address only, without a path (e.g. https://example.com)." };
  }

  // WHATWG parsing already canonicalises decimal/hex/octal IPv4 into dotted form and wraps IPv6 in [].
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) return { ok: false, error: "That doesn't look like a valid URL." };
  // (Pure JS on purpose: this module also runs in the browser form, where node:net does not exist.)
  if (hostname.startsWith("[") || hostname.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return { ok: false, error: "Use a website name, not an IP address." };
  }
  const labels = hostname.split(".");
  if (labels.length < 2) return { ok: false, error: "Use a full public website name (e.g. example.com)." };
  // A purely numeric last label can only be an IPv4 variant.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(labels[labels.length - 1])) {
    return { ok: false, error: "Use a website name, not an IP address." };
  }
  if (hostname === "localhost" || BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return { ok: false, error: "Local and internal addresses are not allowed." };
  }
  if (!/^[a-z0-9.-]+$/.test(hostname) || labels.some((l) => l.length === 0 || l.length > 63 || l.startsWith("-") || l.endsWith("-"))) {
    return { ok: false, error: "That doesn't look like a valid website name." };
  }

  for (const domain of opts.blockedDomains ?? []) {
    const d = domain.toLowerCase();
    if (hostname === d || hostname.endsWith(`.${d}`)) {
      return { ok: false, error: "A preview can't point back at this site." };
    }
  }

  const origin = `https://${hostname}`;
  return { ok: true, origin, hostname, value: origin };
}
