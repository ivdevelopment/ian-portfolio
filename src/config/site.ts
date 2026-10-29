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
  locale: "en_BE",
  /** Static so prerendering never depends on the current time. */
  copyrightYear: 2026,
  nav: [
    { label: "Home", href: "/" },
    { label: "Work", href: "/work" },
    { label: "Services", href: "/services" },
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
  ],
  cta: { label: "Start a project", href: "/contact" },
} as const;

export type NavItem = (typeof siteConfig.nav)[number];
