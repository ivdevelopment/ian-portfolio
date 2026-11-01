import { connection } from "next/server";
import { Suspense } from "react";
import { FollowUpRow } from "@/components/crm/follow-up-row";
import { AdminPageHeader, EmptyState, Panel } from "@/components/admin/ui";
import { TableSkeleton } from "@/components/ui/loading";
import { getFollowUps } from "@/crm/queries/dashboard";
import { brusselsToday } from "@/lib/prospects/dates";

export default function FollowUpsPage() {
  return (
    <>
      <AdminPageHeader title="Follow-ups" description="Who to contact next. Only active prospects are listed; nothing is sent automatically." />
      <Suspense fallback={<TableSkeleton rows={6} filters={false} />}>
        <Sections />
      </Suspense>
    </>
  );
}

async function Sections() {
  await connection();
  const today = brusselsToday();
  const f = await getFollowUps(today);
  const sections = [
    { id: "overdue", title: "Overdue", rows: f.overdue, tone: "text-danger", empty: "Nothing overdue." },
    { id: "today", title: "Today", rows: f.today, tone: "", empty: "Nothing due today." },
    { id: "week", title: "This week", rows: f.thisWeek, tone: "", empty: "Nothing else planned this week." },
    { id: "later", title: "Later", rows: f.later, tone: "", empty: "Nothing planned further ahead." },
    { id: "none", title: "No follow-up scheduled", rows: f.unscheduled, tone: "text-muted", empty: "Every active conversation has a next step." },
  ];
  if (sections.every((s) => s.rows.length === 0)) return <EmptyState>No active prospects to follow up.</EmptyState>;
  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <Panel key={s.id} title={`${s.title} (${s.rows.length})`}>
          {s.rows.length === 0 ? (
            <p className="text-sm text-subtle">{s.empty}</p>
          ) : (
            <ul className="divide-y divide-line" aria-label={s.title}>
              {s.rows.map((r) => (
                <FollowUpRow key={r.id} item={r} today={today} />
              ))}
            </ul>
          )}
        </Panel>
      ))}
    </div>
  );
}
