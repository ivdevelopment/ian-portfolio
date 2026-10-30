"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOCALE_COOKIE, locales, type Locale } from "@/i18n/config";
import { useDictionary, useLocale } from "@/i18n/context";
import { fmt } from "@/i18n/dictionaries";
import { switchLocalePath } from "@/i18n/paths";
import { cn } from "@/lib/utils";

/** Remembers an explicit choice for a year. Only read for bare "/" visits (see proxy). */
function rememberChoice(locale: Locale) {
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    // Cookies blocked: the URL still carries the language.
  }
}

/**
 * Compact NL / EN switch. Keeps the current page; marks the active language for assistive tech.
 * The current path is only known at runtime, so the prerendered fallback links to each language's home.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  return (
    <Suspense fallback={<SwitcherView pathname="/" className={className} />}>
      <SwitcherWithPath className={className} />
    </Suspense>
  );
}

function SwitcherWithPath({ className }: { className?: string }) {
  return <SwitcherView pathname={usePathname() ?? "/"} className={className} />;
}

function SwitcherView({ pathname, className }: { pathname: string; className?: string }) {
  const active = useLocale();
  const dict = useDictionary();

  return (
    <nav aria-label={dict.language.label} className={className}>
      <ul className="flex items-center gap-0.5 rounded-full border border-line p-0.5 text-xs font-medium tracking-wide">
        {locales.map((locale) => {
          const isActive = locale === active;
          const name = dict.language[locale];
          return (
            <li key={locale}>
              <Link
                href={switchLocalePath(pathname, locale)}
                hrefLang={locale === "nl" ? "nl-BE" : "en"}
                lang={locale === "nl" ? "nl-BE" : "en"}
                aria-current={isActive ? "true" : undefined}
                aria-label={isActive ? fmt(dict.language.current, { language: name }) : fmt(dict.language.switchTo, { language: name })}
                onClick={() => rememberChoice(locale)}
                // The locale prefix changes the page: do a full navigation so the root layout (<html lang>) updates.
                prefetch={false}
                className={cn(
                  "inline-flex h-7 min-w-9 items-center justify-center rounded-full px-2.5 uppercase transition-colors duration-300",
                  isActive ? "bg-accent-soft text-ink" : "text-muted hover:text-ink",
                )}
              >
                {locale}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
