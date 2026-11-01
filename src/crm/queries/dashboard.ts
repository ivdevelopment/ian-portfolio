import "server-only";

import { requireAdmin } from "@/lib/auth";
import { suggestReply, type MailRow } from "@/lib/mail/timeline";
import { getZohoConfig } from "@/lib/mail/zoho/config";
import { PROSPECT_STATUSES, STATUS_LABELS, isClosed, type ProspectStatus } from "@/lib/prospects/constants";
import { addDays, brusselsToday, endOfWeek } from "@/lib/prospects/dates";
import { getSummary } from "@/lib/prospects/queries";
import type { ProspectSummary } from "@/lib/prospects/types";
import { getQuoteMetrics } from "@/lib/quotes/queries";
import type { QuoteMetrics } from "@/lib/quotes/metrics";
import { decimalToCents } from "@/lib/quotes/money";

/**
 * Everything the CRM dashboard shows, from real data only. Each function is one small, bounded set of queries (no per-row queries),
 * so the dashboard can stream its sections independently.
 */

type Brief = { id: string; company: string; status: ProspectStatus };

export type TodayData = {
  summary: ProspectSummary;
  overdue: Array<Brief & { day: string }>;
  dueToday: Array<Brief & { day: string }>;
  replies: Array<Brief & { subject: string | null; at: string }>;
  repliesTotal: number;
  expiringQuotes: Array<{ id: string; number: string; client: string; validUntil: string; days: number }>;
  awaitingQuotes: Array<{ id: string; number: string; client: string; sentAt: string | null; validUntil: string | null }>;
  noNextAction: Array<Brief>;
  noNextActionTotal: number;
  zohoEnabled: boolean;
};

/** Open opportunities that should have a next step planned. */
const WANTS_NEXT_STEP: ProspectStatus[] = ["replied", "interested", "concept_sent", "meeting_planned", "quote_sent"];

