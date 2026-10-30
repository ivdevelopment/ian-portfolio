import { Suspense } from "react";
import { siteConfig } from "@/config/site";
import { getI18n } from "@/i18n/server";
import { fmt } from "@/i18n/dictionaries";
import { getSiteSettings } from "@/lib/site-content";
import { ButtonLink } from "@/components/ui/button";
import { ActiveNavLinks } from "@/components/navigation/active-nav-links";
import { LanguageSwitcher } from "@/components/navigation/language-switcher";
import { MobileMenu } from "@/components/navigation/mobile-menu";
import { NavLinkList } from "@/components/navigation/nav-link-list";
import { NavbarShell } from "@/components/navigation/navbar-shell";
import { LocaleLink } from "@/i18n/locale-link";

export async function Navbar() {
  const { locale, dict } = await getI18n();
  const settings = await getSiteSettings(locale);
  return (
    <NavbarShell>
      <div className="container-page flex h-(--nav-h) items-center justify-between gap-6">
        <LocaleLink
          href="/"
          aria-label={fmt(dict.nav.homeAria, { name: settings.displayName })}
          className="text-xl font-medium tracking-tight text-ink"
        >
          {siteConfig.initials}
        </LocaleLink>

        <div className="hidden items-center gap-5 md:flex">
          <nav aria-label={dict.nav.primary} className="flex items-center gap-6">
            <Suspense fallback={<NavLinkList locale={locale} />}>
              <ActiveNavLinks />
            </Suspense>
            <ButtonLink href={siteConfig.cta.href} variant="soft" size="sm">
              {dict.nav.cta}
            </ButtonLink>
          </nav>
          <LanguageSwitcher />
        </div>

        <MobileMenu email={settings.contactEmail} />
      </div>
    </NavbarShell>
  );
}

