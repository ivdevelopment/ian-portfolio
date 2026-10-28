/**
 * Central site configuration. Replace placeholder values here — nothing
 * else in the codebase hard-codes the site name, URL or contact details.
 */
export const siteConfig = {
  name: "Ian Verlinden",
  initials: "IV",
  title: "Ian Verlinden — Web design & development",
  description:
    "I design and develop high-quality websites and web applications that look great, perform well and help businesses grow.",
  // TODO(P1): set NEXT_PUBLIC_SITE_URL in the deployment environment.
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  locale: "en_BE",
  location: "Belgium",
  // TODO: replace with the real contact address.
  email: "hello@ianverlinden.example",
  /** Static so prerendering never depends on the current time. */
  copyrightYear: 2026,
  availability: "Available for new projects",
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
