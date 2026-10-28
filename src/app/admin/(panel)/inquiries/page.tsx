import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { INQUIRY_STATUSES, inquiryStatusSchema } from "@/lib/schemas/inquiry";
import { INQUIRY_STATUS_LABELS, InquiryStatusBadge } from "@/components/admin/inquiry-status";
import { AdminPageHeader, EmptyState, formatDateTime } from "@/components/admin/ui";
import { cn } from "@/lib/utils";

export default async function AdminInquiriesPage({
  searchParams,
}: PageProps<"/admin/inquiries">) {
  const { supabase } = await requireAdmin();
  const query = await searchParams;
  const parsedFilter = inquiryStatusSchema.safeParse(
    Array.isArray(query.status) ? query.status[0] : query.status,
  );
  const filter = parsedFilter.success ? parsedFilter.data : null;

  // Explicit columns: the rate-limit hash is never selected.
  let request = supabase
    .from("inquiries")
    .select("id, name, email, project_type, budget, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter) request = request.eq("status", filter);

  const { data, error } = await request;
  if (error) {
    console.error("[admin] failed to list inquiries:", error.message);
    throw new Error("Inquiries unavailable");
  }
  const inquiries = data ?? [];

  const tabs: Array<{ label: string; value: string | null }> = [
    { label: "All", value: null },
    ...INQUIRY_STATUSES.map((s) => ({ label: INQUIRY_STATUS_LABELS[s], value: s })),
  ];

  return (
    <>
      <AdminPageHeader title="Inquiries" description="Project requests from the contact form." />

      <nav aria-label="Filter by status" className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.value === filter;
          return (
            <Link
              key={tab.label}
              href={tab.value ? `/admin/inquiries?status=${tab.value}` : "/admin/inquiries"}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                active
                  ? "border-accent/50 bg-accent-soft text-ink"
                  : "border-line text-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {inquiries.length === 0 ? (
        <EmptyState>{filter ? "No inquiries with this status." : "No inquiries yet."}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-glass">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-subtle">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Project type</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Budget</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Received</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {inquiries.map((q) => (
                <tr key={q.id} className="relative transition-colors hover:bg-glass-strong">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/inquiries/${q.id}`}
                      className="block font-medium after:absolute after:inset-0 hover:text-accent"
                    >
                      {q.name}
                    </Link>
                    <span className="block text-xs text-subtle">{q.email}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{q.project_type}</td>
                  <td className="px-4 py-2.5 text-muted">{q.budget}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                    {formatDateTime(q.created_at)}
                  </td>
                  <td className="px-4 py-2.5">
                    <InquiryStatusBadge status={q.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
