"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Search, Trash2, X } from "lucide-react";
import { bulkDeleteAction, bulkUpdateAction, deleteProspectAction } from "@/app/(admin)/admin/(panel)/prospects/actions";
import { Button } from "@/components/ui/button";
import {
  PAGE_SIZES,
  PRIORITY_LABELS,
  PROSPECT_PRIORITIES,
  PROSPECT_STATUSES,
  STATUS_LABELS,
  type SortKey,
} from "@/lib/prospects/constants";
import { formatEur } from "@/lib/prospects/money";
import { formatDay } from "@/lib/prospects/dates";
import { DEFAULT_FILTERS, FOLLOW_UP_FILTERS, defaultDir, FOLLOW_UP_FILTER_LABELS, filtersToParams, hasActiveFilters, type ProspectFilters } from "@/lib/prospects/filters";
import type { ProspectRecord } from "@/lib/prospects/types";
import { cn } from "@/lib/utils";
import { AdminSelect } from "./admin-select";
import { ConfirmDialog } from "./confirm-dialog";
import { ExportButton, ExportDialog } from "./prospect-export-dialog";
import { PREVIEW_OPTIONS, previewChoice, previewPatch } from "./prospect-board-filters";
import { DeliveryBadge, FollowUpCell, PriorityBadge, ProspectStatusBadge, iconButton } from "./prospect-ui";
import { EmptyState, adminInput } from "./ui";

export type ListRow = Omit<ProspectRecord, "notes">;

