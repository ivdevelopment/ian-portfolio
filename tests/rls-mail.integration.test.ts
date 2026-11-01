/**
 * Mail foundation tables against a REAL local Supabase stack: admin-only, idempotent by provider message id,
 * cascades. No Zoho call is made. Skipped unless run via `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLocalSupabase } from "./local-only";

const enabled = process.env.RLS_TEST === "1" || process.env.npm_lifecycle_event === "test:rls";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (enabled) assertLocalSupabase();

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const TAG = "mailtest";
const ADMIN = { email: `${TAG}-admin@portfolio.test`, password: "Mail-Admin-Password-2026!" };
const OUTSIDER = { email: `${TAG}-outsider@portfolio.test`, password: "Mail-Outsider-Password-2026!" };

describe.skipIf(!enabled)("mail foundation tables", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;
  let outsider: SupabaseClient;
  const userIds: string[] = [];
  let connectionId = "";
  let prospectId = "";

  const wipe = async () => {
    await service.from("mail_connections").delete().like("account_email", `${TAG}%`);
    await service.from("prospects").delete().like("company_name", `${TAG}%`);
  };

  beforeAll(async () => {
    service = createClient(url, serviceKey, opts);
    anon = createClient(url, anonKey, opts);
    const users = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of users.data!.users.filter((u) => u.email?.startsWith(TAG))) await service.auth.admin.deleteUser(u.id);
    for (const account of [ADMIN, OUTSIDER]) {
      const made = await service.auth.admin.createUser({ ...account, email_confirm: true });
      expect(made.error).toBeNull();
      userIds.push(made.data.user!.id);
    }
    expect((await service.from("admin_users").insert({ user_id: userIds[0] })).error).toBeNull();
    admin = createClient(url, anonKey, opts);
    expect((await admin.auth.signInWithPassword(ADMIN)).error).toBeNull();
    outsider = createClient(url, anonKey, opts);
    expect((await outsider.auth.signInWithPassword(OUTSIDER)).error).toBeNull();
    await wipe();

    const conn = await admin
      .from("mail_connections")
      .insert({ account_email: `${TAG}@example.test`, provider_account_id: "123", data_center: "eu", scopes: "ZohoMail.messages.READ", refresh_token_encrypted: "v1.aa.bb.cc" })
      .select("id")
      .single();
    expect(conn.error).toBeNull();
    connectionId = conn.data!.id;
    const prospect = await admin.from("prospects").insert({ company_name: `${TAG} prospect`, email: "p@example.test" }).select("id").single();
    prospectId = prospect.data!.id;
  });
  afterAll(async () => {
    await wipe();
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  const message = (id: string, over: Record<string, unknown> = {}) => ({
    connection_id: connectionId,
    provider_message_id: id,
    direction: "incoming",
    from_address: "p@example.test",
    sent_at: "2026-11-01T10:00:00Z",
    subject: "Hello",
    snippet: "text",
    prospect_id: prospectId,
    ...over,
  });

  it("gives the public role and a signed-in non-admin no access to connections, tokens, runs or messages", async () => {
    await admin.from("mail_messages").insert(message("m-visible"));
    for (const client of [anon, outsider]) {
      for (const table of ["mail_connections", "mail_sync_runs", "mail_messages"]) {
        const read = await client.from(table).select("*");
        expect(read.data ?? [], `${table}`).toHaveLength(0);
      }
      expect((await client.from("mail_messages").insert(message("m-hack"))).error).not.toBeNull();
      expect((await client.from("mail_connections").update({ status: "needs_reconnect" }).eq("id", connectionId)).data ?? []).toHaveLength(0);
    }
    expect((await anon.from("mail_connections").select("refresh_token_encrypted")).error).not.toBeNull();
    expect((await service.from("mail_connections").select("status").eq("id", connectionId).single()).data!.status).toBe("connected");
  });

  it("lets the admin read and write, and keeps the stored token opaque", async () => {
    const read = await admin.from("mail_connections").select("refresh_token_encrypted").eq("id", connectionId).single();
    expect(read.data!.refresh_token_encrypted).toMatch(/^v1\./);
  });

  it("never duplicates a message: the provider message id is unique per connection", async () => {
    expect((await admin.from("mail_messages").insert(message("m-dup"))).error).toBeNull();
    expect((await admin.from("mail_messages").insert(message("m-dup"))).error?.code).toBe("23505");
    const upsert = await admin.from("mail_messages").upsert(message("m-dup"), { onConflict: "connection_id,provider_message_id", ignoreDuplicates: true });
    expect(upsert.error).toBeNull();
    expect((await admin.from("mail_messages").select("id").eq("provider_message_id", "m-dup")).data).toHaveLength(1);
  });

  it("validates the data it keeps (direction, data center, snippet length)", async () => {
    expect((await admin.from("mail_messages").insert(message("m-bad", { direction: "sideways" }))).error).not.toBeNull();
    expect((await admin.from("mail_messages").insert(message("m-long", { snippet: "x".repeat(501) }))).error).not.toBeNull();
    expect((await admin.from("mail_connections").insert({ account_email: `${TAG}2@example.test`, provider_account_id: "1", data_center: "mars", scopes: "x", refresh_token_encrypted: "v1.a.b.c" })).error).not.toBeNull();
  });

  it("removes a prospect's mail with the prospect, and all mail with the connection", async () => {
    const other = await admin.from("prospects").insert({ company_name: `${TAG} other` }).select("id").single();
    await admin.from("mail_messages").insert(message("m-other", { prospect_id: other.data!.id }));
    await admin.from("prospects").delete().eq("id", other.data!.id);
    expect((await service.from("mail_messages").select("id").eq("provider_message_id", "m-other")).data).toEqual([]);

    expect((await service.from("mail_messages").select("id").eq("connection_id", connectionId)).data!.length).toBeGreaterThan(0);
    await admin.from("mail_connections").delete().eq("id", connectionId);
    expect((await service.from("mail_messages").select("id").eq("connection_id", connectionId)).data).toEqual([]);
  });
});
