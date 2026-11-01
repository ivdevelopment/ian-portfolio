import { Suspense } from "react";
import { CrmShell, CrmShellSkeleton } from "@/components/crm/crm-shell";
import { requireAdmin } from "@/lib/auth";

/** Everything in the CRM except the login page. Authorisation (membership in admin_users) is re-checked here and by every page, action and route handler. */
export const instant = false;

export default function CrmAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<CrmShellSkeleton />}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}

async function Gate({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return <CrmShell email={admin.email}>{children}</CrmShell>;
}