const ALL = "__all";
const EMPTY_SELECTION: Set<string> = new Set();
const STATUS_OPTIONS = [{ value: ALL, label: "All statuses" }, ...PROSPECT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))];
const PRIORITY_OPTIONS = [{ value: ALL, label: "All priorities" }, ...PROSPECT_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))];
const FOLLOW_UP_OPTIONS = [{ value: ALL, label: "Any follow-up" }, ...FOLLOW_UP_FILTERS.map((f) => ({ value: f, label: FOLLOW_UP_FILTER_LABELS[f] }))];
const PER_PAGE_OPTIONS = PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} per page` }));

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "created", label: "Created" },
  { value: "company", label: "Company" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "follow_up", label: "Next follow-up" },
  { value: "first_contact", label: "First contact" },
  { value: "last_contact", label: "Last contact" },
  { value: "estimated", label: "Estimated value" },
  { value: "quote", label: "Quote value" },
];

type Props = {
  rows: ListRow[];
  total: number;
  filters: ProspectFilters;
  sectors: string[];
  today: string;
};

export function ProspectList({ rows, total, filters, sectors, today }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNavigation] = useTransition();
  // The selection belongs to one result set: when the filters, page or sort change it is simply not applied any more.
  const [selection, setSelection] = useState<{ query: string; ids: Set<string> }>({ query: "", ids: new Set() });
  const [search, setSearch] = useState(filters.q);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "row" | "bulk"; id?: string; name?: string } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  const query = filtersToParams(filters).toString();
  const pages = Math.max(1, Math.ceil(total / filters.per));

  const go = (next: Partial<ProspectFilters>, resetPage = true) => {
    const merged = { ...filters, ...next, page: resetPage ? 1 : (next.page ?? filters.page) };
    const params = filtersToParams(merged).toString();
    startNavigation(() => router.replace(params ? `${pathname}?${params}` : pathname, { scroll: false }));
  };

  // Debounced, server-backed search: the URL follows the box 300 ms after typing stops.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (search.trim() === filters.q) return;
    const timer = window.setTimeout(() => go({ q: search.trim() }), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const selected = selection.query === query ? selection.ids : EMPTY_SELECTION;
  const setSelected = (next: Set<string> | ((current: Set<string>) => Set<string>)) =>
    setSelection((current) => {
      const base = current.query === query ? current.ids : EMPTY_SELECTION;
      return { query, ids: typeof next === "function" ? next(base) : next };
    });

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const ids = useMemo(() => [...selected], [selected]);

  const sortBy = (key: SortKey) => go({ sort: key, dir: filters.sort === key ? (filters.dir === "asc" ? "desc" : "asc") : defaultDir(key) });

  const runDelete = () => {
    if (!confirm) return;
    setConfirmError(null);
    startAction(async () => {
      const result = confirm.kind === "row" ? await deleteProspectAction(confirm.id!) : await bulkDeleteAction(ids);
      if (!result.ok) return setConfirmError(result.error);
      setConfirm(null);
      setSelected(new Set());
      setMessage(confirm.kind === "bulk" && "count" in result ? `Deleted ${result.count} prospects.` : "Prospect deleted.");
      router.refresh();
    });
  };

  const runBulk = (change: Parameters<typeof bulkUpdateAction>[1], doneLabel: string) =>
    startAction(async () => {
      setMessage(null);
      const result = await bulkUpdateAction(ids, change);
      if (!result.ok) return setMessage(result.error);
      setMessage(`${doneLabel} (${result.count}).`);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {/* Search and filters */}
      <div className="rounded-card border border-line bg-glass p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, email, contact, sector, city, website…"
              aria-label="Search prospects"
              className={cn(adminInput, "h-10 pl-9")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton onClick={() => setExportOpen(true)} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-7">
          <AdminSelect id="f-status" value={filters.status ?? ALL} onChange={(v) => go({ status: v === ALL ? null : (v as ProspectFilters["status"]) })} options={STATUS_OPTIONS} />
          <AdminSelect
            id="f-sector"
            value={filters.sector ?? ALL}
            onChange={(v) => go({ sector: v === ALL ? null : v })}
            options={[{ value: ALL, label: "All sectors" }, ...sectors.map((s) => ({ value: s, label: s }))]}
          />
          <AdminSelect id="f-priority" value={filters.priority ?? ALL} onChange={(v) => go({ priority: v === ALL ? null : (v as ProspectFilters["priority"]) })} options={PRIORITY_OPTIONS} />
          <AdminSelect id="f-followup" value={filters.followup ?? ALL} onChange={(v) => go({ followup: v === ALL ? null : (v as ProspectFilters["followup"]) })} options={FOLLOW_UP_OPTIONS} />
          <AdminSelect id="f-preview" value={previewChoice(filters)} onChange={(v) => go(previewPatch(v as Parameters<typeof previewPatch>[0]))} options={PREVIEW_OPTIONS} />
          <AdminSelect id="f-sort" value={filters.sort} onChange={(v) => go({ sort: v as SortKey, dir: defaultDir(v as SortKey) })} options={SORT_OPTIONS} />
          <AdminSelect id="f-per" value={String(filters.per)} onChange={(v) => go({ per: Number(v) as ProspectFilters["per"] })} options={PER_PAGE_OPTIONS} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {(
            [
              ["replied", "Has replied"],
              ["project", "Has project"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 text-muted">
              <input type="checkbox" className="size-4 accent-[var(--color-accent-strong)]" checked={filters[key]} onChange={(e) => go({ [key]: e.target.checked })} />
              {label}
            </label>
          ))}
          <button type="button" onClick={() => go({ dir: filters.dir === "asc" ? "desc" : "asc" })} className="inline-flex items-center gap-1 text-muted hover:text-ink">
            {filters.dir === "asc" ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" />}
            {filters.dir === "asc" ? "Ascending" : "Descending"}
          </button>
          {hasActiveFilters(filters) && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                go({ ...DEFAULT_FILTERS, sort: filters.sort, dir: filters.dir, per: filters.per });
              }}
              className="ml-auto inline-flex items-center gap-1 text-muted hover:text-ink"
            >
              <X aria-hidden className="size-3.5" /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          busy={busy}
          onStatus={(status) => runBulk({ kind: "status", status }, "Status updated")}
          onPriority={(priority) => runBulk({ kind: "priority", priority }, "Priority updated")}
          onFollowUp={(day) => runBulk({ kind: "follow_up", day }, day ? "Follow-up set" : "Follow-up cleared")}
          onExport={() => setExportOpen(true)}
          onDelete={() => setConfirm({ kind: "bulk" })}
          onClear={() => setSelected(new Set())}
        />
      )}
      <p role="status" aria-live="polite" className="min-h-5 px-1 text-sm text-muted">
        {message}
      </p>

      {rows.length === 0 ? (
        <EmptyState>{hasActiveFilters(filters) ? "No prospects match these filters." : "No prospects yet. Add one or import your tracker."}</EmptyState>
      ) : (
        <>
          {/* Desktop table */}
          <div className={cn("hidden overflow-x-auto rounded-card border border-line bg-glass xl:block", navigating && "opacity-70")}>
            <table className="w-full min-w-[62rem] text-left text-sm">
              <thead className="border-b border-line text-xs text-subtle">
                <tr>
                  <th className="w-10 py-2.5 pl-4">
                    <input type="checkbox" aria-label="Select all on this page" className="size-4 accent-[var(--color-accent-strong)]" checked={allOnPage} onChange={toggleAll} />
                  </th>
                  <Th label="Company" sortKey="company" filters={filters} onSort={sortBy} />
                  <Th label="Status" sortKey="status" filters={filters} onSort={sortBy} />
                  <th className="px-3 py-2.5 font-normal">Sector</th>
                  <th className="px-3 py-2.5 font-normal">City</th>
                  <Th label="Next follow-up" sortKey="follow_up" filters={filters} onSort={sortBy} />
                  <Th label="Est. value" sortKey="estimated" filters={filters} onSort={sortBy} align="right" />
                  <Th label="Priority" sortKey="priority" filters={filters} onSort={sortBy} />
                  <th className="px-3 py-2.5 font-normal">Last activity</th>
                  <th className="w-28 py-2.5 pr-4 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className={cn("align-top hover:bg-glass-strong/40", selected.has(r.id) && "bg-accent-soft/40")}>
                    <td className="py-3 pl-4">
                      <input type="checkbox" aria-label={`Select ${r.company_name}`} className="size-4 accent-[var(--color-accent-strong)]" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="max-w-64 px-3 py-3">
                      <Link href={`/admin/prospects/${r.id}`} className="block truncate font-medium hover:text-accent">
                        {r.company_name}
                      </Link>
                      {r.email && <span className="block truncate text-xs text-subtle">{r.email}</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <ProspectStatusBadge status={r.status} />
                        <DeliveryBadge status={r.contact_delivery_status} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted">{r.sector ?? "—"}</td>
                    <td className="px-3 py-3 text-muted">{r.city ?? "—"}</td>
                    <td className="px-3 py-3">
                      <FollowUpCell day={r.next_follow_up_on} status={r.status} today={today} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{formatEur(r.estimated_value_eur)}</td>
                    <td className="px-3 py-3">
                      <PriorityBadge priority={r.priority} />
                    </td>
                    <td className="max-w-48 px-3 py-3 text-xs text-muted">
                      {r.last_activity_title ? (
                        <>
                          <span className="block truncate text-sm">{r.last_activity_title}</span>
                          <span className="text-subtle">{formatDay(r.last_activity_on)}</span>
                        </>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <RowActions row={r} onDelete={() => setConfirm({ kind: "row", id: r.id, name: r.company_name })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile and tablet cards */}
          <ul className={cn("space-y-2 xl:hidden", navigating && "opacity-70")}>
            {rows.map((r) => (
              <li key={r.id} className={cn("rounded-card border border-line bg-glass p-3", selected.has(r.id) && "border-accent/50")}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" aria-label={`Select ${r.company_name}`} className="mt-1 size-4 accent-[var(--color-accent-strong)]" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/prospects/${r.id}`} className="block truncate font-medium hover:text-accent">
                      {r.company_name}
                    </Link>
                    <p className="truncate text-xs text-subtle">{[r.sector, r.city].filter(Boolean).join(" · ") || "—"}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <ProspectStatusBadge status={r.status} />
                      <PriorityBadge priority={r.priority} />
                      <DeliveryBadge status={r.contact_delivery_status} />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <dt className="text-subtle">Next follow-up</dt>
                        <dd className="mt-0.5">
                          <FollowUpCell day={r.next_follow_up_on} status={r.status} today={today} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-subtle">Est. value</dt>
                        <dd className="mt-0.5 text-muted">{formatEur(r.estimated_value_eur)}</dd>
                      </div>
                    </dl>
                  </div>
                  <RowActions row={r} onDelete={() => setConfirm({ kind: "row", id: r.id, name: r.company_name })} />
                </div>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <span>
              {(filters.page - 1) * filters.per + 1}–{Math.min(total, filters.page * filters.per)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" icon="none" disabled={filters.page <= 1} onClick={() => go({ page: filters.page - 1 }, false)}>
                Previous
              </Button>
              <span className="tabular-nums">
                Page {filters.page} / {pages}
              </span>
              <Button variant="secondary" size="sm" icon="none" disabled={filters.page >= pages} onClick={() => go({ page: filters.page + 1 }, false)}>
                Next
              </Button>
            </div>
          </nav>
        </>
      )}

      <ExportDialog key={`${query}:${exportOpen}`} open={exportOpen} onClose={() => setExportOpen(false)} query={query} selectedIds={ids} filtersActive={hasActiveFilters(filters)} />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "bulk" ? `Delete ${selected.size} prospects?` : `Delete ${confirm?.name ?? "prospect"}?`}
        confirmLabel="Delete"
        pending={busy}
        error={confirmError}
        onConfirm={runDelete}
        onClose={() => setConfirm(null)}
      >
        This permanently deletes {confirm?.kind === "bulk" ? "the selected prospects" : "this prospect"} and their activity history. Linked projects and
        client previews are not deleted.
      </ConfirmDialog>
    </div>
  );
}

