/**
 * P2 authorisation checks against a REAL local Supabase stack: reviews,
 * invitations, site content, services, skills and the site-media bucket.
 * Skipped unless run via `npm run test:rls` (needs `npm run db:start` + .env.local).
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLocalSupabase } from "./local-only";

const enabled = process.env.RLS_TEST === "1" || process.env.npm_lifecycle_event === "test:rls";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (enabled) assertLocalSupabase();

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "admin@portfolio.test";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "LocalDev-Admin-2026!";
const OUTSIDER_EMAIL = "outsider-p2@portfolio.test";
const OUTSIDER_PASSWORD = "Outsider-Password-P2!";

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

const ids = {
  approved: "a1111111-1111-4111-8111-111111111111",
  pending: "a2222222-2222-4222-8222-222222222222",
  rejected: "a3333333-3333-4333-8333-333333333333",
  archived: "a4444444-4444-4444-8444-444444444444",
};
const REVIEW_IDS = Object.values(ids);
const TAG = "rls-p2";

describe.skipIf(!enabled)("P2 RLS and authorisation", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let outsider: SupabaseClient;
  let admin: SupabaseClient;
  let adminId: string;
  let outsiderId: string;

  const submitArgs = (token: string, overrides: Record<string, unknown> = {}) => ({
    p_token_hash: hash(token),
    p_name: `${TAG} client`,
    p_company: "Acme",
    p_role: "CEO",
    p_rating: 5,
    p_text: "A suitably long review text written for the RLS suite.",
    p_ip_hash: `${TAG}-ip`,
    ...overrides,
  });

  async function invitation(fields: Record<string, unknown> = {}) {
    const token = newToken();
    const { error } = await service.from("review_invitations").insert({
      token_hash: hash(token),
      client_name: `${TAG} invitee`,
      expires_at: days(7),
      created_by: adminId,
      ...fields,
    });
    expect(error).toBeNull();
    return token;
  }

  beforeAll(async () => {
    service = createClient(url, serviceKey, opts);
    anon = createClient(url, anonKey, opts);

    const users = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    adminId = users.data!.users.find((u) => u.email === ADMIN_EMAIL)!.id;
    const old = users.data!.users.find((u) => u.email === OUTSIDER_EMAIL);
    if (old) await service.auth.admin.deleteUser(old.id);
    const created = await service.auth.admin.createUser({ email: OUTSIDER_EMAIL, password: OUTSIDER_PASSWORD, email_confirm: true });
    expect(created.error).toBeNull();
    outsiderId = created.data.user!.id;

    outsider = createClient(url, anonKey, opts);
    expect((await outsider.auth.signInWithPassword({ email: OUTSIDER_EMAIL, password: OUTSIDER_PASSWORD })).error).toBeNull();
    admin = createClient(url, anonKey, opts);
    expect((await admin.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).error).toBeNull();

    await service.from("reviews").delete().in("id", REVIEW_IDS);
    const rows = [
      { id: ids.approved, status: "approved", name: `${TAG} approved` },
      { id: ids.pending, status: "pending", name: `${TAG} pending` },
      { id: ids.rejected, status: "rejected", name: `${TAG} rejected` },
      { id: ids.archived, status: "archived", name: `${TAG} archived` },
    ].map((r) => ({ ...r, rating: 5, review_text: "Fixture review text.", source: "admin" }));
    expect((await service.from("reviews").insert(rows)).error).toBeNull();
    expect(
      (await service.from("review_private").insert({ review_id: ids.pending, original_review_text: "SECRET ORIGINAL", ip_hash: "x" })).error,
    ).toBeNull();
  });

  afterAll(async () => {
    await service.from("reviews").delete().in("id", REVIEW_IDS);
    await service.from("reviews").delete().like("name", `${TAG}%`);
    await service.from("review_invitations").delete().like("client_name", `${TAG}%`);
    await service.storage.from("site-media").remove(["site/hero/admin-test.png"]);
    if (outsiderId) await service.auth.admin.deleteUser(outsiderId);
  });

  /* ---------------------------------------------------------------- reviews */

  describe("anonymous visitors and reviews", () => {
    it("can read approved reviews but never pending, rejected or archived ones", async () => {
      const { data, error } = await anon.from("reviews").select("id, status");
      expect(error).toBeNull();
      const got = new Set(data!.map((r) => r.id));
      expect(got.has(ids.approved)).toBe(true);
      expect(got.has(ids.pending)).toBe(false);
      expect(got.has(ids.rejected)).toBe(false);
      expect(got.has(ids.archived)).toBe(false);
      expect(data!.every((r) => r.status === "approved")).toBe(true);
    });

    it("cannot read private review data or invitations", async () => {
      expect((await anon.from("review_private").select("review_id")).error).not.toBeNull();
      expect((await anon.from("review_invitations").select("id")).error).not.toBeNull();
    });

    it("cannot insert, edit or delete reviews directly", async () => {
      const insert = await anon.from("reviews").insert({ name: `${TAG} direct`, rating: 5, review_text: "x", source: "invitation", status: "approved" });
      expect(insert.error).not.toBeNull();
      expect((await anon.from("reviews").update({ status: "rejected" }).eq("id", ids.approved).select("id")).data ?? []).toEqual([]);
      expect((await anon.from("reviews").delete().eq("id", ids.approved).select("id")).data ?? []).toEqual([]);
      const still = await service.from("reviews").select("status").eq("id", ids.approved).single();
      expect(still.data?.status).toBe("approved");
    });

    it("cannot create invitations", async () => {
      const res = await anon.from("review_invitations").insert({ token_hash: hash(newToken()), expires_at: days(1), created_by: adminId });
      expect(res.error).not.toBeNull();
    });
  });

  /* ------------------------------------------------------------- invitations */

  describe("invitation links", () => {
    it("stores only the hash, and rejects anything that isn't a SHA-256 hex digest", async () => {
      const token = await invitation();
      const rows = await service.from("review_invitations").select("token_hash").eq("token_hash", hash(token));
      expect(rows.data).toHaveLength(1);
      expect(rows.data![0].token_hash).not.toBe(token);
      const raw = await service.from("review_invitations").insert({ token_hash: token, expires_at: days(1), created_by: adminId });
      expect(raw.error).not.toBeNull();
      const any = await service.from("review_invitations").select("*").eq("token_hash", hash(token)).single();
      expect(JSON.stringify(any.data)).not.toContain(token);
    });

    it("looks up a valid link, and gives the identical answer (null) for every unusable one", async () => {
      const valid = await invitation({ client_name: `${TAG} Valid Person` });
      const expired = await invitation({ expires_at: days(-1) });
      const revoked = await invitation({ revoked_at: new Date().toISOString() });
      const used = await invitation({ used_at: new Date().toISOString() });

      const ok = await anon.rpc("get_review_invitation", { p_token_hash: hash(valid) });
      expect(ok.error).toBeNull();
      expect(ok.data).toMatchObject({ client_name: `${TAG} Valid Person` });

      for (const token of [expired, revoked, used, newToken()]) {
        const res = await anon.rpc("get_review_invitation", { p_token_hash: hash(token) });
        expect(res.error).toBeNull();
        expect(res.data).toBeNull();
      }
    });

    it("accepts a submission once, as a PENDING invitation review with the original text preserved", async () => {
      const token = await invitation();
      const text = "Original words from the client, exactly as typed.";
      const res = await anon.rpc("submit_review", submitArgs(token, { p_text: text, p_name: `${TAG} Submitter` }));
      expect(res.error).toBeNull();
      expect(res.data).toBe("ok");

      const review = await service.from("reviews").select("id, status, source, review_text, submitted_at").eq("name", `${TAG} Submitter`).single();
      expect(review.data).toMatchObject({ status: "pending", source: "invitation", review_text: text });
      expect(review.data!.submitted_at).not.toBeNull();
      const priv = await service.from("review_private").select("original_review_text").eq("review_id", review.data!.id).single();
      expect(priv.data?.original_review_text).toBe(text);

      const inv = await service.from("review_invitations").select("used_at, review_id").eq("token_hash", hash(token)).single();
      expect(inv.data?.used_at).not.toBeNull();
      expect(inv.data?.review_id).toBe(review.data!.id);

      // Not public while pending.
      const visible = await anon.from("reviews").select("id").eq("id", review.data!.id);
      expect(visible.data).toEqual([]);
    });

    it("rejects reuse of a link", async () => {
      const token = await invitation();
      expect((await anon.rpc("submit_review", submitArgs(token))).data).toBe("ok");
      expect((await anon.rpc("submit_review", submitArgs(token))).data).toBe("invalid");
    });

    it("rejects expired, revoked and unknown links with the same answer", async () => {
      const expired = await invitation({ expires_at: days(-1) });
      const revoked = await invitation({ revoked_at: new Date().toISOString() });
      for (const token of [expired, revoked, newToken()]) {
        const res = await anon.rpc("submit_review", submitArgs(token, { p_name: `${TAG} must-not-exist` }));
        expect(res.error).toBeNull();
        expect(res.data).toBe("invalid");
      }
      const leaked = await service.from("reviews").select("id").eq("name", `${TAG} must-not-exist`);
      expect(leaked.data).toEqual([]);
    });

    it("does NOT consume the link when the input is invalid", async () => {
      const token = await invitation();
      expect((await anon.rpc("submit_review", submitArgs(token, { p_rating: 9 }))).error).not.toBeNull();
      expect((await anon.rpc("submit_review", submitArgs(token, { p_text: "" }))).error).not.toBeNull();
      expect((await anon.rpc("submit_review", submitArgs(token, { p_name: `${TAG} retry` }))).data).toBe("ok");
    });

    it("lets only one of two simultaneous submissions succeed", async () => {
      const token = await invitation();
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => anon.rpc("submit_review", submitArgs(token, { p_name: `${TAG} race ${i}`, p_ip_hash: `${TAG}-race-${i}` }))),
      );
      const outcomes = results.map((r) => r.data);
      expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "invalid")).toHaveLength(5);
      const rows = await service.from("reviews").select("id").like("name", `${TAG} race %`);
      expect(rows.data).toHaveLength(1);
    });

    it("rate limits submissions per visitor", async () => {
      await service.from("review_private").delete().eq("ip_hash", `${TAG}-limit`);
      const outcomes: unknown[] = [];
      for (let i = 0; i < 6; i++) {
        const token = await invitation();
        outcomes.push((await anon.rpc("submit_review", submitArgs(token, { p_ip_hash: `${TAG}-limit`, p_name: `${TAG} limit ${i}` }))).data);
      }
      expect(outcomes.slice(0, 5).every((o) => o === "ok")).toBe(true);
      expect(outcomes[5]).toBe("rate_limited");
    });
  });

  /* ------------------------------------------------------------ site content */

  describe("anonymous visitors and site content", () => {
    it("can read settings, page content, enabled services and enabled skills", async () => {
      expect((await anon.from("site_settings").select("site_name")).data).toHaveLength(1);
      expect((await anon.from("site_content").select("key")).data!.map((r) => r.key).sort()).toEqual(["about", "contact", "home"]);
      expect((await anon.from("services").select("id")).data!.length).toBeGreaterThan(0);
      expect((await anon.from("skills").select("id")).data!.length).toBeGreaterThan(0);
    });

    it("cannot edit settings, content, services or skills", async () => {
      expect((await anon.from("site_settings").update({ site_name: "Hacked" }).eq("id", true).select("id")).data ?? []).toEqual([]);
      expect((await anon.from("site_content").update({ content: {} }).eq("key", "home").select("key")).data ?? []).toEqual([]);
      expect((await anon.from("site_content").insert({ key: "home", content: {} })).error).not.toBeNull();
      expect((await anon.from("services").insert({ slug: "evil", title: "x", description: "x" })).error).not.toBeNull();
      expect((await anon.from("skills").insert({ name: "x" })).error).not.toBeNull();
      expect((await anon.from("services").delete().neq("slug", "").select("id")).data ?? []).toEqual([]);
      expect((await anon.rpc("save_services", { p_services: [] })).error).not.toBeNull();
      expect((await anon.rpc("save_skills", { p_skills: [] })).error).not.toBeNull();
      const settings = await service.from("site_settings").select("site_name").single();
      expect(settings.data?.site_name).not.toBe("Hacked");
    });

    it("cannot write to the site-media bucket", async () => {
      const up = await anon.storage.from("site-media").upload("site/hero/anon.png", new Blob([new Uint8Array([1])], { type: "image/png" }));
      expect(up.error).not.toBeNull();
    });
  });

  /* ------------------------------------------------- non-admin authenticated */

  describe("an authenticated user who is NOT an admin", () => {
    it("sees only approved reviews and no private review data or invitations", async () => {
      const reviews = await outsider.from("reviews").select("id, status");
      expect(reviews.data!.every((r) => r.status === "approved")).toBe(true);
      expect((await outsider.from("review_private").select("review_id")).data).toEqual([]);
      expect((await outsider.from("review_invitations").select("id")).data).toEqual([]);
    });

    it("cannot manage reviews or invitations", async () => {
      expect((await outsider.from("reviews").update({ status: "approved" }).eq("id", ids.pending).select("id")).data ?? []).toEqual([]);
      expect((await outsider.from("reviews").insert({ name: "x", rating: 5, review_text: "x", source: "admin" })).error).not.toBeNull();
      expect((await outsider.from("reviews").delete().eq("id", ids.approved).select("id")).data ?? []).toEqual([]);
      expect((await outsider.from("review_invitations").insert({ token_hash: hash(newToken()), expires_at: days(1), created_by: outsiderId })).error).not.toBeNull();
    });

    it("cannot manage site content, services or skills", async () => {
      expect((await outsider.from("site_settings").update({ site_name: "Hacked" }).eq("id", true).select("id")).data ?? []).toEqual([]);
      expect((await outsider.from("site_content").update({ content: {} }).eq("key", "home").select("key")).data ?? []).toEqual([]);
      expect((await outsider.from("services").insert({ slug: "evil", title: "x", description: "x" })).error).not.toBeNull();
      expect((await outsider.rpc("save_services", { p_services: [] })).error).not.toBeNull();
      expect((await outsider.rpc("save_skills", { p_skills: [] })).error).not.toBeNull();
    });

    it("cannot upload to site-media", async () => {
      const up = await outsider.storage.from("site-media").upload("site/hero/outsider.png", new Blob([new Uint8Array([1])], { type: "image/png" }));
      expect(up.error).not.toBeNull();
    });
  });

  /* -------------------------------------------------------------------- admin */

  describe("the admin", () => {
    it("can read every review, its private original text, and invitations", async () => {
      const all = await admin.from("reviews").select("id").in("id", REVIEW_IDS);
      expect(all.data).toHaveLength(4);
      const priv = await admin.from("review_private").select("original_review_text").eq("review_id", ids.pending).single();
      expect(priv.data?.original_review_text).toBe("SECRET ORIGINAL");
      expect((await admin.from("review_invitations").select("id").limit(1)).error).toBeNull();
    });

    it("can approve, feature and unpublish a review (published_at follows status)", async () => {
      const approve = await admin.from("reviews").update({ status: "approved", featured: true }).eq("id", ids.pending).select("status, featured, published_at").single();
      expect(approve.data).toMatchObject({ status: "approved", featured: true });
      expect(approve.data!.published_at).not.toBeNull();
      expect((await anon.from("reviews").select("id").eq("id", ids.pending)).data).toHaveLength(1);

      const archive = await admin.from("reviews").update({ status: "archived" }).eq("id", ids.pending).select("published_at").single();
      expect(archive.data!.published_at).toBeNull();
      expect((await anon.from("reviews").select("id").eq("id", ids.pending)).data).toEqual([]);
    });

    it("can create invitations only as themselves, and revoke them", async () => {
      const token = newToken();
      const ok = await admin.from("review_invitations").insert({ token_hash: hash(token), expires_at: days(7), created_by: adminId, client_name: `${TAG} admin made` }).select("id").single();
      expect(ok.error).toBeNull();
      const forged = await admin.from("review_invitations").insert({ token_hash: hash(newToken()), expires_at: days(7), created_by: outsiderId });
      expect(forged.error).not.toBeNull();

      await admin.from("review_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", ok.data!.id);
      expect((await anon.rpc("submit_review", submitArgs(token))).data).toBe("invalid");
    });

    it("can edit site settings and page content, and manage services and skills", async () => {
      const before = await service.from("site_settings").select("*").single();
      const edit = await admin.from("site_settings").update({ site_name: `${TAG} Name` }).eq("id", true).select("site_name").single();
      expect(edit.data?.site_name).toBe(`${TAG} Name`);
      await service.from("site_settings").update({ site_name: before.data!.site_name }).eq("id", true);

      const home = await service.from("site_content").select("content").eq("key", "home").single();
      expect((await admin.from("site_content").upsert({ key: "home", content: home.data!.content })).error).toBeNull();

      const services = await admin.from("services").select("*").order("sort_order");
      const original = services.data!.map((s) => ({ id: s.id, slug: s.slug, title: s.title, description: s.description, icon: s.icon, includes: s.includes, enabled: s.enabled }));
      const extra = { id: "66666666-6666-4666-8666-666666666666", slug: "rls-extra", title: "Extra", description: "x", icon: "seo", includes: [], enabled: true };
      expect((await admin.rpc("save_services", { p_services: [...original, extra] })).error).toBeNull();
      expect((await anon.from("services").select("slug").eq("slug", "rls-extra")).data).toHaveLength(1);
      expect((await admin.rpc("save_services", { p_services: [...original, { ...extra, icon: "<svg onload=1>" }] })).error).not.toBeNull();
      expect((await admin.rpc("save_services", { p_services: original })).error).toBeNull();
      expect((await anon.from("services").select("slug").eq("slug", "rls-extra")).data).toEqual([]);

      const skills = await admin.from("skills").select("*").order("sort_order");
      const originalSkills = skills.data!.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }));
      expect((await admin.rpc("save_skills", { p_skills: [...originalSkills, { id: "77777777-7777-4777-8777-777777777777", name: "RLS Skill", enabled: false }] })).error).toBeNull();
      expect((await anon.from("skills").select("name").eq("name", "RLS Skill")).data).toEqual([]); // disabled => hidden
      expect((await admin.rpc("save_skills", { p_skills: originalSkills })).error).toBeNull();
    });

    it("can upload images to site-media (not SVG), and the public bucket serves them", async () => {
      const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });
      expect((await admin.storage.from("site-media").upload("site/hero/admin-test.png", png)).error).toBeNull();
      const publicUrl = anon.storage.from("site-media").getPublicUrl("site/hero/admin-test.png").data.publicUrl;
      expect((await fetch(publicUrl)).status).toBe(200);
      expect((await admin.storage.from("site-media").upload("site/hero/bad.svg", new Blob(["<svg/>"], { type: "image/svg+xml" }))).error).not.toBeNull();
      expect((await admin.storage.from("site-media").upload("site/hero/bad.gif", new Blob([new Uint8Array([1])], { type: "image/gif" }))).error).not.toBeNull();
    });
  });
});
