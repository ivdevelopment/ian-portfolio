import Link from "next/link";
import { siteConfig } from "@/config/site";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="text-xl font-medium tracking-tight">{siteConfig.name}</p>
          <p className="mt-3 max-w-sm text-muted">
            Web design and development for ambitious brands, from {siteConfig.location}.
          </p>
        </div>

        <nav aria-label="Footer">
          <p className="text-xs font-medium tracking-[0.18em] text-subtle uppercase">
            Explore
          </p>
          <ul className="mt-4 space-y-2.5">
            {siteConfig.nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-muted transition-colors hover:text-ink"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-subtle uppercase">
            Get in touch
          </p>
          <ul className="mt-4 space-y-2.5 text-muted">
            <li>
              <a
                href={`mailto:${siteConfig.email}`}
                className="transition-colors hover:text-ink"
              >
                {siteConfig.email}
              </a>
            </li>
            <li>{siteConfig.location}</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="container-page flex flex-col gap-2 py-6 text-sm text-subtle sm:flex-row sm:justify-between">
          <p>
            © {siteConfig.copyrightYear} {siteConfig.name}. All rights reserved.
          </p>
          <p>Designed and built with Next.js.</p>
        </div>
      </div>
    </footer>
  );
}
