"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS } from "@/lib/quotes/constants";
import { quoteFiltersToParams, type QuoteFilters, type QuoteSort } from "@/lib/quotes/filters";
import { formatCents } from "@/lib/quotes/money";
import type { QuoteWithProspect } from "@/lib/quotes/types";
import { formatDay } from "@/lib/prospects/dates";
import { cn } from "@/lib/utils";
import { AdminSelect } from "./admin-select";
import { QuoteStatusBadge } from "./quote-ui";
import { EmptyState, adminInput } from "./ui";

const STATUS_OPTIONS = [{ value: "", label: "All statuses" }, ...QUOTE_STATUSES.map((s) => ({ value: s, label: QUOTE_STATUS_LABELS[s] }))];

const COLUMNS: Array<{ sort: QuoteSort | null; label: string; align?: "right" }> = [
  { sort: "number", label: "Quote" },
  { sort: "client", label: "Client" },
  { sort: null, label: "Prospect" },
  { sort: null, label: "Status" },
  { sort: "created", label: "Created" },
  { sort: "valid", label: "Valid until" },
  { sort: "total", label: "Total", align: "right" },
  { sort: null, label: "Actions", align: "right" },
];

/** Filters live in the URL, so a filtered list can be bookmarked, shared and survives a refresh. */
export function QuoteList({ rows, total, filters, prospectName }: { rows: QuoteWithProspect[]; total: number; filters: QuoteFilters; prospectName: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(filters.q);

  const go = (next: Partial<QuoteFilters>) => {
    const merged = { ...filters, ...next, page: next.page ?? 1 };
    const query = quoteFiltersToParams(merged).toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };
  const href = (next: Partial<QuoteFilters>) => {
    const query = quoteFiltersToParams({ ...filters, ...next }).toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const pages = Math.max(1, Math.ceil(total / filters.per));
  const hasFilters = Boolean(filters.q || filters.status || filters.prospect || filters.from || filters.to);
  const money = (r: QuoteWithProspect) => formatCents(r.totalCents, r.currency, r.language);

  const sortBy = (sort: QuoteSort) => go({ sort, dir: filters.sort === sort && filters.dir === "desc" ? "asc" : "desc" });

  return (
    <div>
      <form
        role="search"
        className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_12rem_10rem_10rem_auto] xl:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: q.trim() });
        }}
      >
        <div>
          <label htmlFor="quote-search" className="mb-1.5 block text-xs font-medium text-muted">
            Search
          </label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <input
              id="quote-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Number, client, company, prospect, title"
              autoComplete="off"
              className={cn(adminInput, "h-10 pl-9")}
            />
          </div>
        </div>
        <div>
          <label htmlFor="quote-status" className="mb-1.5 block text-xs font-medium text-muted">
            Status
          </label>
          <AdminSelect id="quote-status" value={filters.status} onChange={(v) => go({ status: v as QuoteFilters["status"] })} options={STATUS_OPTIONS} />
        </div>
        <div>
          <label htmlFor="quote-from" className="mb-1.5 block text-xs font-medium text-muted">
            Created from
          </label>
          <input id="quote-from" type="date" value={filters.from} onChange={(e) => go({ from: e.target.value })} className={cn(adminInput, "h-10 [color-scheme:dark]")} />
        </div>
        <div>
          <label htmlFor="quote-to" className="mb-1.5 block text-xs font-medium text-muted">
            Created until
          </label>
          <input id="quote-to" type="date" value={filters.to} onChange={(e) => go({ to: e.target.value })} className={cn(adminInput, "h-10 [color-scheme:dark]")} />
        </div>
        <Button type="submit" size="sm" variant="secondary" icon="none">
          Search
        </Button>
      </form>

      {(hasFilters || filters.prospect) && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>
            {total} {total === 1 ? "quote" : "quotes"}
            {filters.prospect && prospectName ? ` for ${prospectName}` : ""}
          </span>
          <Link href={pathname} className="text-ink underline underline-offset-4">
            Clear filters
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState>
          {hasFilters ? "No quotes match these filters." : "No quotes yet."}{" "}
          {!hasFilters && (
            <Link href="/admin/quotes/new" className="text-ink underline underline-offset-4">
              Create the first one
            </Link>
          )}
        </EmptyState>
      ) : (
        <>
          {/* Wide screens: a table. */}
          <div className="hidden overflow-x-auto rounded-card border border-line xl:block">
            <table className="w-full min-w-[62rem] text-left text-sm">
              <caption className="sr-only">Quotes</caption>
              <thead className="border-b border-line bg-glass text-xs text-muted">
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.label} scope="col" className={cn("px-3 py-2.5 font-medium", c.align === "right" && "text-right")} aria-sort={c.sort && filters.sort === c.sort ? (filters.dir === "asc" ? "ascending" : "descending") : undefined}>
                      {c.sort ? (
                        <button type="button" onClick={() => sortBy(c.sort!)} className="inline-flex items-center gap-1 hover:text-ink">
                          {c.label}
                          {filters.sort === c.sort && (filters.dir === "asc" ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" />)}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-glass/60">
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/quotes/${r.id}`} className="font-medium text-ink hover:underline">
                        {r.number}
                      </Link>
                      <div className="max-w-[16rem] truncate text-xs text-muted">{r.title ?? "Untitled"}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div>{r.clientCompany || r.clientName || <span className="text-subtle">—</span>}</div>
                      {r.clientCompany && r.clientName && <div className="text-xs text-muted">{r.clientName}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.prospect ? (
                        <Link href={`/admin/prospects/${r.prospect.id}`} className="hover:underline">
                          {r.prospect.companyName}
                        </Link>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <QuoteStatusBadge status={r.status} validUntil={r.validUntil} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted">{formatDay(r.createdAt.slice(0, 10))}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted">{r.validUntil ? formatDay(r.validUntil) : "—"}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{money(r)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <RowActions row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Narrower screens: cards. */}
          <ul className="space-y-3 xl:hidden">
            {rows.map((r) => (
              <li key={r.id} className="rounded-card border border-line bg-glass p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/admin/quotes/${r.id}`} className="font-medium hover:underline">
                      {r.number}
                    </Link>
                    <p className="truncate text-sm text-muted">{r.title ?? "Untitled"}</p>
                  </div>
                  <QuoteStatusBadge status={r.status} validUntil={r.validUntil} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Client</dt>
                    <dd className="truncate">{r.clientCompany || r.clientName || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Total</dt>
                    <dd className="tabular-nums">{money(r)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Created</dt>
                    <dd>{formatDay(r.createdAt.slice(0, 10))}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Valid until</dt>
                    <dd>{r.validUntil ? formatDay(r.validUntil) : "—"}</dd>
                  </div>
                  {r.prospect && (
                    <div className="col-span-2">
                      <dt className="text-xs text-muted">Prospect</dt>
                      <dd>
                        <Link href={`/admin/prospects/${r.prospect.id}`} className="hover:underline">
                          {r.prospect.companyName}
                        </Link>
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="mt-3 flex justify-end">
                  <RowActions row={r} />
                </div>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm text-muted">
              <span>
                Page {filters.page} of {pages}
              </span>
              <div className="flex gap-2">
                {filters.page > 1 && (
                  <ButtonLink href={href({ page: filters.page - 1 })} size="sm" variant="secondary" icon="none">
                    Previous
                  </ButtonLink>
                )}
                {filters.page < pages && (
                  <ButtonLink href={href({ page: filters.page + 1 })} size="sm" variant="secondary" icon="none">
                    Next
                  </ButtonLink>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function RowActions({ row }: { row: QuoteWithProspect }) {
  const link = "text-sm text-muted underline-offset-4 hover:text-ink hover:underline";
  return (
    <span className="inline-flex items-center gap-3">
      <Link href={`/admin/quotes/${row.id}`} className={link}>
        View
      </Link>
      {(row.status === "draft" || row.status === "ready") && (
        <Link href={`/admin/quotes/${row.id}/edit`} className={link}>
          Edit
        </Link>
      )}
    </span>
  );
}