function Th({ label, sortKey, filters, onSort, align }: { label: string; sortKey: SortKey; filters: ProspectFilters; onSort: (k: SortKey) => void; align?: "right" }) {
  const active = filters.sort === sortKey;
  return (
    <th className={cn("whitespace-nowrap px-3 py-2.5 font-normal", align === "right" && "text-right")} aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(sortKey)} className={cn("inline-flex items-center gap-1 hover:text-ink", active && "text-ink")}>
        {label}
        {active && (filters.dir === "asc" ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" />)}
      </button>
    </th>
  );
}

function RowActions({ row, onDelete }: { row: ListRow; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Link href={`/admin/prospects/${row.id}`} className={iconButton} aria-label={`Open ${row.company_name}`} title="Open">
        <ExternalLink aria-hidden className="size-4" />
      </Link>
      <Link href={`/admin/prospects/${row.id}/edit`} className={iconButton} aria-label={`Edit ${row.company_name}`} title="Edit">
        <Pencil aria-hidden className="size-4" />
      </Link>
      <button type="button" className={cn(iconButton, "hover:border-danger/50 hover:text-danger")} aria-label={`Delete ${row.company_name}`} title="Delete" onClick={onDelete}>
        <Trash2 aria-hidden className="size-4" />
      </button>
    </div>
  );
}

function BulkBar({
  count,
  busy,
  onStatus,
  onPriority,
  onFollowUp,
  onExport,
  onDelete,
  onClear,
}: {
  count: number;
  busy: boolean;
  onStatus: (s: string) => void;
  onPriority: (p: string) => void;
  onFollowUp: (day: string | null) => void;
  onExport: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [status, setStatus] = useState<string>(PROSPECT_STATUSES[0]);
  const [priority, setPriority] = useState<string>("normal");
  const [day, setDay] = useState("");
  return (
    <div className="glass-strong rounded-card p-3" role="region" aria-label="Bulk actions">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="text-sm font-medium">{count} selected</p>
        <div className="flex items-center gap-2">
          <div className="w-44">
            <AdminSelect id="bulk-status" value={status} onChange={setStatus} options={STATUS_OPTIONS.slice(1)} />
          </div>
          <Button variant="secondary" size="sm" icon="none" disabled={busy} onClick={() => onStatus(status)}>
            Set status
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-36">
            <AdminSelect id="bulk-priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS.slice(1)} />
          </div>
          <Button variant="secondary" size="sm" icon="none" disabled={busy} onClick={() => onPriority(priority)}>
            Set priority
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" aria-label="Follow-up date" value={day} onChange={(e) => setDay(e.target.value)} className={cn(adminInput, "h-10 w-40 [color-scheme:dark]")} />
          <Button variant="secondary" size="sm" icon="none" disabled={busy || !day} onClick={() => onFollowUp(day)}>
            Set follow-up
          </Button>
          <Button variant="secondary" size="sm" icon="none" disabled={busy} onClick={() => onFollowUp(null)}>
            Clear follow-up
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" icon="none" onClick={onExport}>
            Export selected
          </Button>
          <Button variant="secondary" size="sm" icon="none" disabled={busy} onClick={onDelete} className="text-danger">
            <Trash2 aria-hidden className="size-4" /> Delete
          </Button>
          <button type="button" onClick={onClear} className="text-sm text-muted hover:text-ink">
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
