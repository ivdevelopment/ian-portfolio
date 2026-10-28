import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { adminModules } from "@/components/admin/admin-modules";

export const metadata: Metadata = {
  title: { absolute: `Admin — ${siteConfig.name}` },
  robots: { index: false, follow: false },
};

/**
 * Admin shell. Intentionally separate from the public site chrome.
 * TODO(P1): call `requireAdmin()` from "@/lib/auth" here once Supabase Auth exists.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-surface md:min-h-dvh md:border-r md:border-b-0">
        <div className="flex h-16 items-center justify-between px-5 md:h-20">
          <Link href="/admin" className="text-xl font-medium tracking-tight">
            {siteConfig.initials}
            <span className="ml-2 text-sm font-normal text-muted">Admin</span>
          </Link>
          <Link href="/" className="text-sm text-muted transition-colors hover:text-ink">
            View site
          </Link>
        </div>
        <nav aria-label="Admin modules" className="no-scrollbar overflow-x-auto px-3 pb-3 md:pb-6">
          <ul className="flex gap-1 md:flex-col">
            {adminModules.map((mod, i) => (
              <li key={mod.id}>
                <span
                  aria-disabled="true"
                  aria-current={i === 0 ? "page" : undefined}
                  className={
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm whitespace-nowrap " +
                    (i === 0 ? "bg-glass-strong text-ink" : "text-muted")
                  }
                >
                  <mod.icon aria-hidden className="size-4" />
                  {mod.label}
                </span>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="px-5 py-8 sm:px-10 md:py-12">{children}</div>
    </div>
  );
}
