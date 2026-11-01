import "server-only";

import { requireAdmin } from "@/lib/auth";
import { SORT_COLUMNS } from "./constants";
import { toBoardCard, type BoardCard } from "./board";
import { brusselsToday, endOfWeek } from "./dates";
import { applyProspectFilters, type FilterBuilder, type ProspectFilters } from "./filters";
import type { ActivityRecord, ProspectRecord, ProspectSummary } from "./types";

/** The list needs none of the long text (notes) nor any timeline. */
export const LIST_COLUMNS =
  "id, company_name, sector, city, website_url, email, contact_name, phone, status, priority, first_contact_on, last_contact_on, next_follow_up_on, estimated_value_eur, quote_value_eur, contact_delivery_status, source, linked_project_id, linked_preview_id, legacy_ref, last_activity_on, last_activity_title, created_at, updated_at";
export const FULL_COLUMNS = `${LIST_COLUMNS}, notes`;

/** Embeds the linked preview. `!inner` (only prospects that have one) is required to filter on its access state. */
const PREVIEW_EMBED = "linked_preview:client_previews!linked_preview_id";
const PREVIEW_FIELDS = "(subdomain, first_accessed_at, last_accessed_at, successful_access_count)";
const previewEmbed = (filters: Pick<ProspectFilters, "viewed">) => `${PREVIEW_EMBED}${filters.viewed ? "!inner" : ""}${PREVIEW_FIELDS}`;

/** The slice of the query builder used here; the typed Supabase builder is cast to it (filters are column-name strings). */
interface Query extends FilterBuilder<Query> {
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): Query;
  range(from: number, to: number): Query;
  limit(count: number): Query;
  then: PromiseLike<{ data: unknown; error: { message: string } | null; count: number | null }>["then"];
}

function fail(what: string, error: { message: string }): never {
  console.error(`[admin] prospects ${what} failed:`, error.message);
  throw new Error("Prospects unavailable");
}

export type ProspectListResult = { rows: Array<Omit<ProspectRecord, "notes">>; total: number };

export async function listProspects(filters: ProspectFilters, today = brusselsToday()): Promise<ProspectListResult> {
  const { supabase } = await requireAdmin();
  const columns = filters.viewed ? `${LIST_COLUMNS}, ${previewEmbed(filters)}` : LIST_COLUMNS;
  const base = supabase.from("prospects").select(columns, { count: "exact" }) as unknown as Query;
  const from = (filters.page - 1) * filters.per;
  const query = applyProspectFilters(base, filters, today)
    // Blank values (no follow-up, no amount) always sort last instead of pretending to be the smallest.
    .order(SORT_COLUMNS[filters.sort], { ascending: filters.dir === "asc", nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, from + filters.per - 1);
  const { data, error, count } = await query;
  if (error) fail("list", error);
  return { rows: (data ?? []) as unknown as ProspectListResult["rows"], total: count ?? 0 };
}

/** Everything matching the filters (for export), in the list's order. Capped so an export can never be unbounded. */
export const EXPORT_LIMIT = 10_000;
export async function listProspectsForExport(filters: ProspectFilters, today = brusselsToday()): Promise<ProspectRecord[]> {
  const { supabase } = await requireAdmin();
  const base = supabase.from("prospects").select(filters.viewed ? `${FULL_COLUMNS}, ${previewEmbed(filters)}` : FULL_COLUMNS) as unknown as Query;
  const { data, error } = await applyProspectFilters(base, filters, today)
    .order(SORT_COLUMNS[filters.sort], { ascending: filters.dir === "asc", nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (error) fail("export", error);
  return (data ?? []) as unknown as ProspectRecord[];
}

export async function listProspectsByIds(ids: readonly string[]): Promise<ProspectRecord[]> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("prospects").select(FULL_COLUMNS).in("id", [...ids]).order("company_name");
  if (error) fail("selection", error);
  return (data ?? []) as unknown as ProspectRecord[];
}

export async function getProspect(id: string): Promise<ProspectRecord | null> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("prospects").select(FULL_COLUMNS).eq("id", id).maybeSingle();
  if (error) fail("load", error);
  return (data ?? null) as unknown as ProspectRecord | null;
}

/** The timeline is loaded on its own (newest first); the list never touches it. */
export async function listActivities(prospectId: string, limit = 200): Promise<ActivityRecord[]> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("prospect_activities")
    .select("id, prospect_id, type, title, description, occurred_on, occurred_at, metadata, created_at")
    .eq("prospect_id", prospectId)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("timeline", error);
  return (data ?? []) as unknown as ActivityRecord[];
}

