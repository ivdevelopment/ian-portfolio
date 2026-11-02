import type { SupabaseClient } from "@supabase/supabase-js";
import { brusselsToday } from "@/lib/prospects/dates";
import type { Database } from "@/types/database";
import type { MailStore } from "./sync";
import type { MailRecord } from "./normalize";
import { suggestName, relatedProspects, type CandidateRow, type CandidateStatus, type NameBasis, type RelatedProspect } from "./prospect-candidates";

/**
 * Prospect candidates in the database. Every function takes the signed-in admin's client, so RLS decides who may do what.
 * Nothing here talks to Zoho; "Add as prospect" and "Ignore" are the only things that ever decide a candidate.
 */
type Db = SupabaseClient<Database>;

const ORIGIN = "Zoho outreach";

/* --------------------------------- the sync side --------------------------------- */

export function candidateStore(supabase: Db, connectionId: string): Pick<MailStore, "candidateRows" | "saveCandidates"> {
  return {
    async candidateRows(addresses) {
      const { data, error } = await supabase
        .from("mail_prospect_candidates")
        .select("address, display_name, status, subject, first_message_at, last_message_at, message_count, messages")
        .eq("connection_id", connectionId)
        .in("address", [...addresses]);
      if (error) throw new Error("candidates unavailable");
      return new Map((data ?? []).map((r) => [r.address, { ...r, status: r.status as CandidateStatus, messages: r.messages as unknown as MailRecord[] } satisfies CandidateRow]));
    },
    async saveCandidates(rows) {
      // New addresses are inserted (an existing row is never overwritten here); known ones are updated only while still pending,
      // so a sync that raced with Add/Ignore can never bring a decided candidate back.
      const full = rows.map((r) => ({ ...r, connection_id: connectionId, messages: r.messages as never }));
      const inserted = await supabase.from("mail_prospect_candidates").upsert(full, { onConflict: "connection_id,address", ignoreDuplicates: true });
      if (inserted.error) throw new Error("candidates could not be saved");
      for (const r of full) {
        const { address, ...rest } = r;
        // `status` is deliberately part of the patch: it is 'pending' here, and the guard below only ever matches pending rows.
        const updated = await supabase.from("mail_prospect_candidates").update(rest).eq("connection_id", connectionId).eq("address", address).eq("status", "pending");
        if (updated.error) throw new Error("candidates could not be saved");
      }
    },
  };
}

export async function countPendingCandidates(supabase: Db, connectionId: string): Promise<number> {
  const { count } = await supabase.from("mail_prospect_candidates").select("id", { count: "exact", head: true }).eq("connection_id", connectionId).eq("status", "pending");
  return count ?? 0;
}

/* ------------------------------------ review ------------------------------------ */

export type CandidateView = {
  id: string;
  address: string;
  suggestedName: { value: string; basis: NameBasis };
  subject: string | null;
  /** The first outgoing message to this address (when contact started) and the latest one. */
  firstAt: string;
  lastAt: string;
  messageCount: number;
  direction: "outgoing";
  related: RelatedProspect[];
  /** Why this is shown as a candidate and not as a prospect. */
  why: string;
};

export async function listPendingCandidates(supabase: Db, limit = 50): Promise<CandidateView[]> {
  const { data, error } = await supabase
    .from("mail_prospect_candidates")
    .select("id, address, display_name, subject, first_message_at, last_message_at, message_count")
    .eq("status", "pending")
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error || !data || data.length === 0) return [];
  const { data: prospects } = await supabase.from("prospects").select("id, company_name, email, website_url").limit(20000);
  return data.map((c) => {
    const related = relatedProspects(c.address, prospects ?? []);
    const sameAddress = related.some((r) => r.reason === "same email address");
    return {
      id: c.id,
      address: c.address,
      suggestedName: suggestName(c.address, c.display_name),
      subject: c.subject,
      firstAt: c.first_message_at,
      lastAt: c.last_message_at,
      messageCount: c.message_count,
      direction: "outgoing" as const,
      related,
      why: sameAddress
        ? "A prospect with this address exists now: adding links the mail to it."
        : related.length > 0
          ? "No prospect has this exact address, but a prospect at the same domain exists."
          : "You wrote to this address, and no prospect has it.",
    };
  });
}

/* ------------------------------------ decide ------------------------------------ */

export type CandidateDecision =
  | { ok: true; prospectId: string; company: string; linkedMessages: number; existing: boolean }
  | { ok: false; error: string };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * "Add as prospect": the only way a candidate becomes a prospect, and only when a person asked. The claim (pending -> added)
 * is atomic, so a double click or two tabs create one prospect. If a prospect with that exact address already exists the
 * candidate links to it instead of creating a second one. The mail it carries is then stored once (provider id is the key).
 */
