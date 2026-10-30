import type { Metadata } from "next";
import { hreflang, locales, ogLocale, type Locale } from "@/i18n/config";
import { localizeHref } from "@/i18n/paths";

/** Canonical + hreflang alternates for one logical page. Dutch is the x-default. */
export function localeAlternates(locale: Locale, path: string): NonNullable<Metadata["alternates"]> {
  return {
    canonical: localizeHref(locale, path),
    languages: {
      ...Object.fromEntries(locales.map((l) => [hreflang[l], localizeHref(l, path)])),
      "x-default": localizeHref("nl", path),
    },
  };
}

/** Site-wide share card for a language (see /og/[locale]). */
export const ogImageFor = (locale: Locale) => [{ url: `/og/${locale}`, width: 1200, height: 630 }];

/**
 * Metadata for a public page. A page-level `openGraph` replaces the layout's
 * entirely, so everything a share card needs is restated here: canonical (the
 * page's own language), hreflang alternates, Open Graph and Twitter card.
 */
export function pageMetadata({
  locale,
  title,
  description,
  path,
  images,
}: {
  locale: Locale;
  title: string;
  description: string;
  path: string;
  images?: { url: string; alt?: string }[];
}): Metadata {
  const shared = images ?? ogImageFor(locale);
  const url = localizeHref(locale, path);
  return {
    title,
    description,
    alternates: localeAlternates(locale, path),
    openGraph: { type: "website", url, locale: ogLocale[locale], title, description, images: shared },
    twitter: { card: "summary_large_image", title, description, images: shared },
  };
}
