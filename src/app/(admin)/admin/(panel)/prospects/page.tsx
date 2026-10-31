import Link from "next/link";
import { ProspectList } from "@/components/admin/prospect-list";
import { AdminPageHeader } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/button";
import { brusselsToday } from "@/lib/prospects/dates";
import { parseFilters } from "@/lib/prospects/filters";
import { formatEur } from "@/lib/prospects/money";
import { getSummary, listProspects, listSectors } from "@/lib/prospects/queries";

export default async function AdminProspectsPage({ searchParams }: PageProps<"/admin/prospects">) {
  const filters = parseFilters(await searchParams);
  const today = brusselsToday();

  const [{ rows, total }, summary, sectors] = await Promise.all([listProspects(filters, today), getSummary(today), listSectors()]);
  const due = summary.followups_overdue + summary.followups_today;

  const cards: Array<{ label: string; value: string; hint?: string; href?: string }> = [
    { label: "Total prospects", value: String(summary.total) },
    { label: "Contacted", value: String(summary.contacted) },
    { label: "Replies", value: String(summary.replies), href: "/admin/prospects?replied=1" },
    { label: "Active opportunities", value: String(summary.active_opportunities) },
    {
      label: "Follow-ups due",
      value: String(due),
      hint: summary.followups_overdue > 0 ? `${summary.followups_overdue} overdue` : undefined,
      href: due > 0 ? "/admin/prospects?followup=overdue" : undefined,
    },
    {
      label: "Pipeline value",
      value: summary.pipeline_count > 0 ? formatEur(summary.pipeline_value) : "—",
      hint: summary.pipeline_count > 0 ? `${summary.pipeline_count} with a value` : "No estimates yet",
    },
  ];

  return (
    <>
      <AdminPageHeader
        title="Prospects"
        description="Your website-sales pipeline: who you contacted, who replied and what to do next."
        actions={
          <>
            <ButtonLink href="/admin/prospects/import" variant="secondary" size="sm" icon="none">
              Import
            </ButtonLink>
            <ButtonLink href="/admin/prospects/new" size="sm" icon="none">
              New prospect
            </ButtonLink>
          </>
        }
      />

      <dl className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => {
          const body = (
            <>
              <dd className="text-xl font-medium tabular-nums">{c.value}</dd>
              <dt className="mt-0.5 text-xs text-muted">{c.label}</dt>
              {c.hint && <p className="mt-0.5 text-xs text-subtle">{c.hint}</p>}
            </>
          );
          return c.href ? (
            <Link key={c.label} href={c.href} className="rounded-card border border-line bg-glass p-3.5 transition-colors hover:border-line-strong">
              {body}
            </Link>
          ) : (
            <div key={c.label} className="rounded-card border border-line bg-glass p-3.5">
              {body}
            </div>
          );
        })}
      </dl>

      <ProspectList rows={rows} total={total} filters={filters} sectors={sectors} today={today} />
    </>
  );
}
