/**
 * Prospect candidates against a REAL local Supabase stack: a sync proposes them, a person decides, and the data ends up
 * exactly once. No Zoho call is made (the mailbox is a fake). Skipped unless run via `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ZohoMailClient } from "@/lib/mail/zoho/client";
import { addCandidateAsProspect, candidateStore, countPendingCandidates, ignoreCandidate, listPendingCandidates } from "@/lib/mail/zoho/candidate-service";
import { runSync, type MailStore } from "@/lib/mail/zoho/sync";
import { assertLocalSupabase } from "./local-only";

const enabled = process.env.RLS_TEST === "1" || process.env.npm_lifecycle_event === "test:rls";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (enabled) assertLocalSupabase();

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const TAG = "mailcand";
const ADMIN = { email: `${TAG}-admin@portfolio.test`, password: "Cand-Admin-Password-2026!" };
const OUTSIDER = { email: `${TAG}-outsider@portfolio.test`, password: "Cand-Outsider-Password-2026!" };
const MAILBOX = `${TAG}-owner@mailowner.be`;

describe.skipIf(!enabled)("prospect candidates (sync -> review -> decision)", () => {
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let outsider: SupabaseClient;
  let adminId = "";
  const userIds: string[] = [];
  let connectionId = "";

  const wipe = async () => {
    await service.from("mail_connections").delete().like("account_email", `${TAG}%`);
    await service.from("prospects").delete().like("company_name", `${TAG}%`);
    await service.from("prospects").delete().like("email", `%@${TAG}%`);
  };

  beforeAll(async () => {
    service = createClient(url, serviceKey, opts);
    const users = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of users.data!.users.filter((u) => u.email?.startsWith(TAG))) await service.auth.admin.deleteUser(u.id);
    for (const account of [ADMIN, OUTSIDER]) {
      const made = await service.auth.admin.createUser({ ...account, email_confirm: true });
      expect(made.error).toBeNull();
      userIds.push(made.data.user!.id);
    }
    adminId = userIds[0];
    expect((await service.from("admin_users").insert({ user_id: adminId })).error).toBeNull();
    admin = createClient(url, anonKey, opts);
    expect((await admin.auth.signInWithPassword(ADMIN)).error).toBeNull();
    outsider = createClient(url, anonKey, opts);
    expect((await outsider.auth.signInWithPassword(OUTSIDER)).error).toBeNull();
    await wipe();

    const conn = await admin
      .from("mail_connections")
      .insert({ account_email: MAILBOX, provider_account_id: "123", data_center: "eu", scopes: "ZohoMail.messages.READ", refresh_token_encrypted: "v1.aa.bb.cc" })
      .select("id")
      .single();
    expect(conn.error).toBeNull();
    connectionId = conn.data!.id;
    expect((await admin.from("prospects").insert({ company_name: `${TAG} Existing`, email: `known@${TAG}-existing.be` })).error).toBeNull();

  });
  afterAll(async () => {
    await wipe();
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  const raw = (id: string, to: string, extra: Record<string, unknown> = {}) => ({ messageId: id, threadId: id, fromAddress: MAILBOX, toAddress: to, subject: `Subject ${id}`, summary: "text", sentDateInGMT: String(Date.parse("2026-11-02T09:00:00Z") + Number(id.replace(/\D/g, "")) * 1000), ...extra });
  const fakeClient = (page: Array<ReturnType<typeof raw>>) => ({ searchAll: async function* () { yield page; } }) as unknown as ZohoMailClient;

  /** The same store the production sync uses, minus the server-only wrapper. */
  const dbStore = (): MailStore => ({
    async existingIds(ids) {
      const { data } = await admin.from("mail_messages").select("provider_message_id").eq("connection_id", connectionId).in("provider_message_id", [...ids]);
      return new Set((data ?? []).map((r) => r.provider_message_id));
    },
    async save(records) {
      const { error } = await admin.from("mail_messages").upsert(records.map((r) => ({ ...r, connection_id: connectionId })), { onConflict: "connection_id,provider_message_id", ignoreDuplicates: true });
      if (error) throw new Error("save failed");
    },
    ...candidateStore(admin, connectionId),
  });
  const sync = async (page: Array<ReturnType<typeof raw>>) => {
    const { data } = await admin.from("prospects").select("id, email");
    return runSync({ client: fakeClient(page), accountId: "1", mailbox: MAILBOX, prospects: data ?? [], store: dbStore(), from: "2026-11-01", dryRun: false, sleep: async () => {} });
  };
  const count = async (table: string, filter: (q: ReturnType<SupabaseClient["from"]>) => unknown) => {
    const q = admin.from(table).select("id", { count: "exact", head: true });
    const { count: c } = (await (filter(q as never) as Promise<{ count: number | null }>)) as { count: number | null };
    return c ?? 0;
  };
  const prospectsAt = (email: string) => count("prospects", (q) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq("email", email));

  const NEW = `info@${TAG}-acme.be`;
  const OTHER = `info@${TAG}-skipme.be`;
  const MANUAL = `info@${TAG}-manual.be`;

  it("proposes an unknown recipient without creating a prospect or storing its mail; mail to a known prospect is stored", async () => {
    const report = await sync([
      raw("1", `known@${TAG}-existing.be`),
      raw("2", `"${TAG} Acme" <${NEW}>`),
      raw("3", `colleague@mailowner.be`),
      raw("4", OTHER, { subject: "Test" }),
      raw("5", MAILBOX),
      { ...raw("6", MAILBOX), fromAddress: `stranger@${TAG}-spam.be` },
    ]);
    expect(report).toMatchObject({ matched: 1, stored: 1, candidates: 1, errors: [] });
    expect(await prospectsAt(NEW)).toBe(0);
    expect(await count("mail_messages", (q) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq("connection_id", connectionId))).toBe(1);
    const pending = await listPendingCandidates(admin as never);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ address: NEW, suggestedName: { value: `${TAG} Acme`, basis: "header" }, direction: "outgoing", subject: "Subject 2" });
  });

  it("repeating the sync duplicates neither the candidate nor any mail", async () => {
    const again = await sync([raw("1", `known@${TAG}-existing.be`), raw("2", `"${TAG} Acme" <${NEW}>`)]);
    expect(again).toMatchObject({ candidates: 0, candidatesKnown: 1, stored: 0, alreadyStored: 1 });
    expect(await countPendingCandidates(admin as never, connectionId)).toBe(1);
  });

  it("Add as prospect creates exactly one Contacted prospect with its first-contact activity and stores the mail once", async () => {
    const [candidate] = await listPendingCandidates(admin as never);
    const result = await addCandidateAsProspect(admin as never, adminId, candidate.id, null);
    expect(result).toMatchObject({ ok: true, existing: false, linkedMessages: 1, company: `${TAG} Acme` });
    if (!result.ok) return;

    const prospect = await admin.from("prospects").select("*").eq("id", result.prospectId).single();
    expect(prospect.data).toMatchObject({ company_name: `${TAG} Acme`, email: NEW, status: "contacted", priority: "normal", source: "Zoho outreach", first_contact_on: "2026-11-02", last_contact_on: "2026-11-02", city: null, phone: null, website_url: null, sector: null, estimated_value_eur: null });
    expect(await prospectsAt(NEW)).toBe(1);

    const activities = await admin.from("prospect_activities").select("type, title, description, occurred_on").eq("prospect_id", result.prospectId);
    const first = activities.data!.find((a) => a.title === "First contact sent");
    expect(first).toMatchObject({ type: "contacted", occurred_on: "2026-11-02" });
    expect(first!.description).toContain("Created from unmatched outgoing Zoho mail after manual review");

    const mail = await admin.from("mail_messages").select("provider_message_id, prospect_id").eq("provider_message_id", "2");
    expect(mail.data).toEqual([{ provider_message_id: "2", prospect_id: result.prospectId }]);

    const row = await admin.from("mail_prospect_candidates").select("status, prospect_id, messages").eq("address", NEW).single();
    expect(row.data).toMatchObject({ status: "added", prospect_id: result.prospectId, messages: [] });
    expect(await countPendingCandidates(admin as never, connectionId)).toBe(0);
  });

  it("deciding again (double click, another tab) never creates a second prospect or a second copy of the mail", async () => {
    const row = await admin.from("mail_prospect_candidates").select("id").eq("address", NEW).single();
    const again = await addCandidateAsProspect(admin as never, adminId, row.data!.id, null);
    expect(again).toMatchObject({ ok: true, existing: true });
    expect(await prospectsAt(NEW)).toBe(1);
    expect(await count("mail_messages", (q) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq("provider_message_id", "2"))).toBe(1);
  });

  it("the next sync matches the new prospect: the mail is already stored, nothing is duplicated, nothing is proposed", async () => {
    const next = await sync([raw("2", `"${TAG} Acme" <${NEW}>`)]);
    expect(next).toMatchObject({ matched: 1, alreadyStored: 1, stored: 0, candidates: 0 });
  });

  it("two simultaneous 'Add' clicks create one prospect", async () => {
    const SIM = `info@${TAG}-sim.be`;
    await sync([raw("20", SIM)]);
    const row = await admin.from("mail_prospect_candidates").select("id").eq("address", SIM).single();
    const [a, b] = await Promise.all([addCandidateAsProspect(admin as never, adminId, row.data!.id, `${TAG} Sim`), addCandidateAsProspect(admin as never, adminId, row.data!.id, `${TAG} Sim`)]);
    // One click wins; the other is refused (or, if it arrives after the first finished, answered with the same prospect).
    expect([a, b].filter((r) => r.ok && !r.existing)).toHaveLength(1);
    expect([a, b].filter((r) => !r.ok || r.existing)).toHaveLength(1);
    expect(await prospectsAt(SIM)).toBe(1);
    expect(await count("mail_messages", (q) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq("provider_message_id", "20"))).toBe(1);
  });

  it("Ignore keeps an auditable decision (address, provider ids, metadata, when and who) without snippets, and the address never reappears", async () => {
    await sync([raw("30", OTHER)]);
    const before = await admin.from("mail_prospect_candidates").select("messages").eq("address", OTHER).single();
    expect((before.data!.messages as Array<{ snippet: string | null }>)[0].snippet).toBe("text");
    const row = await admin.from("mail_prospect_candidates").select("id").eq("address", OTHER).single();
    expect(await ignoreCandidate(admin as never, adminId, row.data!.id)).toEqual({ ok: true });
    expect(await ignoreCandidate(admin as never, adminId, row.data!.id)).toEqual({ ok: true });
    const kept = await admin.from("mail_prospect_candidates").select("status, address, subject, ignored_at, decided_by, decision_note, message_count, first_message_at, messages").eq("address", OTHER).single();
    expect(kept.data).toMatchObject({ status: "ignored", address: OTHER, subject: "Subject 30", decided_by: adminId, message_count: 1, decision_note: expect.stringMatching(/ignored by an admin/i) });
    expect(Date.now() - Date.parse(kept.data!.ignored_at)).toBeLessThan(60_000);
    expect(kept.data!.messages).toMatchObject([{ provider_message_id: "30", direction: "outgoing", to_addresses: [OTHER], subject: "Subject 30", snippet: null }]);
    expect(JSON.stringify(kept.data)).not.toContain("text\"");

    const later = await sync([raw("30", OTHER), raw("31", OTHER)]);
    expect(later).toMatchObject({ candidates: 0, errors: [] });
    expect((await listPendingCandidates(admin as never)).map((c) => c.address)).not.toContain(OTHER);
    expect(await prospectsAt(OTHER)).toBe(0);
    // A sync that raced with the decision and still holds the old pending row cannot bring it back.
    const store = candidateStore(admin as never, connectionId);
    await store.saveCandidates!([{ address: OTHER, display_name: null, status: "pending", subject: "Subject 31", first_message_at: "2026-11-02T09:00:00Z", last_message_at: "2026-11-02T09:00:00Z", message_count: 5, messages: [] }]);
    expect((await admin.from("mail_prospect_candidates").select("status, message_count").eq("address", OTHER).single()).data).toEqual({ status: "ignored", message_count: 1 });
  });

  it("an ignored candidate can be restored later (the data is kept) and then added normally", async () => {
    const row = await admin.from("mail_prospect_candidates").select("id").eq("address", OTHER).single();
    expect((await admin.from("mail_prospect_candidates").update({ status: "pending" }).eq("id", row.data!.id)).error).toBeNull();
    const added = await addCandidateAsProspect(admin as never, adminId, row.data!.id, `${TAG} Restored`);
    expect(added).toMatchObject({ ok: true, existing: false, linkedMessages: 1 });
    expect(await prospectsAt(OTHER)).toBe(1);
    expect((await admin.from("mail_messages").select("snippet, subject").eq("provider_message_id", "30").single()).data).toEqual({ snippet: null, subject: "Subject 30" });
  });

  it("a prospect created by hand in the meantime is reused: the candidate links to it instead of making a duplicate", async () => {
    await sync([raw("40", MANUAL)]);
    const made = await admin.from("prospects").insert({ company_name: `${TAG} Manual`, email: MANUAL.toUpperCase() }).select("id").single();
    const row = await admin.from("mail_prospect_candidates").select("id").eq("address", MANUAL).single();
    const result = await addCandidateAsProspect(admin as never, adminId, row.data!.id, null);
    expect(result).toMatchObject({ ok: true, existing: true, prospectId: made.data!.id });
    expect(await count("prospects", (q) => (q as unknown as { ilike: (c: string, v: string) => unknown }).ilike("email", MANUAL))).toBe(1);
    const mail = await admin.from("mail_messages").select("prospect_id").eq("provider_message_id", "40");
    expect(mail.data).toEqual([{ prospect_id: made.data!.id }]);
  });

  it("candidates are admin-only: the public role and a signed-in non-admin see and change nothing", async () => {
    const anon = createClient(url, anonKey, opts);
    for (const client of [anon, outsider]) {
      expect((await client.from("mail_prospect_candidates").select("*")).data ?? []).toHaveLength(0);
      expect((await client.from("mail_prospect_candidates").update({ status: "ignored" }).eq("connection_id", connectionId).select("id")).data ?? []).toHaveLength(0);
      expect((await client.from("mail_prospect_candidates").insert({ connection_id: connectionId, address: "x@y.be", first_message_at: "2026-11-02T09:00:00Z", last_message_at: "2026-11-02T09:00:00Z" })).error).not.toBeNull();
    }
  });
});
