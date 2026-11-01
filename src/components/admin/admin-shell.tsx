import Link from "next/link";
import { siteConfig } from "@/config/site";
import { signOutAction } from "@/app/(admin)/admin/login/actions";
import { AdminNav } from "./admin-nav";
import { SignOutButton } from "./sign-out-button";

/** Chrome for the signed-in admin area: sidebar, account and sign-out. */
export function AdminShell({
  email,
  children,
}: {
  email?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14.5rem_1fr]">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-r md:border-b-0">
        <div className="flex h-14 items-center justify-between px-5 md:h-16">
          <Link href="/admin" className="text-lg font-medium tracking-tight">
            {siteConfig.initials}
            <span className="ml-2 text-sm font-normal text-muted">Admin</span>
          </Link>
          <Link href="/" className="text-sm text-muted transition-colors hover:text-ink">
            View site
          </Link>
        </div>
        <div className="md:flex-1 md:overflow-y-auto">
          <AdminNav />
        </div>
        <div className="hidden border-t border-line p-4 md:block">
          {email && (
            <p className="truncate text-xs text-subtle" title={email}>
              {email}
            </p>
          )}
          <form action={signOutAction} className="mt-2">
            <SignOutButton variant="sidebar" />
          </form>
        </div>
      </aside>

      <div className="min-w-0 px-4 py-6 sm:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
        <form action={signOutAction} className="mt-10 md:hidden">
          <SignOutButton variant="inline" />
        </form>
      </div>
    </div>
  );
}

export function AdminShellSkeleton() {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14.5rem_1fr]" aria-busy="true">
      <aside className="hidden border-r border-line bg-surface md:block" />
      <div className="px-4 py-6 sm:px-8 md:py-8">
        <div className="h-7 w-40 animate-pulse rounded-md bg-glass-strong" />
      </div>
    </div>
  );
}