export async function getToday(today = brusselsToday()): Promise<TodayData> {
  const { supabase } = await requireAdmin();
  const summary = await getSummary(today);
  const zohoEnabled = getZohoConfig().enabled;
  const horizon = addDays(today, 7);

  const [followUps, mail, quotes, noAction] = await Promise.all([
    supabase
      .from("prospects")
      .select("id, company_name, status, next_follow_up_on")
      .not("status", "in", "(won,lost,not_interested,no_response)")
      .lte("next_follow_up_on", today)
      .order("next_follow_up_on", { ascending: true })
      .limit(40),
    zohoEnabled
      ? supabase.from("mail_messages").select("id, prospect_id, direction, from_address, subject, snippet, sent_at").order("sent_at", { ascending: false }).limit(400)
      : Promise.resolve({ data: [] as never[], error: null }),
    supabase.from("quotes").select("id, quote_number, client_company, client_name, status, valid_until, sent_at").in("status", ["sent"]).order("sent_at", { ascending: true }).limit(100),
    supabase
      .from("prospects")
      .select("id, company_name, status", { count: "exact" })
      .in("status", WANTS_NEXT_STEP)
      .is("next_follow_up_on", null)
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  const due = (followUps.data ?? []).map((p) => ({ id: p.id, company: p.company_name, status: p.status as ProspectStatus, day: p.next_follow_up_on as string }));

  // New replies: the newest message of a prospect is incoming, and the prospect has not been marked as replied (the rule of the Email panel).
  const byProspect = new Map<string, MailRow[]>();
  for (const m of (mail.data ?? []) as Array<MailRow & { prospect_id: string }>) {
    const list = byProspect.get(m.prospect_id) ?? [];
    list.push(m);
    byProspect.set(m.prospect_id, list);
  }
  let replies: TodayData["replies"] = [];
  let repliesTotal = 0;
  if (byProspect.size) {
    const { data: prospects } = await supabase.from("prospects").select("id, company_name, status").in("id", [...byProspect.keys()]);
    const found = (prospects ?? [])
      .map((p) => {
        const hit = suggestReply(p.status as ProspectStatus, byProspect.get(p.id) ?? []);
        return hit ? { id: p.id, company: p.company_name, status: p.status as ProspectStatus, subject: hit.mail.subject, at: hit.mail.sent_at } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (a.at > b.at ? -1 : 1));
    repliesTotal = found.length;
    replies = found.slice(0, 5);
  }

  const quoteRows = quotes.data ?? [];
  const expiringQuotes = quoteRows
    .filter((q) => q.valid_until && q.valid_until >= today && q.valid_until <= horizon)
    .map((q) => ({ id: q.id, number: q.quote_number, client: q.client_company || q.client_name || "—", validUntil: q.valid_until as string, days: Math.round((Date.parse(q.valid_until as string) - Date.parse(today)) / 86_400_000) }))
    .sort((a, b) => (a.validUntil < b.validUntil ? -1 : 1));
  const awaitingQuotes = quoteRows
    .filter((q) => !q.valid_until || q.valid_until >= today)
    .map((q) => ({ id: q.id, number: q.quote_number, client: q.client_company || q.client_name || "—", sentAt: q.sent_at, validUntil: q.valid_until }));

  return {
    summary,
    overdue: due.filter((d) => d.day < today),
    dueToday: due.filter((d) => d.day === today),
    replies,
    repliesTotal,
    expiringQuotes,
    awaitingQuotes,
    noNextAction: (noAction.data ?? []).map((p) => ({ id: p.id, company: p.company_name, status: p.status as ProspectStatus })),
    noNextActionTotal: noAction.count ?? 0,
    zohoEnabled,
  };
}

export type PipelineData = {
  summary: ProspectSummary;
  quotes: QuoteMetrics;
  stages: Array<{ status: ProspectStatus; label: string; count: number }>;
  total: number;
};

export async function getPipeline(today = brusselsToday()): Promise<PipelineData> {
  const { supabase } = await requireAdmin();
  const [summary, quotes, rows] = await Promise.all([getSummary(today), getQuoteMetrics(today), supabase.from("prospects").select("status").limit(5000)]);
  const counts = new Map<ProspectStatus, number>();
  for (const r of rows.data ?? []) counts.set(r.status as ProspectStatus, (counts.get(r.status as ProspectStatus) ?? 0) + 1);
  return {
    summary,
    quotes,
    stages: PROSPECT_STATUSES.map((status) => ({ status, label: STATUS_LABELS[status], count: counts.get(status) ?? 0 })),
    total: rows.data?.length ?? 0,
  };
}

export type ActivityItem = {
  key: string;
  at: string;
  kind: "email" | "quote" | "preview" | "status" | "activity" | "project";
  title: string;
  detail: string | null;
  prospectId: string | null;
  prospectName: string | null;
  href: { type: "prospect"; id: string } | { type: "quote"; id: string } | null;
};

/**
 * One feed from four tables, newest first and bounded: each source contributes at most a handful of rows, they are merged by
 * time and cut to `limit`. Imported legacy history is left out (its dates are not events of the last days), and an event that
 * lives in one table is never repeated from another (quote events come from quote_activities only, mail from mail_messages,
 * previews from the preview record, everything else from prospect_activities).
 */
export async function getRecentActivity(limit = 12): Promise<ActivityItem[]> {
  const { supabase } = await requireAdmin();
  const zohoEnabled = getZohoConfig().enabled;
  const [acts, quoteActs, mail, previews] = await Promise.all([
    supabase.from("prospect_activities").select("id, prospect_id, type, title, description, occurred_at, created_at, metadata, prospects(company_name)").order("created_at", { ascending: false }).limit(30),
    supabase.from("quote_activities").select("id, quote_id, type, title, created_at, quotes(quote_number, client_company, client_name, prospect_id)").in("type", ["created", "sent", "accepted", "rejected", "cancelled"]).order("created_at", { ascending: false }).limit(15),
    zohoEnabled
      ? supabase.from("mail_messages").select("id, prospect_id, direction, subject, sent_at, prospects(company_name)").order("sent_at", { ascending: false }).limit(15)
      : Promise.resolve({ data: [] as never[], error: null }),
    supabase.from("prospects").select("id, company_name, client_previews:linked_preview_id(last_accessed_at, successful_access_count)").not("linked_preview_id", "is", null).limit(200),
  ]);

  const items: ActivityItem[] = [];
  for (const a of (acts.data ?? []) as unknown as Array<{ id: string; prospect_id: string; type: string; title: string; description: string | null; occurred_at: string | null; created_at: string; metadata: Record<string, unknown> | null; prospects: { company_name: string } | null }>) {
    if (a.metadata && (a.metadata as { imported?: boolean }).imported) continue;
    items.push({
      key: `a:${a.id}`,
      at: a.occurred_at ?? a.created_at,
      kind: a.type === "status_changed" ? "status" : a.type.startsWith("project_") ? "project" : "activity",
      title: a.title,
      detail: a.description,
      prospectId: a.prospect_id,
      prospectName: a.prospects?.company_name ?? null,
      href: { type: "prospect", id: a.prospect_id },
    });
  }
  for (const q of (quoteActs.data ?? []) as unknown as Array<{ id: string; quote_id: string; type: string; title: string; created_at: string; quotes: { quote_number: string; client_company: string | null; client_name: string | null; prospect_id: string | null } | null }>) {
    items.push({
      key: `q:${q.id}`,
      at: q.created_at,
      kind: "quote",
      title: `Quote ${q.type === "created" ? "created" : q.type}`,
      detail: q.quotes?.quote_number ?? null,
      prospectId: q.quotes?.prospect_id ?? null,
      prospectName: q.quotes?.client_company || q.quotes?.client_name || null,
      href: { type: "quote", id: q.quote_id },
    });
  }
  for (const m of (mail.data ?? []) as unknown as Array<{ id: string; prospect_id: string; direction: string; subject: string | null; sent_at: string; prospects: { company_name: string } | null }>) {
    items.push({
      key: `m:${m.id}`,
      at: m.sent_at,
      kind: "email",
      title: m.direction === "incoming" ? "Email received" : "Email sent",
      detail: m.subject,
      prospectId: m.prospect_id,
      prospectName: m.prospects?.company_name ?? null,
      href: { type: "prospect", id: m.prospect_id },
    });
  }
  for (const p of (previews.data ?? []) as unknown as Array<{ id: string; company_name: string; client_previews: { last_accessed_at: string | null; successful_access_count: number } | null }>) {
    const preview = p.client_previews;
    if (!preview?.last_accessed_at) continue;
    items.push({
      key: `p:${p.id}`,
      at: preview.last_accessed_at,
      kind: "preview",
      title: "Preview viewed",
      detail: preview.successful_access_count > 1 ? `${preview.successful_access_count} visits` : null,
      prospectId: p.id,
      prospectName: p.company_name,
      href: { type: "prospect", id: p.id },
    });
  }
  return items.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0)).slice(0, limit);
}

export type FollowUpRow = Brief & { priority: string; day: string | null; lastActivity: string | null };

/** The follow-up planner: active prospects only, split by when their next step is due. */
export async function getFollowUps(today = brusselsToday()) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select("id, company_name, status, priority, next_follow_up_on, last_activity_title")
    .not("status", "in", "(won,lost,not_interested,no_response)")
    .limit(2000);
  if (error) throw new Error("Follow-ups unavailable");
  const rows: FollowUpRow[] = (data ?? []).map((p) => ({ id: p.id, company: p.company_name, status: p.status as ProspectStatus, priority: p.priority, day: p.next_follow_up_on, lastActivity: p.last_activity_title }));
  const byDay = (a: FollowUpRow, b: FollowUpRow) => (a.day ?? "") < (b.day ?? "") ? -1 : (a.day ?? "") > (b.day ?? "") ? 1 : a.company.localeCompare(b.company);
  const week = endOfWeek(today);
  return {
    overdue: rows.filter((r) => r.day && r.day < today).sort(byDay),
    today: rows.filter((r) => r.day === today).sort(byDay),
    thisWeek: rows.filter((r) => r.day && r.day > today && r.day <= week).sort(byDay),
    later: rows.filter((r) => r.day && r.day > week).sort(byDay),
    // Only prospects that are in a live conversation need a next step; "new / researching" ones are not nagged.
    unscheduled: rows.filter((r) => !r.day && !isClosed(r.status) && WANTS_NEXT_STEP.concat(["contacted", "follow_up_due"]).includes(r.status)).sort((a, b) => a.company.localeCompare(b.company)),
  };
}