export async function listActivitiesForProspects(ids: readonly string[]): Promise<Map<string, ActivityRecord[]>> {
  const { supabase } = await requireAdmin();
  const out = new Map<string, ActivityRecord[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("prospect_activities")
      .select("id, prospect_id, type, title, description, occurred_on, occurred_at, metadata, created_at")
      .in("prospect_id", ids.slice(i, i + 200))
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) fail("activities export", error);
    for (const row of (data ?? []) as unknown as ActivityRecord[]) {
      const list = out.get(row.prospect_id) ?? [];
      list.push(row);
      out.set(row.prospect_id, list);
    }
  }
  return out;
}

export async function getSummary(today = brusselsToday()): Promise<ProspectSummary> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("prospect_summary", { p_today: today, p_week_end: endOfWeek(today) });
  if (error) fail("summary", error);
  return data as unknown as ProspectSummary;
}

/** The next few prospects that need action: overdue first, then the soonest follow-ups. */
export async function listFollowUpQueue(limit = 4, today = brusselsToday()) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select("id, company_name, status, next_follow_up_on")
    .not("next_follow_up_on", "is", null)
    .not("status", "in", "(won,lost,not_interested,no_response)")
    .lte("next_follow_up_on", endOfWeek(today))
    .order("next_follow_up_on", { ascending: true })
    .limit(limit);
  if (error) fail("follow-up queue", error);
  return (data ?? []) as Array<Pick<ProspectRecord, "id" | "company_name" | "status" | "next_follow_up_on">>;
}

export async function listSectors(): Promise<string[]> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("prospects").select("sector").not("sector", "is", null).limit(5000);
  if (error) fail("sectors", error);
  return [...new Set((data ?? []).map((r) => r.sector as string))].sort((a, b) => a.localeCompare(b));
}

export type LinkedPreview = {
  id: string;
  client_name: string;
  subdomain: string;
  active: boolean;
  expires_at: string | null;
  first_accessed_at: string | null;
  last_accessed_at: string | null;
  successful_access_count: number;
};
export type LinkedProject = { id: string; title: string; slug: string; published: boolean };

export async function getLinked(prospect: Pick<ProspectRecord, "linked_preview_id" | "linked_project_id">) {
  const { supabase } = await requireAdmin();
  const [preview, project] = await Promise.all([
    prospect.linked_preview_id
      ? supabase.from("client_previews").select("id, client_name, subdomain, active, expires_at, first_accessed_at, last_accessed_at, successful_access_count").eq("id", prospect.linked_preview_id).maybeSingle()
      : null,
    prospect.linked_project_id
      ? supabase.from("projects").select("id, title, slug, published").eq("id", prospect.linked_project_id).maybeSingle()
      : null,
  ]);
  return { preview: (preview?.data ?? null) as LinkedPreview | null, project: (project?.data ?? null) as LinkedProject | null };
}

export async function listLinkableOptions() {
  const { supabase } = await requireAdmin();
  const [previews, projects] = await Promise.all([
    supabase.from("client_previews").select("id, client_name, project_name, subdomain").order("client_name"),
    supabase.from("projects").select("id, title, slug").order("title"),
  ]);
  if (previews.error) fail("previews", previews.error);
  if (projects.error) fail("projects", projects.error);
  return {
    previews: (previews.data ?? []) as Array<{ id: string; client_name: string; project_name: string; subdomain: string }>,
    projects: (projects.data ?? []) as Array<{ id: string; title: string; slug: string }>,
  };
}

/** Existing prospects, reduced to what duplicate detection compares. */
export async function listComparable(): Promise<Array<Pick<ProspectRecord, "id" | "company_name" | "email" | "website_url">>> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("prospects").select("id, company_name, email, website_url").limit(20000);
  if (error) fail("duplicate check", error);
  return (data ?? []) as Array<Pick<ProspectRecord, "id" | "company_name" | "email" | "website_url">>;
}

/** Everything the board needs in ONE query (prospects + their linked preview), capped; never one query per card. */
export const BOARD_LIMIT = 1000;
const BOARD_COLUMNS =
  "id, company_name, sector, city, email, website_url, status, priority, next_follow_up_on, estimated_value_eur, last_activity_on";

export async function listBoardCards(filters: ProspectFilters, today = brusselsToday()): Promise<{ cards: BoardCard[]; total: number }> {
  const { supabase } = await requireAdmin();
  const base = supabase.from("prospects").select(`${BOARD_COLUMNS}, ${previewEmbed(filters)}`, { count: "exact" }) as unknown as Query;
  const { data, error, count } = await applyProspectFilters(base, filters, today).order("company_name", { ascending: true }).limit(BOARD_LIMIT);
  if (error) fail("board", error);
  const cards = ((data ?? []) as unknown as Array<Parameters<typeof toBoardCard>[0]>).map(toBoardCard);
  return { cards, total: count ?? cards.length };
}
