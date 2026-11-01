"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { PRIORITY_LABELS, PROSPECT_PRIORITIES, PROSPECT_STATUSES, STATUS_LABELS } from "@/lib/prospects/constants";
import { FOLLOW_UP_FILTERS, FOLLOW_UP_FILTER_LABELS, filtersToParams, hasActiveFilters, type ProspectFilters } from "@/lib/prospects/filters";
import { rememberPreference } from "@/lib/prospects/preference-cookie";
import { cn } from "@/lib/utils";
import { AdminSelect } from "./admin-select";
import { adminInput } from "./ui";

const ALL = "__all";
const VIEW_COOKIE = "prospects_view";

/** List | Kanban. The choice is remembered (cookie) so /admin/prospects opens in the view you last used. */
export function ViewToggle({ current, query }: { current: "list" | "kanban"; query: string }) {
  const q = query ? `?${query}` : "";
  const remember = (view: string) => {
    rememberPreference(VIEW_COOKIE, view);
  };
  const base = "rounded-full px-4 py-1.5 text-sm transition-colors";
  return (
    <nav aria-label="Prospect view" className="inline-flex rounded-full border border-line bg-glass p-1">
      <Link href={`/admin/prospects${q ? `${q}&view=list` : "?view=list"}`} aria-current={current === "list" ? "page" : undefined} onClick={() => remember("list")} className={cn(base, current === "list" ? "bg-accent-strong text-white" : "text-muted hover:text-ink")}>
        List
      </Link>
      <Link href={`/admin/prospects/kanban${q}`} aria-current={current === "kanban" ? "page" : undefined} onClick={() => remember("kanban")} className={cn(base, current === "kanban" ? "bg-accent-strong text-white" : "text-muted hover:text-ink")}>
        Kanban
      </Link>
    </nav>
  );
}

type PreviewChoice = "any" | "has" | "viewed" | "unviewed";
export const previewChoice = (f: Pick<ProspectFilters, "preview" | "viewed">): PreviewChoice =>
  f.viewed === "yes" ? "viewed" : f.viewed === "no" ? "unviewed" : f.preview ? "has" : "any";
export const previewPatch = (c: PreviewChoice): Pick<ProspectFilters, "preview" | "viewed"> =>
  c === "viewed" ? { preview: false, viewed: "yes" } : c === "unviewed" ? { preview: false, viewed: "no" } : { preview: c === "has", viewed: null };

export const PREVIEW_OPTIONS = [
  { value: "any", label: "Any preview" },
  { value: "has", label: "Has preview" },
  { value: "viewed", label: "Preview viewed" },
  { value: "unviewed", label: "Not viewed yet" },
];

/** The board shares the list's filters (and URL parameters); sorting and paging don't apply to a board. */
export function BoardFilterBar({ filters, sectors }: { filters: ProspectFilters; sectors: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startNavigation] = useTransition();
  const [search, setSearch] = useState(filters.q);

  const go = (next: Partial<ProspectFilters>) => {
    const params = filtersToParams({ ...filters, ...next, page: 1 }).toString();
    startNavigation(() => router.replace(params ? `${pathname}?${params}` : pathname, { scroll: false }));
  };

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

  return (
    <div className="rounded-card border border-line bg-glass p-3">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, email, contact, sector, city, website…" aria-label="Search prospects" className={cn(adminInput, "h-10 pl-9")} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <AdminSelect id="b-status" value={filters.status ?? ALL} onChange={(v) => go({ status: v === ALL ? null : (v as ProspectFilters["status"]) })} options={[{ value: ALL, label: "All statuses" }, ...PROSPECT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))]} />
        <AdminSelect id="b-sector" value={filters.sector ?? ALL} onChange={(v) => go({ sector: v === ALL ? null : v })} options={[{ value: ALL, label: "All sectors" }, ...sectors.map((s) => ({ value: s, label: s }))]} />
        <AdminSelect id="b-priority" value={filters.priority ?? ALL} onChange={(v) => go({ priority: v === ALL ? null : (v as ProspectFilters["priority"]) })} options={[{ value: ALL, label: "All priorities" }, ...PROSPECT_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))]} />
        <AdminSelect id="b-followup" value={filters.followup ?? ALL} onChange={(v) => go({ followup: v === ALL ? null : (v as ProspectFilters["followup"]) })} options={[{ value: ALL, label: "Any follow-up" }, ...FOLLOW_UP_FILTERS.map((f) => ({ value: f, label: FOLLOW_UP_FILTER_LABELS[f] }))]} />
        <AdminSelect id="b-preview" value={previewChoice(filters)} onChange={(v) => go(previewPatch(v as PreviewChoice))} options={PREVIEW_OPTIONS} />
      </div>
      {hasActiveFilters(filters) && (
        <button
          type="button"
          onClick={() => {
            setSearch("");
            go({ q: "", status: null, sector: null, priority: null, followup: null, replied: false, preview: false, project: false, viewed: null });
          }}
          className="mt-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
        >
          <X aria-hidden className="size-3.5" /> Clear filters
        </button>
      )}
    </div>
  );
}
