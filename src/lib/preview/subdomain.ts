/**
 * Preview subdomains are a single hostname label ("geertkips" for geertkips.ianverlinden.com).
 * The same rules are enforced again by a CHECK constraint in the database.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "www", "admin", "api", "mail", "webmail", "smtp", "imap", "pop", "mx", "ns", "ns1", "ns2",
  "dns", "ftp", "cpanel", "autodiscover", "autoconfig", "zmail", "en", "nl", "review",
  "reviews", "work", "contact", "about", "services", "app", "dashboard", "login", "preview",
  "previews", "gateway", "staging", "dev", "test", "cdn", "static", "assets", "media",
  "status", "support", "help", "docs", "blog", "shop", "crm",
];

/** One DNS label: lowercase letters, digits and inner hyphens, 1-63 characters. */
export const SUBDOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeSubdomain(raw: string): string {
  return raw.trim().toLowerCase();
}

export type SubdomainCheck = { ok: true; value: string } | { ok: false; error: string };

export function validateSubdomain(raw: string): SubdomainCheck {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: "Enter a subdomain." };
  if (value !== value.toLowerCase()) return { ok: false, error: "Use lowercase letters only." };
  if (value.includes(".")) return { ok: false, error: "Enter a single name without dots (e.g. geertkips)." };
  if (value.length > 63) return { ok: false, error: "A subdomain is at most 63 characters." };
  if (!SUBDOMAIN_PATTERN.test(value)) {
    return {
      ok: false,
      error: "Use only letters, numbers and hyphens, and don't start or end with a hyphen.",
    };
  }
  // "xx--" in positions 3-4 is reserved for internationalised (punycode) names.
  if (value.slice(2, 4) === "--") return { ok: false, error: "That name format is reserved." };
  if (RESERVED_SUBDOMAINS.includes(value)) return { ok: false, error: "That name is reserved." };
  return { ok: true, value };
}
