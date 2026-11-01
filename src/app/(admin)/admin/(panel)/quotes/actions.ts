"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { QUOTE_LANGUAGES, QUOTE_STATUSES, VAT_RATES, canTransition, isDeletable, type QuoteStatus } from "@/lib/quotes/constants";
import { formFromQuote } from "@/lib/quotes/form";
import { MoneyError, centsToDecimal, parsePriceCents } from "@/lib/quotes/money";
import { readinessIssues, toRpcPayload, validateDraft, type QuoteFormValues } from "@/lib/quotes/schema";
import { toQuoteRecord } from "@/lib/quotes/types";
import { isIsoDay } from "@/lib/prospects/dates";
import { convertToProjectAction } from "../prospects/actions";

type Failure = { ok: false; error: string; fieldErrors?: Record<string, string> };
export type QuoteActionResult<T extends object = object> = ({ ok: true } & T) | Failure;

const idSchema = z.string().uuid();
const notFound: Failure = { ok: false, error: "Quote not found." };

type DbError = { code?: string; message: string };

/**
 * Messages raised by our own database functions (transition rules, locked quotes, "changed elsewhere") are written for people and
 * are passed through. Anything else is logged and replaced with a generic line.
 */
function dbFailure(error: DbError): Failure {
  const ours = (error.code === "23514" || error.code === "P0001") && !/violates (check|foreign key|unique)/i.test(error.message) && !/^new row/i.test(error.message);
  if (ours) return { ok: false, error: error.message };
  const known: Record<string, string> = {
    "42501": "You don't have permission to do that.",
    "23503": "A linked record no longer exists.",
    "23505": "That quote number already exists. Try again.",
    "23514": "A value was rejected by the database. Check the fields and try again.",
  };
  if (!known[error.code ?? ""]) console.error("[quotes] database error:", error.code, error.message);
  return { ok: false, error: known[error.code ?? ""] ?? "That couldn't be saved. Please try again." };
}

function prepare(input: unknown): { ok: true; payload: ReturnType<typeof toRpcPayload> } | Failure {
  const values = input as QuoteFormValues;
  if (!values || typeof values !== "object" || !Array.isArray(values.items)) return { ok: false, error: "That quote could not be read." };
  const errors = validateDraft(values);
  if (Object.keys(errors).length) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: errors };
  try {
    // The figures are recalculated here from the raw inputs; whatever the browser calculated is never trusted.
    return { ok: true, payload: toRpcPayload(values) };
  } catch (error) {
    return { ok: false, error: error instanceof MoneyError ? error.message : "The amounts could not be calculated." };
  }
}

/* ------------------------------ create / edit / duplicate / delete ------------------------------ */

export async function createQuoteAction(input: unknown): Promise<QuoteActionResult<{ id: string }>> {
  const { supabase } = await requireAdmin();
  const prepared = prepare(input);
  if (!prepared.ok) return prepared;
  const { data, error } = await supabase.rpc("create_quote", { p_quote: prepared.payload.quote as never, p_items: prepared.payload.items as never });
  if (error) return dbFailure(error);
  return { ok: true, id: data };
}

export async function updateQuoteAction(id: string, input: unknown, expectedUpdatedAt: string | null): Promise<QuoteActionResult<{ updatedAt: string }>> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  const prepared = prepare(input);
  if (!prepared.ok) return prepared;
  const { data, error } = await supabase.rpc("update_quote", {
    p_id: id,
    p_quote: prepared.payload.quote as never,
    p_items: prepared.payload.items as never,
    p_expected_updated_at: expectedUpdatedAt as never,
  });
  if (error) return dbFailure(error);
  return { ok: true, updatedAt: data as string };
}

export async function duplicateQuoteAction(id: string): Promise<QuoteActionResult<{ id: string }>> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  const { data, error } = await supabase.rpc("duplicate_quote", { p_id: id });
  if (error) return dbFailure(error);
  return { ok: true, id: data };
}

