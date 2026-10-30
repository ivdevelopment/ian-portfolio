"use client";

import Link from "next/link";
import { useOptionalLocale } from "./context";
import { localizeHref } from "./paths";

/** next/link that keeps visitors in their language: internal hrefs get the locale prefix (English only). */
export function LocaleLink({ href, ...props }: React.ComponentProps<typeof Link>) {
  // Outside the localized site (the admin) links are left exactly as written.
  const locale = useOptionalLocale();
  const resolved = locale && typeof href === "string" ? localizeHref(locale, href) : href;
  return <Link href={resolved} {...props} />;
}
