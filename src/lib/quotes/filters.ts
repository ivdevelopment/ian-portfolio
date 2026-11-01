import { brusselsDay } from "@/lib/mail/timeline";
import { addDays, isIsoDay } from "@/lib/prospects/dates";
import { searchPattern } from "@/lib/prospects/filters";
import { QUOTE_STATUSES, type QuoteStatus } from "./constants";

export const QUOTE_SORTS = ["created", "number", "client", "total", "valid"] as const;
export type QuoteSort = (typeof QUOTE_SORTS)[number];
export const QUOTE_SORT_COLUMNS: Record<QuoteSort, string> = {
  created: "created_at",
  number: "quote_number",
  client: "client_company",
  total: "total",
  valid: "valid_until",
};

export type QuoteFilters = {
  q: string;
  status: QuoteStatus | "";
  prospect: string;
  /** Created between these calendar days (inclusive). */
  from: string;
  to: string;
  sort: QuoteSort;
  dir: "asc" | "desc";
  page: number;
  per: number;
};

export const DEFAULT_QUOTE_FILTERS: QuoteFilters = { q: "", status: "", prospect: "", from: "", to: "", sort: "created", dir: "desc", page: 1, per: 25 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Reads the list's URL parameters. Anything unknown or malformed falls back to the default instead of failing. */
export function parseQuoteFilters(raw: Raw): QuoteFilters {
  const status = one(raw.status);
  const sort = one(raw.sort);
  const page = Number.parseInt(one(raw.page), 10);
  return {
    q: one(raw.q).trim().slice(0, 100),
    status: (QUOTE_STATUSES as readonly string[]).includes(status) ? (status as QuoteStatus) : "",
    prospect: UUID.test(one(raw.prospect)) ? one(raw.prospect) : "",
    from: isIsoDay(one(raw.from)) ? one(raw.from) : "",
    to: isIsoDay(one(raw.to)) ? one(raw.to) : "",
    sort: (QUOTE_SORTS as readonly string[]).includes(sort) ? (sort as QuoteSort) : DEFAULT_QUOTE_FILTERS.sort,
    dir: one(raw.dir) === "asc" ? "asc" : "desc",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
    per: DEFAULT_QUOTE_FILTERS.per,
  };
}

/** Only the non-default values, so URLs stay short and a reset is just "no parameters". */
export function quoteFiltersToParams(filters: QuoteFilters): URLSearchParams {
  const params = new URLSearchParams();
  const d = DEFAULT_QUOTE_FILTERS;
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.prospect) params.set("prospect", filters.prospect);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.sort !== d.sort) params.set("sort", filters.sort);
  if (filters.dir !== d.dir) params.set("dir", filters.dir);
  if (filters.page !== 1) params.set("page", String(filters.page));
  return params;
}

export const QUOTE_SEARCH_COLUMNS = ["quote_number", "client_name", "client_company", "title"] as const;

/** PostgREST `or` expression for the search box (client, company, number, title) plus the matching prospects' ids. */
export function quoteSearchFilter(q: string, prospectIds: readonly string[] = []): string | null {
  const text = q.trim();
  if (!text) return null;
  const pattern = searchPattern(text);
  const parts: string[] = QUOTE_SEARCH_COLUMNS.map((c) => `${c}.ilike.${pattern}`);
  if (prospectIds.length) parts.push(`prospect_id.in.(${prospectIds.join(",")})`);
  return parts.join(",");
}

/** The instant a Brussels calendar day begins (so "created from 1 Nov" is exact across summer/winter time). */
export function brusselsDayStartIso(day: string): string {
  for (const offset of ["+02:00", "+01:00"]) {
    const start = new Date(`${day}T00:00:00${offset}`);
    if (brusselsDay(start.toISOString()) === day && brusselsDay(new Date(start.getTime() - 1).toISOString()) !== day) return start.toISOString();
  }
  return new Date(`${day}T00:00:00Z`).toISOString();
}

/** Exclusive upper bound for "created up to and including `day`". */
export const brusselsDayEndIso = (day: string) => brusselsDayStartIso(addDays(day, 1));

/** LIKE pattern for the plain `.ilike()` method (no PostgREST quoting layer): wildcards in the text are literal. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