/** Drafts only: anything that has been sent (or answered, or cancelled) is kept as the record. */
export async function deleteQuoteAction(id: string): Promise<QuoteActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  const { data: quote } = await supabase.from("quotes").select("status").eq("id", id).maybeSingle();
  if (!quote) return notFound;
  if (!isDeletable(quote.status as QuoteStatus)) return { ok: false, error: "Only drafts can be deleted. Cancel this quote instead." };
  const { data, error } = await supabase.from("quotes").delete().eq("id", id).select("id");
  if (error) return dbFailure(error);
  return data?.length ? { ok: true } : notFound;
}

/* ------------------------------ status workflow ------------------------------ */

const statusInput = z.object({
  to: z.enum(QUOTE_STATUSES),
  note: z.string().trim().max(2000, "Keep the note under 2,000 characters.").optional(),
  validUntil: z.string().refine(isIsoDay, "Pick a valid date.").optional(),
});

export async function changeQuoteStatusAction(id: string, input: unknown): Promise<QuoteActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  const parsed = statusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { to, note, validUntil } = parsed.data;

  const { data: row } = await supabase.from("quotes").select("*, quote_items(*)").eq("id", id).maybeSingle();
  if (!row) return notFound;
  const quote = toQuoteRecord(row, row.quote_items ?? []);
  if (!canTransition(quote.status, to)) return { ok: false, error: `A quote that is ${quote.status} cannot become ${to}.` };

  // The same completeness check the database applies, with a readable list of what is missing.
  if ((to === "ready" || to === "sent") && (quote.status === "draft" || quote.status === "ready")) {
    const issues = readinessIssues(formFromQuote(quote));
    if (issues.length) return { ok: false, error: issues.join(" ") };
  }

  const patch: Record<string, unknown> = { status: to, status_note: note ? note : null };
  if (validUntil) patch.valid_until = validUntil;
  const { error } = await supabase.from("quotes").update(patch as never).eq("id", id);
  return error ? dbFailure(error) : { ok: true };
}

export async function extendValidityAction(id: string, validUntil: unknown): Promise<QuoteActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  if (typeof validUntil !== "string" || !isIsoDay(validUntil)) return { ok: false, error: "Pick a valid date." };
  const { error } = await supabase.from("quotes").update({ valid_until: validUntil }).eq("id", id);
  return error ? dbFailure(error) : { ok: true };
}

/* ------------------------------ CRM follow-through (each one is an explicit, confirmed choice) ------------------------------ */

/** Sets the prospect's own `quote_value_eur` to this quote's total. Never done silently. */
export async function setProspectQuoteValueAction(prospectId: string, totalCents: unknown): Promise<QuoteActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(prospectId).success) return notFound;
  if (typeof totalCents !== "number" || !Number.isInteger(totalCents) || totalCents < 0) return { ok: false, error: "That amount is not valid." };
  const { error } = await supabase.from("prospects").update({ quote_value_eur: centsToDecimal(totalCents) as never }).eq("id", prospectId);
  return error ? dbFailure(error) : { ok: true };
}

/** Creates the (unpublished) project draft for the quote's prospect and links it to the quote. */
export async function createProjectFromQuoteAction(quoteId: string): Promise<QuoteActionResult<{ projectId: string }>> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(quoteId).success) return notFound;
  const { data: quote } = await supabase.from("quotes").select("status, prospect_id, project_id").eq("id", quoteId).maybeSingle();
  if (!quote) return notFound;
  if (quote.status !== "accepted") return { ok: false, error: "Only an accepted quote can be turned into a project." };
  if (quote.project_id) return { ok: false, error: "This quote is already linked to a project." };
  if (!quote.prospect_id) return { ok: false, error: "This quote is not linked to a prospect, so there is nothing to convert." };

  const created = await convertToProjectAction(quote.prospect_id);
  if (!created.ok) return created;
  const { error } = await supabase.from("quotes").update({ project_id: created.projectId }).eq("id", quoteId);
  if (error) return dbFailure(error);
  return { ok: true, projectId: created.projectId };
}

/* ------------------------------ item templates ------------------------------ */

