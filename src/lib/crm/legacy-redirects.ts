import { crmOrigin } from "./host";

/**
 * Where the CRM screens that used to live in the website admin are now. Used to retire /admin/prospects, /admin/quotes and
 * /admin/settings/quotes by redirecting them to the CRM host once it is verified in production.
 *
 * Deliberately NOT mapped: the export / import-api route handlers (only ever called by the pages that now live in the CRM), the
 * Zoho connection pages (managing the connection stays in the website admin), projects, previews, reviews, inquiries and media.
 */
const EXACT: Record<string, string> = {
  "/admin/prospects": "/prospects",
  "/admin/prospects/kanban": "/pipeline",
  "/admin/prospects/new": "/prospects/new",
  "/admin/prospects/import": "/prospects/import",
  "/admin/quotes": "/quotes",
  "/admin/quotes/new": "/quotes/new",
  "/admin/quotes/templates": "/quotes/templates",
  "/admin/settings/quotes": "/settings",
};

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PROSPECT = new RegExp(`^/admin/prospects/(${ID})(/edit)?$`, "i");
const QUOTE = new RegExp(`^/admin/quotes/(${ID})(/edit|/pdf)?$`, "i");

/** The CRM path for a legacy admin path (no host, no query), or null when the path is not a CRM screen. */
export function legacyCrmPath(pathname: string): string | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (EXACT[clean]) return EXACT[clean];
  const prospect = PROSPECT.exec(clean);
  if (prospect) return `/prospects/${prospect[1]}${prospect[2] ?? ""}`;
  const quote = QUOTE.exec(clean);
  if (quote) return `/quotes/${quote[1]}${quote[2] ?? ""}`;
  return null;
}

/** Absolute redirect target on the CRM host (query string kept), or null. */
export function legacyCrmRedirect(pathname: string, search: string, env: Record<string, string | undefined> = process.env): string | null {
  const path = legacyCrmPath(pathname);
  return path ? `${crmOrigin(env)}${path}${search}` : null;
}

/** Off by default: the redirects are switched on (CRM_LEGACY_REDIRECTS=1) only after the CRM has been verified in production. */
export function legacyRedirectsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CRM_LEGACY_REDIRECTS === "1";
}
