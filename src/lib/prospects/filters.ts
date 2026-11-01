import {
  CLOSED_STATUSES,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  PROSPECT_PRIORITIES,
  PROSPECT_STATUSES,
  REPLIED_STATUSES,
  SORT_COLUMNS,
  type ProspectPriority,
  type ProspectStatus,
  type SortKey,
} from "./constants";
import { addDays, endOfWeek } from "./dates";

export const FOLLOW_UP_FILTERS = ["overdue", "today", "tomorrow", "week", "none"] as const;
export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number];
export const FOLLOW_UP_FILTER_LABELS: Record<FollowUpFilter, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "This week",
  none: "No follow-up",
};

/** The whole list state. It lives in the URL, so a filtered view can be bookmarked or shared. */
export type ProspectFilters = {
  q: string;
  status: ProspectStatus | null;
  sector: string | null;
  priority: ProspectPriority | null;
  followup: FollowUpFilter | null;
  replied: boolean;
  preview: boolean;
  project: boolean;
  /** Linked preview opened ('yes') or never opened ('no'); either implies a linked preview. */
  viewed: "yes" | "no" | null;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
  per: (typeof PAGE_SIZES)[number];
};

export const DEFAULT_FILTERS: ProspectFilters = {
  q: "",
  status: null,
  sector: null,
  priority: null,
  followup: null,
  replied: false,
  preview: false,
  project: false,
  viewed: null,
  sort: "created",
  dir: "desc",
  page: 1,
  per: DEFAULT_PAGE_SIZE,
};

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function pick(params: RawParams, key: string): string {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" ? text.trim() : "";
}

const oneOf = <T extends string>(list: readonly T[], value: string): T | null => (list.includes(value as T) ? (value as T) : null);

/** Anything malformed falls back to the default instead of throwing: URLs are user input. */
export function parseFilters(params: RawParams): ProspectFilters {
  const sort = oneOf(Object.keys(SORT_COLUMNS) as SortKey[], pick(params, "sort")) ?? DEFAULT_FILTERS.sort;
  const per = Number(pick(params, "per"));
  const page = Math.floor(Number(pick(params, "page")));
  return {
    q: pick(params, "q").slice(0, 120),
    status: oneOf(PROSPECT_STATUSES, pick(params, "status")),
    sector: pick(params, "sector").slice(0, 120) || null,
    priority: oneOf(PROSPECT_PRIORITIES, pick(params, "priority")),
    followup: oneOf(FOLLOW_UP_FILTERS, pick(params, "followup")),
    replied: pick(params, "replied") === "1",
    preview: pick(params, "preview") === "1",
    project: pick(params, "project") === "1",
    viewed: pick(params, "viewed") === "1" ? "yes" : pick(params, "viewed") === "0" ? "no" : null,
    sort,
    dir: pick(params, "dir") === "asc" ? "asc" : pick(params, "dir") === "desc" ? "desc" : defaultDir(sort),
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100_000) : 1,
    per: (PAGE_SIZES as readonly number[]).includes(per) ? (per as ProspectFilters["per"]) : DEFAULT_PAGE_SIZE,
  };
}

/** Text sorts ascending, everything chronological/numeric starts with the most recent / largest. */
export function defaultDir(sort: SortKey): "asc" | "desc" {
  return sort === "company" || sort === "status" || sort === "priority" || sort === "follow_up" ? "asc" : "desc";
}

/** Only non-default values are written, so URLs stay short. */
export function filtersToParams(f: ProspectFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.status) p.set("status", f.status);
  if (f.sector) p.set("sector", f.sector);
  if (f.priority) p.set("priority", f.priority);
  if (f.followup) p.set("followup", f.followup);
  if (f.replied) p.set("replied", "1");
  if (f.preview) p.set("preview", "1");
  if (f.project) p.set("project", "1");
  if (f.viewed) p.set("viewed", f.viewed === "yes" ? "1" : "0");
  if (f.sort !== DEFAULT_FILTERS.sort || f.dir !== defaultDir(f.sort)) {
    p.set("sort", f.sort);
    p.set("dir", f.dir);
  }
  if (f.page > 1) p.set("page", String(f.page));
  if (f.per !== DEFAULT_PAGE_SIZE) p.set("per", String(f.per));
  return p;
}

export function hasActiveFilters(f: ProspectFilters): boolean {
  return Boolean(f.q || f.status || f.sector || f.priority || f.followup || f.replied || f.preview || f.project || f.viewed);
}

/**
 * Escapes a user's text for an ILIKE pattern that travels inside a quoted PostgREST `or(...)` value. Two layers:
 * LIKE treats  % _ specially (escaped with a backslash), and PostgREST then treats  and " inside quotes as its
 * own escapes (so every backslash is doubled, and quotes are escaped).
 */
export function searchPattern(q: string): string {
  const like = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const quoted = like.replace(/[\\"]/g, (c) => `\\${c}`);
  return `"%${quoted}%"`;
}

export const SEARCH_COLUMNS = ["company_name", "email", "contact_name", "sector", "city", "website_url"] as const;

export function searchFilter(q: string): string | null {
  const text = q.trim();
  if (!text) return null;
  const pattern = searchPattern(text);
  return SEARCH_COLUMNS.map((c) => `${c}.ilike.${pattern}`).join(",");
}

/** The slice of the Supabase query builder the filters use (so they can be tested without a database). */
export type FilterBuilder<T> = {
  or(filter: string): T;
  eq(column: string, value: unknown): T;
  in(column: string, values: readonly unknown[]): T;
  not(column: string, operator: string, value: unknown): T;
  is(column: string, value: null): T;
  lt(column: string, value: unknown): T;
  lte(column: string, value: unknown): T;
  gt(column: string, value: unknown): T;
  gte(column: string, value: unknown): T;
};

/** Applies every active filter. `today` is the Brussels calendar day, so "overdue" never depends on the server clock. */
export function applyProspectFilters<T extends FilterBuilder<T>>(query: T, f: ProspectFilters, today: string): T {
  let q = query;
  const search = searchFilter(f.q);
  if (search) q = q.or(search);
  if (f.status) q = q.eq("status", f.status);
  if (f.sector) q = q.eq("sector", f.sector);
  if (f.priority) q = q.eq("priority", f.priority);
  if (f.replied) q = q.in("status", REPLIED_STATUSES);
  if (f.preview) q = q.not("linked_preview_id", "is", null);
  if (f.project) q = q.not("linked_project_id", "is", null);
  // Needs the preview embedded with !inner (see queries.ts), so a prospect without a preview is excluded.
  if (f.viewed === "yes") q = q.gt("linked_preview.successful_access_count", 0);
  if (f.viewed === "no") q = q.eq("linked_preview.successful_access_count", 0);

  if (f.followup) {
    if (f.followup === "none") return q.is("next_follow_up_on", null);
    // A follow-up on a closed prospect is moot, so it is never "overdue" or "due".
    q = q.not("status", "in", `(${CLOSED_STATUSES.join(",")})`);
    if (f.followup === "overdue") q = q.lt("next_follow_up_on", today);
    else if (f.followup === "today") q = q.eq("next_follow_up_on", today);
    else if (f.followup === "tomorrow") q = q.eq("next_follow_up_on", addDays(today, 1));
    else q = q.gte("next_follow_up_on", today).lte("next_follow_up_on", endOfWeek(today));
  }
  return q;
}
