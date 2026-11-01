/**
 * The CRM is served by this same application on its own hostname (crm.ianverlinden.com). These rules decide which requests belong
 * to it. The Host header is attacker-controlled, so it is validated strictly (exact hostname, optional numeric port, nothing else).
 *
 * Isolation:
 *  - the CRM host serves ONLY the CRM route tree (internally /crm/*) and never the public site, /admin, /api or the preview gateway;
 *  - every other host (apex, www, preview hosts, *.vercel.app) answers 404 for /crm/*;
 *  - the dedicated preview-gateway deployment never serves the CRM (it answers nothing but preview hosts).
 */

export const DEFAULT_CRM_HOST = "crm.ianverlinden.com";
/** The internal path prefix of the CRM route tree. The URL the user sees has no prefix. */
export const CRM_PREFIX = "/crm";
/** Set by the proxy on requests it routed to the CRM tree (cosmetic: link targets and login redirects only, never authorisation). */
export const CRM_APP_HEADER = "x-crm-app";

type Env = Record<string, string | undefined>;

const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/** The configured CRM hostname (CRM_HOST, default crm.ianverlinden.com). Development may use crm.localhost. */
export function crmHostname(env: Env = process.env): string {
  const configured = env.CRM_HOST?.trim().toLowerCase();
  return configured && configured.length <= 253 && HOSTNAME.test(configured) ? configured : DEFAULT_CRM_HOST;
}

export function isCrmHost(hostHeader: string | null | undefined, env: Env = process.env): boolean {
  if (!hostHeader || hostHeader.length > 255) return false;
  const match = /^([a-z0-9.-]+?)(?::(\d{1,5}))?$/.exec(hostHeader.toLowerCase());
  if (!match) return false;
  const hostname = match[1].replace(/\.$/, "");
  if (hostname === crmHostname(env)) return true;
  // Local development only: http://crm.localhost:3000
  return env.NODE_ENV !== "production" && hostname === "crm.localhost";
}

/** Is this internal path inside the CRM route tree? (/crm or /crm/…, not /crmx). */
export function isCrmTreePath(pathname: string): boolean {
  return pathname === CRM_PREFIX || pathname.startsWith(`${CRM_PREFIX}/`);
}

/** URL path the visitor sees -> internal path of the CRM tree: "/" -> "/crm", "/prospects/1" -> "/crm/prospects/1". */
export function toCrmTreePath(pathname: string): string {
  return pathname === "/" ? CRM_PREFIX : `${CRM_PREFIX}${pathname}`;
}

/** Canonical origins for cross-links between the two applications. */
export function crmOrigin(env: Env = process.env): string {
  const configured = env.NEXT_PUBLIC_CRM_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `https://${crmHostname(env)}`;
}

export function siteAdminOrigin(env: Env = process.env): string {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return (/^https?:\/\//i.test(configured) ? configured : `https://${configured}`).replace(/\/+$/, "");
  return "https://ianverlinden.com";
}
