import Link from "next/link";
import { siteConfig } from "@/config/site";
import { getSiteSettings } from "@/lib/site-content";

export async function Footer() {
  const s = await getSiteSettings();
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
            Web design and development for ambitious brands{s.location ? `, from ${s.location}` : ""}.
          </p>
        </div>

        <nav aria-label="Footer">
          <p className="text-xs font-medium tracking-[0.18em] text-subtle uppercase">Explore</p>
          <ul className="mt-4 space-y-2.5">
            {siteConfig.nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-muted transition-colors hover:text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/reviews" className="text-muted transition-colors hover:text-ink">
                Reviews
              </Link>
            </li>
          </ul>
        </nav>

        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-subtle uppercase">Get in touch</p>
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
          <p>
            © {siteConfig.copyrightYear} {s.displayName}. All rights reserved.
          </p>
          <p>Designed and built with Next.js.</p>
        </div>
      </div>
    </footer>
  );
}
