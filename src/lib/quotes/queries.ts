import "server-only";

import { requireAdmin } from "@/lib/auth";
import { brusselsToday } from "@/lib/prospects/dates";
import type { QuoteStatus } from "./constants";
import { DEFAULT_SETTINGS } from "./form";
import { brusselsDayEndIso, brusselsDayStartIso, likePattern, QUOTE_SORT_COLUMNS, quoteSearchFilter, type QuoteFilters } from "./filters";
import { decimalToCents } from "./money";
import { summarizeQuotes, type QuoteMetrics } from "./metrics";
import { toQuoteRecord, type ProspectQuoteEvent, type QuoteActivityRecord, type QuoteRow, type QuoteItemRow, type QuoteSettings, type QuoteTemplateRecord, type QuoteWithProspect } from "./types";

function fail(what: string, error: { message: string }): never {
  console.error(`[admin] quotes ${what} failed:`, error.message);
  throw new Error("Quotes unavailable");
}

const PROSPECT_EMBED = "prospect:prospects!prospect_id(id, company_name, status, quote_value_eur)";
type Embedded = QuoteRow & { prospect: { id: string; company_name: string; status: string; quote_value_eur: number | null } | null; quote_items?: QuoteItemRow[] };

function withProspect(row: Embedded): QuoteWithProspect {
  return { ...toQuoteRecord(row, row.quote_items ?? []), prospect: row.prospect ? { id: row.prospect.id, companyName: row.prospect.company_name, status: row.prospect.status, quoteValueCents: row.prospect.quote_value_eur === null ? null : decimalToCents(row.prospect.quote_value_eur) } : null };
}

export type QuoteListResult = { rows: QuoteWithProspect[]; total: number };

export async function listQuotes(filters: QuoteFilters, today = brusselsToday()): Promise<QuoteListResult> {
  const { supabase } = await requireAdmin();
  let prospectIds: string[] = [];
  if (filters.q) {
    const { data } = await supabase.from("prospects").select("id").ilike("company_name", likePattern(filters.q)).limit(50);
    prospectIds = (data ?? []).map((p) => p.id);
  }
  let query = supabase.from("quotes").select(`*, ${PROSPECT_EMBED}`, { count: "exact" });
  const search = quoteSearchFilter(filters.q, prospectIds);
  if (search) query = query.or(search);
  if (filters.prospect) query = query.eq("prospect_id", filters.prospect);
  if (filters.from) query = query.gte("created_at", brusselsDayStartIso(filters.from));
  if (filters.to) query = query.lt("created_at", brusselsDayEndIso(filters.to));
  // "Expired" is derived: a sent quote past its validity, or one explicitly stored as expired.
  if (filters.status === "expired") query = query.or(`status.eq.expired,and(status.eq.sent,valid_until.lt.${today})`);
  else if (filters.status === "sent") query = query.eq("status", "sent").or(`valid_until.is.null,valid_until.gte.${today}`);
  else if (filters.status) query = query.eq("status", filters.status);

  const from = (filters.page - 1) * filters.per;
  const { data, error, count } = await query
    .order(QUOTE_SORT_COLUMNS[filters.sort], { ascending: filters.dir === "asc", nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, from + filters.per - 1);
  if (error) fail("list", error);
  return { rows: ((data ?? []) as unknown as Embedded[]).map(withProspect), total: count ?? 0 };
}

export async function getQuote(id: string): Promise<QuoteWithProspect | null> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("quotes").select(`*, ${PROSPECT_EMBED}, quote_items(*)`).eq("id", id).maybeSingle();
  if (error) fail("load", error);
  return data ? withProspect(data as unknown as Embedded) : null;
}

export async function listQuoteActivities(quoteId: string, limit = 100): Promise<QuoteActivityRecord[]> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("quote_activities")
    .select("id, type, title, description, metadata, created_at")
    .eq("quote_id", quoteId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("activity", error);
  return (data ?? []).map((a) => ({ id: a.id, type: a.type, title: a.title, description: a.description, metadata: (a.metadata ?? {}) as Record<string, unknown>, createdAt: a.created_at }));
}