export type ClientRow = {
  id: string;
  company: string;
  contact: string | null;
  email: string | null;
  lastActivity: string | null;
  lastActivityOn: string | null;
  projectTitle: string | null;
  projectId: string | null;
  acceptedQuotes: number;
  acceptedNetCents: number;
};

/** Clients are not a second table: a client is a prospect that was won. Their projects and accepted quotes come along. */
export async function getClients(): Promise<ClientRow[]> {
  const { supabase } = await requireAdmin();
  const { data: won, error } = await supabase
    .from("prospects")
    .select("id, company_name, contact_name, email, last_activity_title, last_activity_on, linked_project_id")
    .eq("status", "won")
    .order("company_name")
    .limit(1000);
  if (error) throw new Error("Clients unavailable");
  const ids = (won ?? []).map((p) => p.id);
  const projectIds = (won ?? []).map((p) => p.linked_project_id).filter((x): x is string => Boolean(x));
  const [quotes, projects] = await Promise.all([
    ids.length ? supabase.from("quotes").select("prospect_id, subtotal, discount_total").eq("status", "accepted").in("prospect_id", ids) : Promise.resolve({ data: [] }),
    projectIds.length ? supabase.from("projects").select("id, title").in("id", projectIds) : Promise.resolve({ data: [] }),
  ]);
  const accepted = new Map<string, { n: number; cents: number }>();
  for (const q of (quotes.data ?? []) as Array<{ prospect_id: string; subtotal: number; discount_total: number }>) {
    const cur = accepted.get(q.prospect_id) ?? { n: 0, cents: 0 };
    cur.n += 1;
    cur.cents += decimalToCents(q.subtotal) - decimalToCents(q.discount_total);
    accepted.set(q.prospect_id, cur);
  }
  const titles = new Map((projects.data ?? []).map((p: { id: string; title: string }) => [p.id, p.title]));
  return (won ?? []).map((p) => ({
    id: p.id,
    company: p.company_name,
    contact: p.contact_name,
    email: p.email,
    lastActivity: p.last_activity_title,
    lastActivityOn: p.last_activity_on,
    projectTitle: p.linked_project_id ? (titles.get(p.linked_project_id) ?? null) : null,
    projectId: p.linked_project_id,
    acceptedQuotes: accepted.get(p.id)?.n ?? 0,
    acceptedNetCents: accepted.get(p.id)?.cents ?? 0,
  }));
}

