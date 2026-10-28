import Link from "next/link";
import { Star } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { invitationStatus, type InvitationStatus } from "@/lib/review-tokens";
import { REVIEW_STATUS_LABELS, reviewStatusSchema, type ReviewStatus } from "@/lib/schemas/review";
import { InvitationRowActions, InviteForm } from "@/components/admin/invitation-tools";
import { ReviewRowActions } from "@/components/admin/review-row-actions";
import { AdminPageHeader, Badge, EmptyState, formatDate, formatDateTime } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Published" },
  { key: "rejected", label: "Rejected" },
  { key: "archived", label: "Archived" },
  { key: "invitations", label: "Invitations" },
] as const;

const invitationTone: Record<InvitationStatus, "success" | "neutral" | "danger" | "warn"> = {
  active: "success",
  used: "neutral",
  revoked: "danger",
  expired: "warn",
};
const invitationLabel: Record<InvitationStatus, string> = {
  active: "Unused",
  used: "Used",
  revoked: "Revoked",
  expired: "Expired",
};

type ReviewRow = {
  id: string;
  name: string;
  company: string | null;
  rating: number;
  review_text: string;
  status: ReviewStatus;
  source: "admin" | "invitation";
  featured: boolean;
  submitted_at: string | null;
  created_at: string;
  projects: { title: string } | null;
};

export default async function AdminReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  const { supabase } = await requireAdmin();
  const query = await searchParams;
  const rawTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab = TABS.some((t) => t.key === rawTab) ? (rawTab as (typeof TABS)[number]["key"]) : "pending";

  const [reviewsRes, invitationsRes, projectsRes] = await Promise.all([
    supabase
      .from("reviews")
      .select("id, name, company, rating, review_text, status, source, featured, submitted_at, created_at, projects(title)")
      .order("created_at", { ascending: false })
      .limit(500),
    tab === "invitations"
      ? supabase
          .from("review_invitations")
          .select("id, client_name, email, expires_at, used_at, revoked_at, created_at, projects(title)")
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("projects").select("id, title").order("title"),
  ]);
  const failed = [reviewsRes, invitationsRes, projectsRes].find((r) => r.error);
  if (failed?.error) {
    console.error("[admin] reviews query failed:", failed.error.message);
    throw new Error("Reviews unavailable");
  }

  const reviews = reviewsRes.data as unknown as ReviewRow[];
  const counts = Object.fromEntries(
    (["pending", "approved", "rejected", "archived"] as const).map((s) => [s, reviews.filter((r) => r.status === s).length]),
  ) as Record<ReviewStatus, number>;
  const visible = tab === "invitations" ? [] : reviews.filter((r) => r.status === tab);

  return (
    <>
      <AdminPageHeader
        title="Reviews"
        description="Moderate client reviews and request new ones."
        actions={
          <ButtonLink href="/admin/reviews/new" size="sm" icon="none">
            + Add review
          </ButtonLink>
        }
      />

      <nav aria-label="Review views" className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto">
        {TABS.map((t) => {
          const active = t.key === tab;
          const count = t.key === "invitations" ? null : counts[t.key as ReviewStatus];
          return (
            <Link
              key={t.key}
              href={`/admin/reviews?tab=${t.key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                active ? "border-accent/50 bg-accent-soft text-ink" : "border-line text-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {t.label}
              {count !== null && <span className="ml-1.5 text-subtle tabular-nums">{count}</span>}
            </Link>
          );
        })}
      </nav>

      {tab === "invitations" ? (
        <div className="space-y-4">
          <InviteForm projects={projectsRes.data ?? []} />

          {(invitationsRes.data ?? []).length === 0 ? (
            <EmptyState>No invitations yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-card border border-line bg-glass">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="border-b border-line text-xs text-subtle">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">Client</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Project</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Created</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Expires</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">State</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(invitationsRes.data as unknown as Array<{
                    id: string;
                    client_name: string | null;
                    email: string | null;
                    expires_at: string;
                    used_at: string | null;
                    revoked_at: string | null;
                    created_at: string;
                    projects: { title: string } | null;
                  }>).map((inv) => {
                    const status = invitationStatus(inv, new Date());
                    const label = inv.client_name || inv.email || "this client";
                    return (
                      <tr key={inv.id}>
                        <td className="px-4 py-2.5">
                          <span className="block font-medium">{inv.client_name || "—"}</span>
                          {inv.email && <span className="block text-xs text-subtle">{inv.email}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-muted">{inv.projects?.title ?? "—"}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted">{formatDate(inv.created_at)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted">{formatDate(inv.expires_at)}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={invitationTone[status]}>{invitationLabel[status]}</Badge>
                          {inv.used_at && <span className="mt-1 block text-xs text-subtle">{formatDateTime(inv.used_at)}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <InvitationRowActions id={inv.id} label={label} status={status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState>
          {tab === "pending"
            ? "No reviews are waiting for approval."
            : `No ${REVIEW_STATUS_LABELS[reviewStatusSchema.parse(tab)].toLowerCase()} reviews.`}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-glass">
          {visible.map((r) => (
            <li key={r.id} className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[1fr_auto] lg:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span role="img" aria-label={`${r.rating} out of 5 stars`} className="inline-flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} aria-hidden className={cn("size-3.5", n <= r.rating ? "fill-accent text-accent" : "text-line-strong")} />
                    ))}
                    <span className="ml-1.5 text-xs text-muted tabular-nums">{r.rating}/5</span>
                  </span>
                  <Link href={`/admin/reviews/${r.id}/edit`} className="text-sm font-medium hover:text-accent">
                    {r.name}
                  </Link>
                  {r.company && <span className="text-xs text-muted">{r.company}</span>}
                  <Badge tone={r.status === "approved" ? "success" : r.status === "pending" ? "accent" : "neutral"}>
                    {REVIEW_STATUS_LABELS[r.status]}
                  </Badge>
                  {r.featured && <Badge tone="accent">Featured</Badge>}
                </div>
                <p className="mt-1.5 line-clamp-2 text-sm text-muted">{r.review_text}</p>
                <p className="mt-1.5 text-xs text-subtle">
                  {r.source === "invitation" ? "Via invitation" : "Added by admin"}
                  {r.projects ? ` · ${r.projects.title}` : ""}
                  {` · ${r.submitted_at ? `Submitted ${formatDate(r.submitted_at)}` : `Added ${formatDate(r.created_at)}`}`}
                </p>
              </div>
              <ReviewRowActions review={{ id: r.id, name: r.name, status: r.status, featured: r.featured }} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