/** Every quote of one prospect, newest first (for the prospect's Related panel and timeline). */
export async function listQuotesForProspect(prospectId: string): Promise<QuoteWithProspect[]> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("quotes").select(`*, ${PROSPECT_EMBED}`).eq("prospect_id", prospectId).order("created_at", { ascending: false }).limit(100);
  if (error) fail("prospect quotes", error);
  return ((data ?? []) as unknown as Embedded[]).map(withProspect);
}

/** The few quote events that belong on a prospect's timeline (they link to the quote; nothing is copied). */
export async function listQuoteEventsForProspect(prospectId: string): Promise<ProspectQuoteEvent[]> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("quote_activities")
    .select("id, type, title, created_at, quote_id, quotes!inner(quote_number, prospect_id)")
    .eq("quotes.prospect_id", prospectId)
    .in("type", ["created", "sent", "accepted", "rejected", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) fail("prospect quote events", error);
  return ((data ?? []) as unknown as Array<{ id: string; type: string; title: string; created_at: string; quote_id: string; quotes: { quote_number: string } }>).map((a) => ({
    id: a.id,
    quoteId: a.quote_id,
    quoteNumber: a.quotes.quote_number,
    type: a.type,
    title: a.title,
    createdAt: a.created_at,
  }));
}

export async function getQuoteMetrics(today = brusselsToday()): Promise<QuoteMetrics> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("quotes").select("status, valid_until, subtotal, discount_total, total").in("status", ["draft", "ready", "sent", "accepted"]).limit(5000);
  if (error) fail("metrics", error);
  return summarizeQuotes(
    (data ?? []).map((r) => ({
      status: r.status as QuoteStatus,
      validUntil: r.valid_until,
      netCents: decimalToCents(r.subtotal) - decimalToCents(r.discount_total),
      totalCents: decimalToCents(r.total),
    })),
    today,
  );
}

export async function getQuoteSettings(): Promise<QuoteSettings> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("quote_settings").select("*").maybeSingle();
  if (error) fail("settings", error);
  if (!data) return DEFAULT_SETTINGS;
  return {
    defaultLanguage: data.default_language as QuoteSettings["defaultLanguage"],
    defaultTaxRate: Number(data.default_tax_rate),
    defaultValidityDays: data.default_validity_days,
    defaultIntro: data.default_intro ?? "",
    defaultTerms: data.default_terms ?? "",
    businessName: data.business_name,
    businessTagline: data.business_tagline ?? "",
    businessEmail: data.business_email ?? "",
    businessWebsite: data.business_website ?? "",
    businessPhone: data.business_phone ?? "",
    businessAddress: data.business_address ?? "",
    businessVatNumber: data.business_vat_number ?? "",
    businessIban: data.business_iban ?? "",
  };
}

export async function listTemplates(opts: { includeInactive?: boolean } = {}): Promise<QuoteTemplateRecord[]> {
  const { supabase } = await requireAdmin();
  let query = supabase.from("quote_item_templates").select("*").order("sort_order").order("name");
  if (!opts.includeInactive) query = query.eq("active", true);
  const { data, error } = await query.limit(500);
  if (error) fail("templates", error);
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description ?? "",
    defaultUnit: t.default_unit ?? "",
    defaultUnitPrice: t.default_unit_price === null ? "" : Number(t.default_unit_price).toFixed(2),
    defaultTaxRate: Number(t.default_tax_rate),
    active: t.active,
    sortOrder: t.sort_order,
  }));
}

export type ProspectOption = { id: string; companyName: string; contactName: string | null; email: string | null };

/** For the builder's "Prospect" picker. */
export async function listProspectOptions(): Promise<ProspectOption[]> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("prospects").select("id, company_name, contact_name, email").order("company_name").limit(5000);
  if (error) fail("prospect options", error);
  return (data ?? []).map((p) => ({ id: p.id, companyName: p.company_name, contactName: p.contact_name, email: p.email }));
}

export async function getProspectOption(id: string): Promise<ProspectOption | null> {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("prospects").select("id, company_name, contact_name, email").eq("id", id).maybeSingle();
  return data ? { id: data.id, companyName: data.company_name, contactName: data.contact_name, email: data.email } : null;
}