export type ProjectRow = {
  id: string;
  title: string;
  published: boolean;
  updatedAt: string;
  client: { id: string; company: string } | null;
  quoteNumbers: string[];
};

/**
 * Projects as the CRM sees them: the same `projects` records the public portfolio uses (nothing is copied). The CRM lists the ones that
 * belong to a client (linked from a prospect, or from a quote) and points to the website admin for their portfolio content.
 */
export async function getProjects(): Promise<{ linked: ProjectRow[]; portfolioOnly: number }> {
  const { supabase } = await requireAdmin();
  const [prospects, quotes, all] = await Promise.all([
    supabase.from("prospects").select("id, company_name, linked_project_id").not("linked_project_id", "is", null).limit(1000),
    supabase.from("quotes").select("project_id, quote_number, prospect_id, client_company, client_name").not("project_id", "is", null).limit(1000),
    supabase.from("projects").select("id, title, published, updated_at").order("updated_at", { ascending: false }).limit(1000),
  ]);
  const clientOf = new Map<string, { id: string; company: string }>();
  for (const p of prospects.data ?? []) if (p.linked_project_id) clientOf.set(p.linked_project_id, { id: p.id, company: p.company_name });
  const quotesOf = new Map<string, string[]>();
  for (const q of quotes.data ?? []) {
    if (!q.project_id) continue;
    quotesOf.set(q.project_id, [...(quotesOf.get(q.project_id) ?? []), q.quote_number]);
    if (!clientOf.has(q.project_id) && q.prospect_id) clientOf.set(q.project_id, { id: q.prospect_id, company: q.client_company || q.client_name || "Client" });
  }
  const rows = (all.data ?? []).map((p) => ({ id: p.id, title: p.title, published: p.published, updatedAt: p.updated_at, client: clientOf.get(p.id) ?? null, quoteNumbers: quotesOf.get(p.id) ?? [] }));
  return { linked: rows.filter((r) => r.client || r.quoteNumbers.length), portfolioOnly: rows.filter((r) => !r.client && !r.quoteNumbers.length).length };
}
