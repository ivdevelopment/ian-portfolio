/**
 * Row Level Security / authorisation checks against a REAL Supabase stack.
 * Skipped unless run via `npm run test:rls` (or RLS_TEST=1). Needs `npm run db:start` + .env.local:
 *
 *   npm run test:rls
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RLS_TEST === "1" || process.env.npm_lifecycle_event === "test:rls";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "admin@portfolio.test";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "LocalDev-Admin-2026!";

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const DRAFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTSIDER_EMAIL = "outsider@portfolio.test";
const OUTSIDER_PASSWORD = "Outsider-Password-1!";
const BUCKET = "project-media";

describe.skipIf(!enabled)("RLS and authorisation", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let outsider: SupabaseClient; // authenticated, but NOT in admin_users
  let admin: SupabaseClient;
  let outsiderId: string;

  beforeAll(async () => {
    service = createClient(url, serviceKey, opts);
    anon = createClient(url, anonKey, opts);

    await service.from("projects").delete().eq("id", DRAFT_ID);
    const draft = await service.from("projects").insert({
      id: DRAFT_ID,
      slug: "rls-test-draft",
      title: "RLS test draft",
      short_description: "Draft that must never be public.",
      category: "Test",
      published: false,
    });
    expect(draft.error).toBeNull();
    await service.from("project_features").insert({ project_id: DRAFT_ID, label: "secret feature" });

    const list = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const old = list.data?.users.find((u) => u.email === OUTSIDER_EMAIL);
    if (old) await service.auth.admin.deleteUser(old.id);
    const created = await service.auth.admin.createUser({
      email: OUTSIDER_EMAIL,
      password: OUTSIDER_PASSWORD,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    outsiderId = created.data.user!.id;

    outsider = createClient(url, anonKey, opts);
    expect((await outsider.auth.signInWithPassword({ email: OUTSIDER_EMAIL, password: OUTSIDER_PASSWORD })).error).toBeNull();
    admin = createClient(url, anonKey, opts);
    expect((await admin.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).error).toBeNull();
  });

  afterAll(async () => {
    await service.from("projects").delete().eq("id", DRAFT_ID);
    await service.storage.from(BUCKET).remove(["projects/rls-test/admin.png"]);
    await service.from("inquiries").delete().eq("email", "rls-test@example.com");
    if (outsiderId) await service.auth.admin.deleteUser(outsiderId);
  });

  describe("anonymous visitors", () => {
    it("see published projects only — never drafts", async () => {
      const { data, error } = await anon.from("projects").select("id, slug, published");
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
      expect(data!.every((p) => p.published)).toBe(true);
      expect(data!.some((p) => p.id === DRAFT_ID)).toBe(false);
    });

    it("cannot read the features or media of a draft", async () => {
      const features = await anon.from("project_features").select("id").eq("project_id", DRAFT_ID);
      expect(features.data).toEqual([]);
      const media = await anon.from("project_media").select("id").eq("project_id", DRAFT_ID);
      expect(media.data).toEqual([]);
    });

    it("can read the features of published projects", async () => {
      const { data } = await anon.from("project_features").select("label");
      expect(data!.length).toBeGreaterThan(0);
    });

    it("cannot create, edit or delete projects", async () => {
      const insert = await anon.from("projects").insert({
        slug: "anon-hack", title: "x", short_description: "x", category: "x", published: true,
      });
      expect(insert.error).not.toBeNull();

      const update = await anon.from("projects").update({ title: "hacked" }).eq("published", true).select("id");
      expect(update.data ?? []).toEqual([]);

      const del = await anon.from("projects").delete().eq("published", true).select("id");
      expect(del.data ?? []).toEqual([]);
    });

    it("cannot read inquiries or admin_users, nor call admin functions", async () => {
      expect((await anon.from("inquiries").select("id")).error).not.toBeNull();
      expect((await anon.from("admin_users").select("user_id")).error).not.toBeNull();
      expect((await anon.rpc("is_admin")).error).not.toBeNull();
      expect((await anon.rpc("save_project", { p_id: DRAFT_ID, p_project: {}, p_features: [], p_media: [] })).error).not.toBeNull();
    });

    it("cannot register: public sign-up is disabled", async () => {
      const { data, error } = await anon.auth.signUp({ email: "signup-attempt@portfolio.test", password: "Some-Password-123!" });
      expect(error).not.toBeNull();
      expect(data.session).toBeNull();
    });

    it("cannot write to storage", async () => {
      const { error } = await anon.storage.from(BUCKET).upload("projects/rls-test/anon.png", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
      expect(error).not.toBeNull();
    });

    it("can submit an inquiry only through submit_inquiry, with validation", async () => {
      const valid = {
        p_name: "RLS Test", p_email: "rls-test@example.com", p_project_type: "New website",
        p_budget: "€1,000 – €2,500", p_message: "This is a test inquiry from the RLS suite.", p_ip_hash: "rls-test-hash",
      };
      const ok = await anon.rpc("submit_inquiry", valid);
      expect(ok.error).toBeNull();
      expect(ok.data).toBe("ok");

      expect((await anon.rpc("submit_inquiry", { ...valid, p_message: "short" })).error).not.toBeNull();
      expect((await anon.rpc("submit_inquiry", { ...valid, p_email: "not-an-email" })).error).not.toBeNull();
      // Direct inserts stay impossible.
      expect((await anon.from("inquiries").insert({ name: "x", email: "a@b.co", project_type: "x", budget: "x", message: "y".repeat(30) })).error).not.toBeNull();
    });

    it("are rate limited per visitor", async () => {
      const args = (n: number) => ({
        p_name: "RLS Test", p_email: "rls-test@example.com", p_project_type: "Other",
        p_budget: "€5,000+", p_message: `Rate limit probe number ${n} for the suite.`, p_ip_hash: "rls-rate-limit-hash",
      });
      await service.from("inquiries").delete().eq("ip_hash", "rls-rate-limit-hash");
      const results: unknown[] = [];
      for (let i = 0; i < 6; i++) results.push((await anon.rpc("submit_inquiry", args(i))).data);
      expect(results.slice(0, 5).every((r) => r === "ok")).toBe(true);
      expect(results[5]).toBe("rate_limited");
      await service.from("inquiries").delete().eq("ip_hash", "rls-rate-limit-hash");
    });
  });

  describe("an authenticated user who is NOT an admin", () => {
    it("is not an admin", async () => {
      expect((await outsider.rpc("is_admin")).data).toBe(false);
    });

    it("still cannot see drafts", async () => {
      const { data } = await outsider.from("projects").select("id").eq("id", DRAFT_ID);
      expect(data).toEqual([]);
    });

    it("cannot read inquiries", async () => {
      const { data, error } = await outsider.from("inquiries").select("id");
      expect(error ?? null).toBeNull();
      expect(data).toEqual([]);
    });

    it("cannot write projects, call save_project, or edit inquiries", async () => {
      expect((await outsider.from("projects").insert({ slug: "outsider", title: "x", short_description: "x", category: "x" })).error).not.toBeNull();
      expect((await outsider.rpc("save_project", { p_id: DRAFT_ID, p_project: {}, p_features: [], p_media: [] })).error).not.toBeNull();
      const upd = await outsider.from("inquiries").update({ status: "won" }).neq("status", "won").select("id");
      expect(upd.data ?? []).toEqual([]);
    });

    it("cannot make themselves an admin", async () => {
      expect((await outsider.from("admin_users").insert({ user_id: outsiderId })).error).not.toBeNull();
      expect((await outsider.rpc("is_admin")).data).toBe(false);
    });

    it("cannot upload or delete storage objects", async () => {
      const up = await outsider.storage.from(BUCKET).upload("projects/rls-test/outsider.png", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
      expect(up.error).not.toBeNull();
    });
  });

  describe("the admin", () => {
    it("is recognised and can read drafts and inquiries", async () => {
      expect((await admin.rpc("is_admin")).data).toBe(true);
      const draft = await admin.from("projects").select("id, published").eq("id", DRAFT_ID).single();
      expect(draft.data?.published).toBe(false);
      expect((await admin.from("inquiries").select("id").limit(1)).error).toBeNull();
    });

    it("can save a project transactionally (and unique slugs are enforced)", async () => {
      const payload = {
        slug: "rls-test-draft", title: "RLS test draft (edited)", short_description: "Edited.", category: "Test",
        kind: "website", preview_mode: "media", featured: false, published: false, sort_order: 0,
        tags: ["a"], technologies: ["b"],
      };
      const ok = await admin.rpc("save_project", { p_id: DRAFT_ID, p_project: payload, p_features: ["one", "two"], p_media: [] });
      expect(ok.error).toBeNull();
      const features = await admin.from("project_features").select("label, sort_order").eq("project_id", DRAFT_ID).order("sort_order");
      expect(features.data?.map((f) => f.label)).toEqual(["one", "two"]);

      const clash = await admin.rpc("save_project", {
        p_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        p_project: { ...payload, slug: "red-harbor-studios" }, p_features: [], p_media: [],
      });
      expect(clash.error?.code).toBe("23505");
    });

    it("can upload and delete storage objects; the public bucket serves them", async () => {
      const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });
      const up = await admin.storage.from(BUCKET).upload("projects/rls-test/admin.png", png);
      expect(up.error).toBeNull();
      const publicUrl = anon.storage.from(BUCKET).getPublicUrl("projects/rls-test/admin.png").data.publicUrl;
      expect((await fetch(publicUrl)).status).toBe(200);

      const wrongType = await admin.storage.from(BUCKET).upload("projects/rls-test/bad.svg", new Blob(["<svg/>"], { type: "image/svg+xml" }));
      expect(wrongType.error).not.toBeNull();

      expect((await admin.storage.from(BUCKET).remove(["projects/rls-test/admin.png"])).error).toBeNull();
    });

    it("can update an inquiry's status", async () => {
      const { data } = await service.from("inquiries").select("id").eq("email", "rls-test@example.com").limit(1).single();
      const res = await admin.from("inquiries").update({ status: "contacted" }).eq("id", data!.id).select("status").single();
      expect(res.data?.status).toBe("contacted");
    });
  });
});
