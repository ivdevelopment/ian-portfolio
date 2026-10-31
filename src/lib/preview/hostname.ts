import { RESERVED_SUBDOMAINS, SUBDOMAIN_PATTERN } from "./subdomain";

export type HostOptions = {
  /** e.g. "ianverlinden.com" */
  baseDomain: string;
  /** Development only: also treat "<name>.localhost" as a preview host. */
  allowLocalhost?: boolean;
};

const BASE_DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function isValidBaseDomain(value: string): boolean {
  return value.length <= 253 && BASE_DOMAIN_PATTERN.test(value);
}

/**
 * Extracts the preview subdomain from a Host header, or null when this is not a preview host.
 * The Host header is attacker-controlled, so it is validated strictly: one `<label>.<baseDomain>`
 * and nothing else (no credentials, paths, spaces, extra labels, IP literals or odd ports).
 * The apex, `www` and every reserved name are NOT preview hosts.
 */
export function parsePreviewHost(hostHeader: string | null | undefined, options: HostOptions): string | null {
  if (!hostHeader || hostHeader.length > 255) return null;
  const host = hostHeader.toLowerCase();

  // Optional :port (digits only).
  const match = /^([a-z0-9.-]+?)(?::(\d{1,5}))?$/.exec(host);
  if (!match) return null;
  const hostname = match[1].replace(/\.$/, "");

  const bases = [options.baseDomain.toLowerCase()];
  if (options.allowLocalhost) bases.push("localhost");

  for (const base of bases) {
    if (!isValidBaseDomain(base) && base !== "localhost") continue;
    const suffix = `.${base}`;
    if (!hostname.endsWith(suffix)) continue;
    const label = hostname.slice(0, -suffix.length);
    if (!SUBDOMAIN_PATTERN.test(label)) return null; // also rejects "a.b" (nested labels)
    if (RESERVED_SUBDOMAINS.includes(label)) return null;
    return label;
  }
  return null;
}
