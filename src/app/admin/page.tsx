import { adminModules } from "@/components/admin/admin-modules";
import { getPublishedProjects } from "@/lib/projects";
import { getPublishedReviews } from "@/lib/reviews";

export default function AdminDashboardPage() {
  const counts = [
    { label: "Projects", value: getPublishedProjects().length },
    { label: "Reviews", value: getPublishedReviews().length },
    { label: "New inquiries", value: 0 },
    { label: "Draft projects", value: 0 },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-title">Dashboard</h1>
      <p className="mt-2 text-muted">
        Admin shell — the CMS arrives in the next milestone.
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counts.map((c) => (
          <div key={c.label} className="glass flex flex-col-reverse rounded-card p-5">
            <dt className="mt-1 text-sm text-muted">{c.label}</dt>
            <dd className="text-title">{c.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-subtle">
        Counts reflect local placeholder data, not a database.
      </p>

      <h2 className="mt-12 text-lg font-medium">Planned modules</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {adminModules.map((mod) => (
          <li key={mod.id} className="glass flex gap-4 rounded-card p-5">
            <mod.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
            <div>
              <p className="flex items-center gap-2 font-medium">
                {mod.label}
                <span className="rounded-full border border-line px-2 py-0.5 text-[0.7rem] tracking-wide text-subtle uppercase">
                  {mod.milestone}
                </span>
              </p>
              <p className="mt-1 text-sm text-muted">{mod.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
