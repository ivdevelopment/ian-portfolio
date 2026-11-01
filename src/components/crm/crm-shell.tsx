import { ExternalLink } from "lucide-react";
import { crmSignOutAction } from "@/crm/actions/auth";
import { siteAdminOrigin } from "@/lib/crm/host";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { CrmMobileNav } from "./crm-mobile-nav";
import { CrmNav } from "./crm-nav";
import Link from "next/link";

/**
 * The CRM workspace shell: a quiet sidebar (navy, no glass) and a content column. Below 768px the sidebar is a drawer.
 * It is deliberately plainer than the public site and the website admin: this is a daily tool.
 */
export function CrmShell({ email, children }: { email?: string; children: React.ReactNode }) {
  const site = siteAdminOrigin();
  const footer = (
    <div className="space-y-3 text-sm">
      <ul className="space-y-1.5">
        <li>
          <a href={`${site}/admin`} className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-ink">
            Website admin <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </li>
        <li>
          <a href={site} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-ink">
            Public site <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </li>
      </ul>
      <div className="border-t border-line pt-3">
        {email && (
          <p className="mb-2 truncate text-xs text-subtle" title={email}>
            {email}
          </p>
        )}
        <form action={crmSignOutAction}>
          <SignOutButton variant="sidebar" />
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
        <Link href="/" className="flex h-16 items-center gap-2.5 px-5">
          <span className="text-lg font-medium tracking-tight">IV</span>
          <span className="text-sm text-muted">CRM</span>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <CrmNav />
        </div>
        <div className="border-t border-line p-4">{footer}</div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur md:hidden">
          <CrmMobileNav>{footer}</CrmMobileNav>
          <Link href="/" className="text-sm font-medium tracking-tight">
            Ian Verlinden CRM
          </Link>
        </header>
        <div className="px-4 py-6 sm:px-8 md:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function CrmShellSkeleton() {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]" aria-busy="true">
      <aside className="hidden border-r border-line bg-surface md:block" />
      <div className="px-4 py-6 sm:px-8 md:py-8">
        <div className="h-7 w-40 animate-pulse rounded-md bg-glass-strong motion-reduce:animate-none" />
      </div>
    </div>
  );
}
