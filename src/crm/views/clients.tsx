import Link from "next/link";
import { Suspense } from "react";
import { AdminPageHeader, EmptyState } from "@/components/admin/ui";
import { TableSkeleton } from "@/components/ui/loading";
import { getClients } from "@/crm/queries/dashboard";
import { getPaths } from "@/lib/crm/server-paths";
import { formatDay } from "@/lib/prospects/dates";
import { formatCents } from "@/lib/quotes/money";

export default function ClientsPage() {
  return (
    <>
      <AdminPageHeader title="Clients" description="Prospects that were won. A client is the same record as the prospect it came from; nothing is copied." />
      <Suspense fallback={<TableSkeleton rows={4} filters={false} />}>
        <ClientList />
      </Suspense>
    </>
  );
}

async function ClientList() {
  const P = await getPaths();
  const clients = await getClients();
  if (clients.length === 0) return <EmptyState>No clients yet. A prospect becomes a client when you mark it as Won (or convert it to a project).</EmptyState>;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-card border border-line md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Clients</caption>
          <thead className="border-b border-line bg-glass text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-medium">Client</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Contact</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Project</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Accepted quotes</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Latest activity</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="border-b border-line/60 last:border-0 hover:bg-glass/60">
                <td className="px-3 py-2.5">
                  <Link href={P.prospect(c.id)} className="font-medium hover:text-accent">
                    {c.company}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-muted">{c.contact ?? c.email ?? "—"}</td>
                <td className="px-3 py-2.5">{c.projectTitle ?? <span className="text-subtle">—</span>}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{c.acceptedQuotes ? `${c.acceptedQuotes} · ${formatCents(c.acceptedNetCents)}` : <span className="text-subtle">—</span>}</td>
                <td className="px-3 py-2.5 text-muted">{c.lastActivity ? `${c.lastActivity}${c.lastActivityOn ? ` · ${formatDay(c.lastActivityOn)}` : ""}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden">
        {clients.map((c) => (
          <li key={c.id} className="rounded-card border border-line bg-glass p-4">
            <Link href={P.prospect(c.id)} className="font-medium hover:text-accent">
              {c.company}
            </Link>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <div>
                <dt className="text-xs text-muted">Contact</dt>
                <dd className="truncate">{c.contact ?? c.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Project</dt>
                <dd className="truncate">{c.projectTitle ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Accepted quotes</dt>
                <dd className="tabular-nums">{c.acceptedQuotes ? `${c.acceptedQuotes} · ${formatCents(c.acceptedNetCents)}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Latest activity</dt>
                <dd className="truncate">{c.lastActivity ?? "—"}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
