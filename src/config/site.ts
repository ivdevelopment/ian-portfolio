import { resolveSiteUrl } from "@/lib/site-url";

/**
 * Central site configuration. Replace placeholder values here — nothing
 * else in the codebase hard-codes the site name, URL or contact details.
 */
export const siteConfig = {
  name: "Ian Verlinden",
  initials: "IV",
  /** Public origin. See `resolveSiteUrl` for the resolution order. */
  url: resolveSiteUrl(process.env),
  /** Static so prerendering never depends on the current time. */
  copyrightYear: 2026,
  /** Labels come from the dictionary (dict.nav[key]); hrefs are locale-neutral paths. */
  nav: [
    { key: "home", href: "/" },
    { key: "work", href: "/work" },
    { key: "services", href: "/services" },
    { key: "about", href: "/about" },
    { key: "contact", href: "/contact" },
  ],
  cta: { key: "cta", href: "/contact" },
} as const;

export type NavItem = (typeof siteConfig.nav)[number];
