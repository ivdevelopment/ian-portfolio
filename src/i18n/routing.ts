import { defaultLocale, LOCALE_COOKIE, type Locale } from "./config";
import { stripLocale } from "./paths";

export type RoutingDecision =
  | { type: "next" }
  | { type: "redirect"; path: string; status: 307 | 308; noStore?: boolean }
  | { type: "rewrite"; path: string };

/**
 * Pure routing rules for the public site (used by the proxy and unit tests).
 * Dutch (default) has no prefix: "/about" is rewritten internally to "/nl/about".
 * English is served from "/en/...". An explicit "/nl/..." is normalised to the
 * bare path with a permanent redirect so the Dutch site has one canonical URL.
 * Only a bare "/" visit honours a remembered English choice (cookie): explicit
 * URLs always win, and nothing is ever detected from Accept-Language.
 */
export function decideLocaleRoute(
  pathname: string,
  search: string,
  cookieLocale: string | undefined,
): RoutingDecision {
  const { locale, path, prefixed } = stripLocale(pathname);

  if (prefixed && locale === defaultLocale) {
    return { type: "redirect", path: `${path}${search}`, status: 308 };
  }
  if (prefixed) return { type: "next" };

  if (pathname === "/" && cookieLocale === "en") {
    return { type: "redirect", path: `/en${search}`, status: 307, noStore: true };
  }
  return { type: "rewrite", path: `/${defaultLocale}${pathname === "/" ? "" : pathname}` };
}

export { LOCALE_COOKIE };
export type { Locale };
