import { defaultLocale, isLocale, locales, type Locale } from "./config";

/** Paths that exist once, outside the locale tree. */
const UNLOCALIZED = /^\/(admin|api|_next|og)(\/|$)/;

export function isUnlocalizedPath(pathname: string): boolean {
  return UNLOCALIZED.test(pathname);
}

/** True for paths we can prefix: internal, absolute-path hrefs ("/work", "/work/x#y", "/?a=b"). */
function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.includes("\\");
}

/**
 * Href for `locale`. Dutch (default) keeps the bare path; English gets /en.
 * External URLs, hash-only links and admin/api paths are returned unchanged.
 */
export function localizeHref(locale: Locale, href: string): string {
  if (!isInternalHref(href)) return href;
  const { path, suffix } = splitSuffix(href);
  if (isUnlocalizedPath(path)) return href;
  // Never double-prefix a path that already carries a locale.
  const bare = stripLocale(path).path;
  if (locale === defaultLocale) return `${bare}${suffix}`;
  return `/${locale}${bare === "/" ? "" : bare}${suffix}`;
}

function splitSuffix(href: string): { path: string; suffix: string } {
  const i = href.search(/[?#]/);
  return i === -1 ? { path: href, suffix: "" } : { path: href.slice(0, i), suffix: href.slice(i) };
}

/** Splits "/en/work/x" into { locale: "en", path: "/work/x" }; unprefixed paths are Dutch. */
export function stripLocale(pathname: string): { locale: Locale; path: string; prefixed: boolean } {
  const [, first, ...rest] = pathname.split("/");
  if (isLocale(first)) {
    return { locale: first, path: `/${rest.join("/")}`.replace(/\/+$/, "") || "/", prefixed: true };
  }
  return { locale: defaultLocale, path: pathname || "/", prefixed: false };
}

/** The same logical page in another language (hash/query preserved by the caller). */
export function switchLocalePath(pathname: string, target: Locale): string {
  return localizeHref(target, stripLocale(pathname).path);
}

/** Absolute URLs of one page in every language, for hreflang and the sitemap. */
export function absoluteAlternates(origin: string, path: string): Record<Locale, string> {
  const base = origin.replace(/\/+$/, "");
  return Object.fromEntries(
    locales.map((l) => [l, `${base}${localizeHref(l, path) === "/" ? "" : localizeHref(l, path)}`]),
  ) as Record<Locale, string>;
}