const templateSchema = z.object({
  name: z.string().trim().min(1, "Give the service a name.").max(160, "Keep the name under 160 characters."),
  description: z.string().trim().max(5000, "Keep the description under 5,000 characters."),
  defaultUnit: z.string().trim().max(30, "Keep the unit under 30 characters."),
  defaultUnitPrice: z.string().trim(),
  defaultTaxRate: z.number().refine((r) => (VAT_RATES as readonly number[]).includes(r), "Choose 0%, 6%, 12% or 21%."),
  active: z.boolean(),
});
export type TemplateInput = z.input<typeof templateSchema>;

export async function saveTemplateAction(id: string | null, input: unknown): Promise<QuoteActionResult<{ id: string }>> {
  const { supabase } = await requireAdmin();
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "name")] ??= issue.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;
  let price: string | null = null;
  if (v.defaultUnitPrice !== "") {
    try {
      price = centsToDecimal(parsePriceCents(v.defaultUnitPrice));
    } catch {
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { defaultUnitPrice: "Enter a price like 800 or 47.50." } };
    }
  }
  const row = {
    name: v.name,
    description: v.description || null,
    default_unit: v.defaultUnit || null,
    default_unit_price: price as never,
    default_tax_rate: v.defaultTaxRate,
    active: v.active,
  };
  if (id === null) {
    const { data, error } = await supabase.from("quote_item_templates").insert(row).select("id").single();
    return error ? dbFailure(error) : { ok: true, id: data.id };
  }
  if (!idSchema.safeParse(id).success) return notFound;
  const { error } = await supabase.from("quote_item_templates").update(row).eq("id", id);
  return error ? dbFailure(error) : { ok: true, id };
}

/** Deleting a template never touches quotes that used it: their lines are snapshots. */
export async function deleteTemplateAction(id: string): Promise<QuoteActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  const { error } = await supabase.from("quote_item_templates").delete().eq("id", id);
  return error ? dbFailure(error) : { ok: true };
}

/* ------------------------------ settings ------------------------------ */

const settingsSchema = z.object({
  defaultLanguage: z.enum(QUOTE_LANGUAGES),
  defaultTaxRate: z.number().refine((r) => (VAT_RATES as readonly number[]).includes(r), "Choose 0%, 6%, 12% or 21%."),
  defaultValidityDays: z.number().int("Use whole days.").min(1, "At least 1 day.").max(365, "At most 365 days."),
  defaultIntro: z.string().trim().max(5000, "Keep the introduction under 5,000 characters."),
  defaultTerms: z.string().trim().max(10000, "Keep the terms under 10,000 characters."),
  businessName: z.string().trim().min(1, "Enter your business name.").max(160),
  businessTagline: z.string().trim().max(160),
  businessEmail: z.string().trim().max(320).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address."),
  businessWebsite: z.string().trim().max(300),
  businessPhone: z.string().trim().max(60),
  businessAddress: z.string().trim().max(500),
  businessVatNumber: z.string().trim().max(40),
  businessIban: z.string().trim().max(40),
});

export async function saveQuoteSettingsAction(input: unknown): Promise<QuoteActionResult> {
  const { supabase } = await requireAdmin();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;
  const nul = (s: string) => (s === "" ? null : s);
  const { error } = await supabase
    .from("quote_settings")
    .update({
      default_language: v.defaultLanguage,
      default_tax_rate: v.defaultTaxRate,
      default_validity_days: v.defaultValidityDays,
      default_intro: nul(v.defaultIntro),
      default_terms: nul(v.defaultTerms),
      business_name: v.businessName,
      business_tagline: nul(v.businessTagline),
      business_email: nul(v.businessEmail),
      business_website: nul(v.businessWebsite),
      business_phone: nul(v.businessPhone),
      business_address: nul(v.businessAddress),
      business_vat_number: nul(v.businessVatNumber),
      business_iban: nul(v.businessIban),
    })
    .eq("id", true);
  return error ? dbFailure(error) : { ok: true };
}
