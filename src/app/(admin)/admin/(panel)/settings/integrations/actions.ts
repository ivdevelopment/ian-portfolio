"use server";

import { requireAdmin } from "@/lib/auth";
import { getZohoConfig } from "@/lib/mail/zoho/config";
import { disconnect, syncNow } from "@/lib/mail/zoho/service";
import type { SyncReport } from "@/lib/mail/zoho/sync";

export type ZohoActionResult = { ok: true; report?: SyncReport } | { ok: false; error: string };

/** "Check my mailbox": read-only dry run. Looks at a limited recent window and stores nothing. */
export async function zohoDryRunAction(): Promise<ZohoActionResult> {
  await requireAdmin();
  const config = getZohoConfig();
  if (!config.enabled) return { ok: false, error: config.reason ?? "Zoho Mail is not enabled." };
  try {
    return { ok: true, report: await syncNow(config, { dryRun: true, windowDays: 14 }) };
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
    return { ok: true, report: await syncNow(config, { dryRun: false, windowDays: 14 }) };
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