export async function addCandidateAsProspect(supabase: Db, userId: string, id: string, companyName?: string | null): Promise<CandidateDecision> {
  const claimed = await supabase
    .from("mail_prospect_candidates")
    .update({ status: "added", decided_at: new Date().toISOString(), decided_by: userId })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, connection_id, address, display_name, subject, first_message_at, last_message_at, messages")
    .maybeSingle();
  if (claimed.error) return { ok: false, error: "That couldn't be saved. Please try again." };

  if (!claimed.data) {
    // Already decided (double click, another tab): say what happened instead of creating anything.
    const current = await supabase.from("mail_prospect_candidates").select("status, prospect_id").eq("id", id).maybeSingle();
    if (current.data?.status === "added" && current.data.prospect_id) {
      const p = await supabase.from("prospects").select("company_name").eq("id", current.data.prospect_id).maybeSingle();
      return { ok: true, prospectId: current.data.prospect_id, company: p.data?.company_name ?? "", linkedMessages: 0, existing: true };
    }
    if (current.data?.status === "added") return { ok: false, error: "This candidate is already being added. Refresh in a moment." };
    return { ok: false, error: current.data ? "This candidate was already decided." : "Candidate not found." };
  }
  const candidate = claimed.data;
  const revert = () => supabase.from("mail_prospect_candidates").update({ status: "pending", decided_at: null, decided_by: null }).eq("id", id);

  const existing = await supabase.from("prospects").select("id, company_name").ilike("email", escapeLike(candidate.address)).limit(2);
  if (existing.error) {
    await revert();
    return { ok: false, error: "That couldn't be saved. Please try again." };
  }

  let prospectId: string;
  let company: string;
  let created = false;
  if (existing.data && existing.data.length === 1) {
    prospectId = existing.data[0].id;
    company = existing.data[0].company_name;
  } else if (existing.data && existing.data.length > 1) {
    await revert();
    return { ok: false, error: "Two prospects already use this address. Resolve that first." };
  } else {
    const name = (companyName ?? "").replace(/\s+/g, " ").trim() || suggestName(candidate.address, candidate.display_name).value;
    const first = brusselsToday(new Date(candidate.first_message_at));
    const last = brusselsToday(new Date(candidate.last_message_at));
    const inserted = await supabase
      .from("prospects")
      .insert({ company_name: name.slice(0, 200), email: candidate.address, status: "contacted", priority: "normal", source: ORIGIN, first_contact_on: first, last_contact_on: last })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      await revert();
      return { ok: false, error: inserted.error?.code === "23514" ? "That name was rejected. Check it and try again." : "That couldn't be saved. Please try again." };
    }
    prospectId = inserted.data.id;
    company = name;
    created = true;
    const messages = candidate.messages as unknown as MailRecord[];
    const oldest = [...messages].sort((a, b) => a.sent_at.localeCompare(b.sent_at))[0];
    const activity = await supabase.from("prospect_activities").insert({
      prospect_id: prospectId,
      type: "contacted",
      title: "First contact sent",
      description: `Created from unmatched outgoing Zoho mail after manual review${candidate.subject ? `: ${candidate.subject}` : "."}`.slice(0, 5000),
      occurred_on: first,
      occurred_at: candidate.first_message_at,
      metadata: { origin: "zoho_candidate", candidate_id: candidate.id, ...(oldest ? { provider_message_id: oldest.provider_message_id } : {}) } as never,
    });
    if (activity.error) {
      // A prospect without its audit trail is not acceptable: undo it and let the person try again.
      await supabase.from("prospects").delete().eq("id", prospectId);
      await revert();
      return { ok: false, error: "That couldn't be saved. Please try again." };
    }
  }

  // The pending mail is stored once, under its provider id; an id that is already stored is left alone.
  const messages = candidate.messages as unknown as MailRecord[];
  let linked = 0;
  if (messages.length > 0) {
    const stored = await supabase
      .from("mail_messages")
      .upsert(messages.map((m) => ({ ...m, connection_id: candidate.connection_id, prospect_id: prospectId })), { onConflict: "connection_id,provider_message_id", ignoreDuplicates: true })
      .select("id");
    if (stored.error) {
      if (created) await supabase.from("prospects").delete().eq("id", prospectId);
      await revert();
      return { ok: false, error: "The mail could not be linked. Nothing was changed; try again." };
    }
    linked = stored.data?.length ?? 0;
  }
  await supabase.from("mail_prospect_candidates").update({ prospect_id: prospectId, messages: [] }).eq("id", id);
  return { ok: true, prospectId, company, linkedMessages: linked, existing: !created };
}

export const IGNORE_NOTE = "Ignored by an admin after review; not proposed again.";

/**
 * "Ignore": an auditable decision, not a deletion. The address, the provider message ids and their metadata (subject, times, folder)
 * stay, with who ignored it, when, and why it no longer appears; only the mail snippets are dropped (no content is kept for a
 * message nobody wants). Restoring it later is just status = 'pending'. Zoho and any mail already linked in the CRM are not touched.
 */
export async function ignoreCandidate(supabase: Db, userId: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("mail_prospect_candidates")
    .update({ status: "ignored", ignored_at: now, decided_at: now, decided_by: userId, decision_note: IGNORE_NOTE })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, messages")
    .maybeSingle();
  if (error) return { ok: false, error: "That couldn't be saved. Please try again." };
  if (data) {
    const bare = (data.messages as unknown as MailRecord[]).map((m) => ({ ...m, snippet: null }));
    await supabase.from("mail_prospect_candidates").update({ messages: bare as never }).eq("id", id).eq("status", "ignored");
    return { ok: true };
  }
  const current = await supabase.from("mail_prospect_candidates").select("status").eq("id", id).maybeSingle();
  if (current.data?.status === "ignored") return { ok: true };
  return { ok: false, error: current.data ? "This candidate was already decided." : "Candidate not found." };
}
