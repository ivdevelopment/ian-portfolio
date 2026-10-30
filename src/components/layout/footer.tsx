import { siteConfig } from "@/config/site";
import { fmt } from "@/i18n/dictionaries";
import { LocaleLink } from "@/i18n/locale-link";
import { getI18n } from "@/i18n/server";
import { getSiteSettings } from "@/lib/site-content";

export async function Footer() {
  const { locale, dict } = await getI18n();
  const s = await getSiteSettings(locale);
  const socials = [
    { label: "GitHub", href: s.githubUrl },
    { label: "LinkedIn", href: s.linkedinUrl },
    { label: "Instagram", href: s.instagramUrl },
    { label: "X", href: s.xUrl },
  ].filter((social) => social.href);

  return (
    <footer className="border-t border-line">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="text-xl font-medium tracking-tight">{s.displayName}</p>
          <p className="mt-3 max-w-sm text-muted">
            {s.location ? fmt(dict.footer.taglineFrom, { location: s.location }) : dict.footer.tagline}
          </p>
        </div>

        <nav aria-label={dict.nav.footer}>
          <p className="text-xs font-medium tracking-[0.18em] text-subtle uppercase">{dict.footer.explore}</p>
          <ul className="mt-4 space-y-2.5">
            {siteConfig.nav.map((item) => (
              <li key={item.href}>
                <LocaleLink href={item.href} className="text-muted transition-colors hover:text-ink">
                  {dict.nav[item.key]}
                </LocaleLink>
              </li>
            ))}
            <li>
              <LocaleLink href="/reviews" className="text-muted transition-colors hover:text-ink">
                {dict.nav.reviews}
              </LocaleLink>
            </li>
          </ul>
        </nav>

        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-subtle uppercase">{dict.footer.getInTouch}</p>
          <ul className="mt-4 space-y-2.5 text-muted">
            {s.contactEmail && (
              <li>
                <a href={`mailto:${s.contactEmail}`} className="transition-colors hover:text-ink">
                  {s.contactEmail}
                </a>
              </li>
            )}
            {s.location && <li>{s.location}</li>}
            {socials.map((social) => (
              <li key={social.label}>
                <a
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-ink"
                >
                  {social.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="container-page flex flex-col gap-2 py-6 text-sm text-subtle sm:flex-row sm:justify-between">
          <p>{fmt(dict.footer.rights, { year: siteConfig.copyrightYear, name: s.displayName })}</p>
          <p>{dict.footer.builtWith}</p>
        </div>
      </div>
    </footer>
  );
}
