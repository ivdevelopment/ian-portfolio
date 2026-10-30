import { Suspense } from "react";
import { AdminShell, AdminShellSkeleton } from "@/components/admin/admin-shell";
import { requireAdmin } from "@/lib/auth";

/**
 * The admin area is entirely request-time (cookies + database) behind a login,
 * so it is allowed to block rather than prerender a shell.
 */
export const instant = false;

/**
 * Everything under /admin except /admin/login. The proxy already redirects
 * visitors without a session; this is the authoritative check (membership in
 * `admin_users`). Pages and server actions re-check on their own, because a
 * layout does not re-run on every client navigation.
 */
export default function PanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AdminShellSkeleton />}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}

async function Gate({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return <AdminShell email={admin.email}>{children}</AdminShell>;
}
