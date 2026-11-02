"use server";

import { requireAdmin } from "@/lib/auth";
import { getZohoConfig } from "@/lib/mail/zoho/config";
import { addCandidateAsProspect, ignoreCandidate } from "@/lib/mail/zoho/candidate-service";
import { disconnect, syncNow } from "@/lib/mail/zoho/service";
import { idSchema } from "@/lib/schemas/prospect";
import type { SyncReport } from "@/lib/mail/zoho/sync";

export type ZohoActionResult = { ok: true; report?: SyncReport } | { ok: false; error: string };

/** "Check my mailbox": read-only dry run. Looks at a limited recent window and stores nothing. */
export async function zohoDryRunAction(): Promise<ZohoActionResult> {
  await requireAdmin();
  const config = getZohoConfig();
  if (!config.enabled) return { ok: false, error: config.reason ?? "Zoho Mail is not enabled." };
  try {
    return { ok: true, report: await syncNow(config, { dryRun: true, windowDays: 30 }) };
  } catch {
    return { ok: false, error: "The check could not run. Is the mailbox connected?" };
  }
}

/** "Sync now": stores metadata of messages that match a prospect's email. Manual only: nothing runs on a schedule. */
export async function zohoSyncNowAction(): Promise<ZohoActionResult> {
  await requireAdmin();
  const config = getZohoConfig();
  if (!config.enabled) return { ok: false, error: config.reason ?? "Zoho Mail is not enabled." };
  try {
    return { ok: true, report: await syncNow(config, { dryRun: false, windowDays: 30 }) };
  } catch {
    return { ok: false, error: "The sync could not run. Is the mailbox connected?" };
  }
}

export async function zohoDisconnectAction(): Promise<ZohoActionResult> {
  await requireAdmin();
  const config = getZohoConfig();
  if (!config.enabled) return { ok: false, error: config.reason ?? "Zoho Mail is not enabled." };
  try {
    await disconnect(config);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not disconnect." };
  }
}

export type CandidateActionResult = { ok: true; prospectId?: string; company?: string; linkedMessages?: number; existing?: boolean } | { ok: false; error: string };

/** "Add as prospect": a person's explicit decision. Creates the prospect (Contacted, source "Zoho outreach") with its first-contact activity and stores the mail once. */
export async function addProspectCandidateAction(id: unknown, companyName?: unknown): Promise<CandidateActionResult> {
  const { supabase, userId } = await requireAdmin();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Candidate not found." };
  const name = typeof companyName === "string" ? companyName : null;
  if (name !== null && name.trim().length > 200) return { ok: false, error: "That name is too long (200 characters at most)." };
  return addCandidateAsProspect(supabase, userId, parsed.data, name);
}

/** "Ignore": the address is remembered so it is not proposed again. Nothing is deleted from Zoho. */
export async function ignoreProspectCandidateAction(id: unknown): Promise<CandidateActionResult> {
  const { supabase, userId } = await requireAdmin();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Candidate not found." };
  return ignoreCandidate(supabase, userId, parsed.data);
}
