import Link from "next/link";
import { Suspense } from "react";
import { siteConfig } from "@/config/site";
import { ButtonLink } from "@/components/ui/button";
import { ActiveNavLinks } from "@/components/navigation/active-nav-links";
import { MobileMenu } from "@/components/navigation/mobile-menu";
import { NavLinkList } from "@/components/navigation/nav-link-list";
import { NavbarShell } from "@/components/navigation/navbar-shell";

export function Navbar() {
  return (
    <NavbarShell>
      <div className="container-page flex h-(--nav-h) items-center justify-between gap-6">
        <Link
          href="/"
          aria-label={`${siteConfig.name} — home`}
          className="text-xl font-medium tracking-tight text-ink"
        >
          {siteConfig.initials}
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
          <Suspense fallback={<NavLinkList />}>
            <ActiveNavLinks />
          </Suspense>
          <ButtonLink href={siteConfig.cta.href} variant="soft" size="sm">
            {siteConfig.cta.label}
          </ButtonLink>
        </nav>

        <MobileMenu />
      </div>
    </NavbarShell>
  );
}
