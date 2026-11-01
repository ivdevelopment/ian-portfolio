/**
 * Access tracking against a REAL local Supabase stack: only a correct access code counts, history survives resets,
 * disables and target changes, concurrent unlocks are atomic, and a linked prospect gets ONE "Preview viewed" note.
 * Skipped unless run via `npm run test:rls`.
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
const TAG = "pvacc";
const ADMIN = { email: `${TAG}-admin@portfolio.test`, password: "PV-Admin-Password-2026!" };
const CODE = "GK-7F3K-9MQX-P4TD";
const sub = (n: string) => `${TAG}-${n}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!enabled)("preview access tracking", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;
  let adminId = "";

  const make = async (n: string) => {
    const { data, error } = await admin.rpc("create_client_preview", {
      p_client_name: "Test",
      p_project_name: "T",
      p_subdomain: sub(n),
      p_target_url: "https://client-site.example-host.com",
      p_code: CODE,
      p_expires_at: null,
      p_session_ttl_hours: 168,
      p_notes: null,
    });
    expect(error).toBeNull();
    return data as string;
  };
  const unlock = (n: string, code = CODE, ip = "ip-a") => anon.rpc("verify_preview_access", { p_subdomain: sub(n), p_code: code, p_ip_hash: ip });
  const stats = async (id: string) =>
    (await service.from("client_previews").select("first_accessed_at, last_accessed_at, successful_access_count").eq("id", id).single()).data!;
  const wipe = async () => {
    await service.from("prospects").delete().like("company_name", `${TAG}%`);
    await service.from("client_previews").delete().like("subdomain", `${TAG}-%`);
  };

  beforeAll(async () => {
    service = createClient(url, serviceKey, opts);
    anon = createClient(url, anonKey, opts);
    const users = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of users.data!.users.filter((u) => u.email?.startsWith(TAG))) await service.auth.admin.deleteUser(u.id);
    const made = await service.auth.admin.createUser({ ...ADMIN, email_confirm: true });
    expect(made.error).toBeNull();
    adminId = made.data.user!.id;
    expect((await service.from("admin_users").insert({ user_id: adminId })).error).toBeNull();
    admin = createClient(url, anonKey, opts);
    expect((await admin.auth.signInWithPassword(ADMIN)).error).toBeNull();
    await wipe();
  });
  afterAll(async () => {
    await wipe();
    await service.auth.admin.deleteUser(adminId);
  });

  it("starts as never viewed", async () => {
    const id = await make("new");
    expect(await stats(id)).toEqual({ first_accessed_at: null, last_accessed_at: null, successful_access_count: 0 });
  });

  it("does not count wrong codes, unknown or disabled previews, or rate-limited attempts", async () => {
    const id = await make("wrong");
    for (let i = 0; i < 7; i++) await unlock("wrong", "WRONG-CODE-0000", "ip-w");
    expect((await unlock("wrong", CODE, "ip-w")).data).toEqual({ result: "limited" });
    expect((await unlock("does-not-exist")).data).toEqual({ result: "missing" });
    await admin.from("client_previews").update({ active: false }).eq("id", id);
    expect((await unlock("wrong", CODE, "ip-other")).data).toEqual({ result: "unavailable" });
    expect(await stats(id)).toEqual({ first_accessed_at: null, last_accessed_at: null, successful_access_count: 0 });
  });

  it("records the first unlock, then keeps first_accessed_at and moves last_accessed_at", async () => {
    const id = await make("twice");
    expect((await unlock("twice")).data).toMatchObject({ result: "ok" });
    const one = await stats(id);
    expect(one.successful_access_count).toBe(1);
    expect(one.first_accessed_at).not.toBeNull();
    expect(one.last_accessed_at).toBe(one.first_accessed_at);

    await sleep(30);
    expect((await unlock("twice")).data).toMatchObject({ result: "ok" });
    const two = await stats(id);
    expect(two.successful_access_count).toBe(2);
    expect(two.first_accessed_at).toBe(one.first_accessed_at);
    expect(new Date(two.last_accessed_at!).getTime()).toBeGreaterThan(new Date(one.last_accessed_at!).getTime());
  });

  it("keeps the history through a code reset, disable / re-enable and a target change", async () => {
    const id = await make("history");
    await unlock("history");
    await unlock("history");
    const before = await stats(id);
    expect(before.successful_access_count).toBe(2);

    expect((await admin.rpc("reset_preview_access_code", { p_id: id, p_code: "GK-NEW1-CODE-2026" })).error).toBeNull();
    expect(await stats(id)).toEqual(before);
    // The old code no longer counts, the new one does.
    expect((await unlock("history", CODE, "ip-b")).data).toEqual({ result: "denied" });
    expect(await stats(id)).toEqual(before);

    await admin.from("client_previews").update({ active: false }).eq("id", id);
    await admin.from("client_previews").update({ active: true }).eq("id", id);
    await admin.from("client_previews").update({ target_url: "https://other-site.example-host.com" }).eq("id", id);
    expect(await stats(id)).toEqual(before);

    expect((await unlock("history", "GK-NEW1-CODE-2026", "ip-c")).data).toMatchObject({ result: "ok" });
    const after = await stats(id);
    expect(after.successful_access_count).toBe(3);
    expect(after.first_accessed_at).toBe(before.first_accessed_at);
  });

  it("counts concurrent successful unlocks atomically", async () => {
    const id = await make("race");
    const results = await Promise.all(Array.from({ length: 25 }, () => unlock("race")));
    expect(results.every((r) => (r.data as { result: string }).result === "ok")).toBe(true);
    const s = await stats(id);
    expect(s.successful_access_count).toBe(25);
    expect(s.first_accessed_at).not.toBeNull();
  });

  it("is not writable through the API by anyone", async () => {
    const id = await make("locked");
    for (const client of [anon, admin]) {
      expect((await client.from("client_previews").update({ successful_access_count: 50 }).eq("id", id)).error).not.toBeNull();
      expect((await client.from("client_previews").update({ first_accessed_at: new Date().toISOString() }).eq("id", id)).error).not.toBeNull();
    }
    expect((await anon.from("client_previews").select("successful_access_count").eq("id", id)).error).not.toBeNull();
    expect((await stats(id)).successful_access_count).toBe(0);
  });

  it("leaves exactly ONE 'Preview viewed' note on a linked prospect, and none for unlinked ones", async () => {
    const id = await make("crm");
    const linked = await service.from("prospects").insert({ company_name: `${TAG} linked`, linked_preview_id: id }).select("id").single();
    const other = await service.from("prospects").insert({ company_name: `${TAG} other` }).select("id").single();
    const notes = async (pid: string) =>
      (await service.from("prospect_activities").select("title, description").eq("prospect_id", pid).eq("type", "preview_viewed")).data!;

    expect(await notes(linked.data!.id)).toEqual([]);
    await unlock("crm", "WRONG-CODE-0000");
    expect(await notes(linked.data!.id)).toEqual([]);

    await unlock("crm");
    await unlock("crm");
    await unlock("crm");
    expect(await notes(linked.data!.id)).toEqual([{ title: "Preview viewed", description: "Client accessed the protected preview for the first time." }]);
    expect(await notes(other.data!.id)).toEqual([]);
  });

  it("lets the board filter prospects by their preview's viewed state in one query", async () => {
    const viewedId = await make("kb-viewed");
    const unviewedId = await make("kb-unviewed");
    await service.from("prospects").insert([
      { company_name: `${TAG} kb viewed`, linked_preview_id: viewedId },
      { company_name: `${TAG} kb unviewed`, linked_preview_id: unviewedId },
      { company_name: `${TAG} kb nopreview` },
    ]);
    await unlock("kb-viewed");

    const select = "company_name, linked_preview:client_previews!linked_preview_id!inner(subdomain, successful_access_count)";
    const viewed = await admin.from("prospects").select(select).like("company_name", `${TAG} kb%`).gt("linked_preview.successful_access_count", 0);
    expect(viewed.error).toBeNull();
    expect(viewed.data!.map((r) => r.company_name)).toEqual([`${TAG} kb viewed`]);
    const unviewed = await admin.from("prospects").select(select).like("company_name", `${TAG} kb%`).eq("linked_preview.successful_access_count", 0);
    expect(unviewed.data!.map((r) => r.company_name)).toEqual([`${TAG} kb unviewed`]);

    // The board's own query (left join): everything, with the preview state attached to the prospects that have one.
    const board = await admin.from("prospects").select("company_name, linked_preview:client_previews!linked_preview_id(successful_access_count)").like("company_name", `${TAG} kb%`);
    expect(board.data).toHaveLength(3);
  });

  it("a status change made from the board writes the normal status activity", async () => {
    const p = await admin.from("prospects").insert({ company_name: `${TAG} drag`, status: "replied" }).select("id").single();
    expect((await admin.from("prospects").update({ status: "concept_sent" }).eq("id", p.data!.id)).error).toBeNull();
    const log = await admin.from("prospect_activities").select("type, metadata").eq("prospect_id", p.data!.id).eq("type", "status_changed");
    expect(log.data).toEqual([{ type: "status_changed", metadata: { from: "replied", to: "concept_sent" } }]);
  });

  it("deleting a preview removes its tracking only, not the prospect", async () => {
    const id = await make("del");
    const p = await service.from("prospects").insert({ company_name: `${TAG} survivor`, linked_preview_id: id }).select("id").single();
    await unlock("del");
    expect((await admin.from("client_previews").delete().eq("id", id)).error).toBeNull();
    const left = await service.from("prospects").select("linked_preview_id").eq("id", p.data!.id).single();
    expect(left.data).toEqual({ linked_preview_id: null });
  });
});
