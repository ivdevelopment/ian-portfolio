import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { LocaleLink } from "@/i18n/locale-link";
import { stripLocale } from "@/i18n/paths";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

/**
 * Presentational list of primary links. Rendered on the server as the
 * Suspense fallback and by the client-side active-link wrapper.
 * `pathname` is the visible URL path; the locale prefix is ignored when matching.
 */
export function NavLinkList({ pathname, locale }: { pathname?: string; locale: Locale }) {
  const dict = getDictionary(locale);
  const current = pathname === undefined ? undefined : stripLocale(pathname).path;

  return (
    <ul className="flex items-center gap-1">
      {siteConfig.nav.map((item) => {
        const active =
          current !== undefined &&
          (item.href === "/"
            ? current === "/"
            : current === item.href || current.startsWith(`${item.href}/`));
        return (
          <li key={item.href}>
            <LocaleLink
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative rounded-full px-3.5 py-2 text-sm transition-colors duration-300",
                active ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              {dict.nav[item.key]}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-3.5 -bottom-0.5 h-px origin-left bg-accent transition-transform duration-500 ease-out-soft",
                  active ? "scale-x-100" : "scale-x-0",
                )}
              />
            </LocaleLink>
          </li>
        );
      })}
    </ul>
  );
}
