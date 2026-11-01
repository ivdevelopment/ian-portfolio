import "server-only";

import { requireAdmin } from "@/lib/auth";
import { brusselsToday } from "@/lib/prospects/dates";
import { createTokenSource, ZohoMailClient } from "./client";
import { getZohoConfig, ZOHO_READ_SCOPES, type ZohoConfig } from "./config";
import { decryptToken, encryptToken } from "./crypto";
import { exchangeCode, revokeRefreshToken, ZohoError } from "./oauth";
import { emptyReport, incrementalStart, runSync, type MailStore, type SyncReport } from "./sync";
import type { MailRecord } from "./normalize";
import type { MailRow } from "@/lib/mail/timeline";

export type ConnectionSummary = {
  id: string;
  account_email: string;
  data_center: string;
  scopes: string;
  status: "connected" | "needs_reconnect";
  connected_at: string;
  last_sync_at: string | null;
  sync_from: string | null;
};

export type LastRun = {
  mode: "dry_run" | "sync";
  started_at: string;
  finished_at: string | null;
  messages_checked: number;
  messages_matched: number;
  messages_stored: number;
  errors: string[];
  preview: Array<{ prospect_id: string; direction: string; subject: string | null; sent_at: string }>;
};

/** Everything below runs on the server with the signed-in admin's session; the browser never sees a token. */
export async function getConnection(): Promise<ConnectionSummary | null> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("mail_connections")
    .select("id, account_email, data_center, scopes, status, connected_at, last_sync_at, sync_from")
    .eq("provider", "zoho")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Mail connection unavailable");
  return data as ConnectionSummary | null;
}

export async function getLastRun(connectionId: string): Promise<LastRun | null> {
  const { supabase } = await requireAdmin();
  const { data } = await supabase
    .from("mail_sync_runs")
    .select("mode, started_at, finished_at, messages_checked, messages_matched, messages_stored, errors, preview")
    .eq("connection_id", connectionId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as unknown as LastRun | null;
}

/** Callback step: swap the one-time code for tokens, look up the mailbox, and store the refresh token ENCRYPTED. */
export async function completeConnection(config: ZohoConfig, code: string): Promise<{ account: string }> {
  const { supabase, userId } = await requireAdmin();
  if (!config.encryptionKey) throw new ZohoError("Encryption key missing.", "auth");
  const tokens = await exchangeCode(config, code);
  if (!tokens.refreshToken) throw new ZohoError("Zoho did not return a refresh token. Reconnect and approve offline access.", "bad_response");

  const client = new ZohoMailClient(config, createTokenSource(config, tokens.refreshToken));
  const accounts = await client.getAccounts();
  const account = accounts.find((a) => a.primaryEmail === config.mailbox) ?? (config.mailbox ? undefined : accounts[0]);
  if (!account) throw new ZohoError(`The signed-in Zoho account does not own ${config.mailbox || "a mailbox"}.`, "auth");

  const { error } = await supabase.from("mail_connections").upsert(
    {
      provider: "zoho",
      account_email: account.primaryEmail,
      provider_account_id: account.accountId,
      data_center: config.dataCenter,
      scopes: tokens.scope || ZOHO_READ_SCOPES.join(","),
      refresh_token_encrypted: encryptToken(tokens.refreshToken, config.encryptionKey),
      status: "connected",
      connected_by: userId,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "provider,account_email" },
  );
  if (error) throw new Error("Could not save the connection.");
  return { account: account.primaryEmail };
}

export async function disconnect(config: ZohoConfig): Promise<void> {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("mail_connections").select("id, refresh_token_encrypted").eq("provider", "zoho").limit(1).maybeSingle();
  if (!data) return;
  if (config.encryptionKey) {
    try {
      await revokeRefreshToken(config, decryptToken(data.refresh_token_encrypted, config.encryptionKey));
    } catch {
      /* Undecryptable or already revoked: it is removed locally either way. */
    }
  }
  // Synced messages go with the connection (ON DELETE CASCADE): disconnecting removes the mail copy.
  await supabase.from("mail_connections").delete().eq("id", data.id);
}

function supabaseStore(supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"], connectionId: string): MailStore {
  return {
    async existingIds(ids) {
      const { data } = await supabase.from("mail_messages").select("provider_message_id").eq("connection_id", connectionId).in("provider_message_id", [...ids]);
      return new Set((data ?? []).map((r) => r.provider_message_id));
    },
    async save(records) {
      const rows = records.map((r: MailRecord & { prospect_id: string }) => ({ ...r, connection_id: connectionId }));
      const { error } = await supabase.from("mail_messages").upsert(rows, { onConflict: "connection_id,provider_message_id", ignoreDuplicates: true });
      if (error) throw new Error("save failed");
    },
  };
}

/** "Sync now" (and the read-only dry run). `windowDays` limits how far back a first run looks. */
export async function syncNow(config: ZohoConfig, opts: { dryRun: boolean; windowDays?: number }): Promise<SyncReport> {
  const { supabase } = await requireAdmin();
  if (!config.encryptionKey) throw new ZohoError("Encryption key missing.", "auth");
  const { data: conn } = await supabase.from("mail_connections").select("*").eq("provider", "zoho").limit(1).maybeSingle();
  if (!conn) throw new ZohoError("Zoho Mail is not connected.", "auth");

  const today = brusselsToday();
  const fallback = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) - (opts.windowDays ?? 14))).toISOString().slice(0, 10);
  const from = opts.dryRun ? fallback : incrementalStart(conn.sync_from, fallback);

  const run = await supabase.from("mail_sync_runs").insert({ connection_id: conn.id, mode: opts.dryRun ? "dry_run" : "sync", window_from: from }).select("id").single();
  const { data: prospects } = await supabase.from("prospects").select("id, email, company_name, notes").not("email", "is", null).limit(20000);
  // Prospects whose notes say a message was only seen in Drafts: their mail history is reported individually (notes are never changed).
  const watch = new Set((prospects ?? []).filter((p) => /zoho drafts/i.test(p.notes ?? "")).map((p) => p.id));
  const names = new Map((prospects ?? []).map((p) => [p.id, p.company_name]));

  let report: SyncReport;
  try {
    const refreshToken = decryptToken(conn.refresh_token_encrypted, config.encryptionKey);
    const client = new ZohoMailClient(config, createTokenSource(config, refreshToken));
    const folderNames = (await client.getFolderNames(conn.provider_account_id)) ?? undefined;
    report = await runSync({
      watch,
      folderNames,
      client,
      accountId: conn.provider_account_id,
      mailbox: conn.account_email,
      prospects: prospects ?? [],
      store: supabaseStore(supabase, conn.id),
      from,
      dryRun: opts.dryRun,
    });
  } catch (error) {
    const auth = error instanceof ZohoError && error.kind === "auth";
    if (auth) await supabase.from("mail_connections").update({ status: "needs_reconnect" }).eq("id", conn.id);
    report = { ...emptyReport(opts.dryRun ? "dry_run" : "sync", from), errors: [auth ? "Zoho rejected the saved credentials. Reconnect the mailbox." : "The sync could not run."] };
  }

  report.watched = report.watched.map((w) => ({ ...w, company: names.get(w.prospect_id) }));
  if (run.data) {
    await supabase
      .from("mail_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        messages_checked: report.checked,
        messages_matched: report.matched,
        messages_stored: report.stored,
        errors: report.errors as never,
        preview: { sample: report.preview, watched: report.watched, outgoingByFolder: report.outgoingByFolder, stats: { unique: report.unique, incoming: report.incoming, outgoing: report.outgoing, unmatched: report.unmatched, ambiguous: report.ambiguous, duplicateIds: report.duplicateIds, rateLimitRetries: report.rateLimitRetries } } as never,
      })
      .eq("id", run.data.id);
  }
  // Only a clean, real sync moves the incremental position.
  if (!opts.dryRun && report.errors.length === 0) {
    await supabase.from("mail_connections").update({ last_sync_at: new Date().toISOString(), sync_from: today }).eq("id", conn.id);
  }
  return report;
}

/** The mail linked to one prospect, newest first (metadata only). Empty when the integration is off or not connected. */
export async function listProspectMail(prospectId: string): Promise<MailRow[]> {
  if (!getZohoConfig().enabled) return [];
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("mail_messages")
    .select("id, direction, from_address, subject, snippet, sent_at")
    .eq("prospect_id", prospectId)
    .order("sent_at", { ascending: false })
    .limit(100);
  if (error) return [];
  return (data ?? []) as MailRow[];
}
