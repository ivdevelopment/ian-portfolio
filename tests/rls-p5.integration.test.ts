/**
 * P5 checks against a REAL local Supabase stack: client previews, access-code hashing, rate limiting,
 * session generations, and who can read or write what. Skipped unless run via `npm run test:rls`.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLocalSupabase } from "./local-only";

const enabled = process.env.RLS_TEST === "1" || process.env.npm_lifecycle_event === "test:rls";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (enabled) assertLocalSupabase();

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const TAG = "p5test";
const ADMIN = { email: `${TAG}-admin@portfolio.test`, password: "P5-Admin-Password-2026!" };
const OUTSIDER = { email: `${TAG}-outsider@portfolio.test`, password: "P5-Outsider-Password-2026!" };
const CODE = "GK-7F3K-9MQX-P4TD";
const sub = (name: string) => `${TAG}-${name}`;

describe.skipIf(!enabled)("P5 client previews", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;
  let outsider: SupabaseClient;
  const userIds: string[] = [];

  const create = (name: string, overrides: Record<string, unknown> = {}) =>
    admin.rpc("create_client_preview", {
      p_client_name: "Test Client",
      p_project_name: "Test Project",
      p_subdomain: sub(name),
      p_target_url: "https://client-site.example-host.com",
      p_code: CODE,
      p_expires_at: null,
      p_session_ttl_hours: 168,
      p_notes: null,
      ...overrides,
    });

  const verify = (name: string, code: string, ip = "ip-a") =>
    anon.rpc("verify_preview_access", { p_subdomain: sub(name), p_code: code, p_ip_hash: ip });

  async function make(name: string, overrides: Record<string, unknown> = {}) {
    const { data, error } = await create(name, overrides);
    expect(error).toBeNull();
    return data as string;
  }

  beforeAll(async () => {
    service = createClient(url, serviceKey, opts);
    anon = createClient(url, anonKey, opts);

    const users = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of users.data!.users.filter((u) => u.email?.startsWith(TAG))) await service.auth.admin.deleteUser(u.id);

    for (const account of [ADMIN, OUTSIDER]) {
      const created = await service.auth.admin.createUser({ ...account, email_confirm: true });
      expect(created.error).toBeNull();
      userIds.push(created.data.user!.id);
    }
    expect((await service.from("admin_users").insert({ user_id: userIds[0] })).error).toBeNull();

    admin = createClient(url, anonKey, opts);
    expect((await admin.auth.signInWithPassword(ADMIN)).error).toBeNull();
    outsider = createClient(url, anonKey, opts);
    expect((await outsider.auth.signInWithPassword(OUTSIDER)).error).toBeNull();
    await service.from("client_previews").delete().like("subdomain", `${TAG}-%`);
  });

  afterAll(async () => {
    await service.from("client_previews").delete().like("subdomain", `${TAG}-%`);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  describe("creating a preview", () => {
    it("stores only a bcrypt hash, never the code", async () => {
      const id = await make("hash");
      const { data } = await service.from("client_previews").select("access_code_hash").eq("id", id).single();
      expect(data!.access_code_hash).toMatch(/^\$2a\$12\$/);
      expect(data!.access_code_hash).not.toContain(CODE);
      expect(JSON.stringify(data)).not.toContain(CODE);
    });

    it("hashes with a random salt (same code, different hashes)", async () => {
      const a = await make("salt-a");
      const b = await make("salt-b");
      const { data } = await service.from("client_previews").select("id, access_code_hash").in("id", [a, b]);
      expect(data![0].access_code_hash).not.toBe(data![1].access_code_hash);
    });

    it("rejects weak codes, reserved and malformed subdomains, bad targets and duplicates", async () => {
      expect((await create("weak", { p_code: "short" })).error).not.toBeNull();
      for (const bad of ["www", "admin", "api", "mail", "en", "nl", "a.b", "-x", "x-", "x_y"]) {
        expect((await create("x", { p_subdomain: bad })).error, bad).not.toBeNull();
      }
      for (const target of ["http://example.com", "javascript:alert(1)", "file:///etc/passwd", "https://user:pw@example.com", "https://[::1]/", "https://exa mple.com"]) {
        expect((await create("badtarget", { p_target_url: target })).error, target).not.toBeNull();
      }
      // The database normalises case (the app additionally rejects uppercase input).
      const upper = await create("casing", { p_subdomain: sub("CaSiNg") });
      expect(upper.error).toBeNull();
      expect((await service.from("client_previews").select("subdomain").eq("id", upper.data as string).single()).data!.subdomain).toBe(sub("casing"));
      await make("dup");
      expect((await create("dup")).error?.code).toBe("23505");
    });

    it("is refused for anonymous visitors and for signed-in non-admins", async () => {
      for (const client of [anon, outsider]) {
        expect((await client.rpc("create_client_preview", {
          p_client_name: "x", p_project_name: "x", p_subdomain: sub("evil"), p_target_url: "https://x.example-host.com",
          p_code: CODE, p_expires_at: null, p_session_ttl_hours: 168, p_notes: null,
        })).error).not.toBeNull();
      }
      const { data } = await service.from("client_previews").select("id").eq("subdomain", sub("evil"));
      expect(data).toEqual([]);
    });
  });

  describe("who can read or write the table", () => {
    it("lets admins read every column EXCEPT the hash, and never anyone else", async () => {
      const id = await make("cols");
      const ok = await admin.from("client_previews").select("id, client_name, subdomain, target_url, active, session_version, access_count").eq("id", id).single();
      expect(ok.error).toBeNull();
      expect((await admin.from("client_previews").select("access_code_hash").eq("id", id)).error).not.toBeNull();
      expect((await admin.from("client_previews").select("*").eq("id", id)).error).not.toBeNull();
      for (const client of [anon, outsider]) {
        const res = await client.from("client_previews").select("id");
        expect(res.error !== null || res.data?.length === 0).toBe(true);
      }
    });

    it("lets admins edit allowed columns but not the hash, id or counters", async () => {
      const id = await make("edit");
      expect((await admin.from("client_previews").update({ client_name: "Renamed", notes: "n" }).eq("id", id)).error).toBeNull();
      expect((await admin.from("client_previews").update({ access_code_hash: "x" }).eq("id", id)).error).not.toBeNull();
      expect((await admin.from("client_previews").update({ session_version: 99 }).eq("id", id)).error).not.toBeNull();
      expect((await admin.from("client_previews").update({ access_count: 99 }).eq("id", id)).error).not.toBeNull();
    });

    it("blocks anonymous and non-admin writes, deletes and direct inserts", async () => {
      const id = await make("writes");
      for (const client of [anon, outsider]) {
        await client.from("client_previews").update({ active: false }).eq("id", id);
        await client.from("client_previews").delete().eq("id", id);
        expect((await client.from("client_previews").insert({ client_name: "x", project_name: "x", subdomain: sub("direct"), target_url: "https://x.example-host.com", access_code_hash: "x" })).error).not.toBeNull();
      }
      const { data } = await service.from("client_previews").select("active").eq("id", id).single();
      expect(data!.active).toBe(true);
      expect((await admin.from("client_previews").insert({ client_name: "x", project_name: "x", subdomain: sub("direct"), target_url: "https://x.example-host.com", access_code_hash: "x" })).error).not.toBeNull();
    });

    it("hides the attempts table from everyone", async () => {
      for (const client of [anon, outsider, admin]) {
        const res = await client.from("preview_access_attempts").select("id");
        expect(res.error !== null || res.data?.length === 0).toBe(true);
      }
    });
  });

  describe("gateway lookups", () => {
    it("reports state without leaking the target or the hash", async () => {
      const id = await make("gate");
      const { data } = await anon.rpc("preview_gate", { p_subdomain: sub("gate") });
      expect(data).toMatchObject({ state: "ok", id, session_version: 1, session_ttl_hours: 168 });
      expect(JSON.stringify(data)).not.toMatch(/target|hash|https:/i);
      expect((await anon.rpc("preview_gate", { p_subdomain: sub("nope") })).data).toEqual({ state: "missing" });
      expect((await anon.rpc("preview_gate", { p_subdomain: "x".repeat(100) })).data).toEqual({ state: "missing" });
    });

    it("serves the target only for the right id and session generation", async () => {
      const id = await make("target");
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: 1 })).data).toEqual({ target_url: "https://client-site.example-host.com", auth_type: "none", header_name: null, secret_ref: null });
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: 2 })).data).toBeNull();
      expect((await anon.rpc("preview_upstream", { p_id: randomUUID(), p_session_version: 1 })).data).toBeNull();
    });
  });

  describe("upstream authentication settings", () => {
    it("exposes only the header name and secret REFERENCE, enforces completeness, and ends sessions when changed", async () => {
      const id = await make("upauth");
      const bad = await admin.from("client_previews").update({ upstream_auth_type: "header" }).eq("id", id);
      expect(bad.error).not.toBeNull(); // header auth needs a name and a reference
      const badRef = await admin.from("client_previews").update({ upstream_auth_type: "header", upstream_header_name: "x-gw-auth", upstream_secret_ref: "Bad Ref!" }).eq("id", id);
      expect(badRef.error).not.toBeNull();

      const ok = await admin.from("client_previews").update({ upstream_auth_type: "header", upstream_header_name: "x-gw-auth", upstream_secret_ref: "upauth" }).eq("id", id);
      expect(ok.error).toBeNull();
      // The old generation is dead, the new one resolves with the settings (no secret value exists in the database).
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: 1 })).data).toBeNull();
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: 2 })).data).toEqual({
        target_url: "https://client-site.example-host.com", auth_type: "header", header_name: "x-gw-auth", secret_ref: "upauth",
      });
      // Not readable by the anonymous role, and not a gateway-function output.
      expect((await anon.from("client_previews").select("upstream_secret_ref").eq("id", id)).data ?? []).toHaveLength(0);
      expect(JSON.stringify((await anon.rpc("preview_gate", { p_subdomain: sub("upauth") })).data)).not.toMatch(/upauth|x-gw-auth/);
    });
  });

  describe("access-code verification", () => {
    it("accepts the right code, counts the visit, and rejects wrong ones generically", async () => {
      const id = await make("verify");
      const wrong = await verify("verify", "GK-WRONG-WRONG");
      expect(wrong.data).toEqual({ result: "denied" });
      const ok = await verify("verify", CODE);
      expect(ok.data).toMatchObject({ result: "ok", id, session_version: 1 });
      const { data } = await service.from("client_previews").select("access_count, last_accessed_at").eq("id", id).single();
      expect(data!.access_count).toBe(1);
      expect(data!.last_accessed_at).not.toBeNull();
      expect((await verify("nope", CODE)).data).toEqual({ result: "missing" });
    });

    it("rate limits failures per visitor before doing any hashing, without revealing the count", async () => {
      await make("limit");
      for (let i = 0; i < 5; i++) expect((await verify("limit", `wrong-${i}`, "ip-brute")).data).toEqual({ result: "denied" });
      // Even the CORRECT code is refused for this visitor now.
      expect((await verify("limit", CODE, "ip-brute")).data).toEqual({ result: "limited" });
      // A different visitor is not affected, and a correct code resets their own counter.
      expect((await verify("limit", CODE, "ip-other")).data).toMatchObject({ result: "ok" });
    });

    it("limits a distributed attack per preview too, and never locks permanently", async () => {
      const id = await make("global");
      for (let i = 0; i < 40; i++) {
        await service.from("preview_access_attempts").insert({ preview_id: id, ip_hash: `bot-${i}` });
      }
      expect((await verify("global", CODE, "legit-visitor")).data).toEqual({ result: "limited" });
      // Attempts age out of the 15 minute window.
      await service.from("preview_access_attempts").update({ attempted_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq("preview_id", id);
      expect((await verify("global", CODE, "legit-visitor")).data).toMatchObject({ result: "ok" });
    });

    it("ignores oversized or empty input", async () => {
      await make("input");
      expect((await verify("input", "")).data).toEqual({ result: "denied" });
      expect((await verify("input", "x".repeat(500))).data).toEqual({ result: "denied" });
      expect((await anon.rpc("verify_preview_access", { p_subdomain: sub("input"), p_code: CODE, p_ip_hash: "" })).data).toEqual({ result: "denied" });
    });
  });

  describe("reset, disable and expiry", () => {
    it("a code reset replaces the code and invalidates every existing session", async () => {
      const id = await make("reset");
      const before = (await verify("reset", CODE)).data as { session_version: number };
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: before.session_version })).data).not.toBeNull();

      const NEW_CODE = "GK-NEW1-CODE-2026";
      expect((await admin.rpc("reset_preview_access_code", { p_id: id, p_code: NEW_CODE })).error).toBeNull();

      expect((await verify("reset", CODE, "ip-after")).data).toEqual({ result: "denied" });
      const after = (await verify("reset", NEW_CODE, "ip-after2")).data as { result: string; session_version: number };
      expect(after).toMatchObject({ result: "ok" });
      expect(after.session_version).toBe(before.session_version + 1);
      // The old session generation is dead.
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: before.session_version })).data).toBeNull();
    });

    it("rejects a reset by non-admins and with weak codes", async () => {
      const id = await make("reset2");
      expect((await outsider.rpc("reset_preview_access_code", { p_id: id, p_code: "GK-HACK-HACK-2026" })).error).not.toBeNull();
      expect((await anon.rpc("reset_preview_access_code", { p_id: id, p_code: "GK-HACK-HACK-2026" })).error).not.toBeNull();
      expect((await admin.rpc("reset_preview_access_code", { p_id: id, p_code: "weak" })).error).not.toBeNull();
      expect((await verify("reset2", CODE)).data).toMatchObject({ result: "ok" });
    });

    it("disabling stops access immediately and kills old sessions even after re-enabling", async () => {
      const id = await make("disable");
      const session = (await verify("disable", CODE)).data as { session_version: number };

      expect((await admin.from("client_previews").update({ active: false }).eq("id", id)).error).toBeNull();
      expect((await anon.rpc("preview_gate", { p_subdomain: sub("disable") })).data).toEqual({ state: "inactive" });
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: session.session_version })).data).toBeNull();
      expect((await verify("disable", CODE, "ip-d")).data).toEqual({ result: "unavailable" });

      expect((await admin.from("client_previews").update({ active: true }).eq("id", id)).error).toBeNull();
      // The old session stays dead; a fresh login works.
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: session.session_version })).data).toBeNull();
      const fresh = (await verify("disable", CODE, "ip-d2")).data as { result: string; session_version: number };
      expect(fresh.result).toBe("ok");
      expect(fresh.session_version).toBe(session.session_version + 1);
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: fresh.session_version })).data).not.toBeNull();
    });

    it("an expired preview is unavailable everywhere, with no cron needed", async () => {
      const id = await make("expiry", { p_expires_at: new Date(Date.now() + 60_000).toISOString() });
      const session = (await verify("expiry", CODE)).data as { session_version: number };
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: session.session_version })).data).not.toBeNull();

      await service.from("client_previews").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);
      expect((await anon.rpc("preview_gate", { p_subdomain: sub("expiry") })).data).toEqual({ state: "expired" });
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: session.session_version })).data).toBeNull();
      expect((await verify("expiry", CODE, "ip-e")).data).toEqual({ result: "unavailable" });

      // Extending the expiry makes it available again.
      expect((await admin.from("client_previews").update({ expires_at: null }).eq("id", id)).error).toBeNull();
      expect((await verify("expiry", CODE, "ip-e2")).data).toMatchObject({ result: "ok" });
    });

    it("re-pointing the target also ends old sessions", async () => {
      const id = await make("repoint");
      const session = (await verify("repoint", CODE)).data as { session_version: number };
      expect((await admin.from("client_previews").update({ target_url: "https://another-site.example-host.com" }).eq("id", id)).error).toBeNull();
      expect((await anon.rpc("preview_upstream", { p_id: id, p_session_version: session.session_version })).data).toBeNull();
    });
  });

  describe("deleting", () => {
    it("removes the preview and its attempts, nothing else", async () => {
      const id = await make("delete");
      await verify("delete", "wrong-code");
      expect((await admin.from("client_previews").delete().eq("id", id)).error).toBeNull();
      expect((await anon.rpc("preview_gate", { p_subdomain: sub("delete") })).data).toEqual({ state: "missing" });
      const { data } = await service.from("preview_access_attempts").select("id").eq("preview_id", id);
      expect(data).toEqual([]);
    });
  });
});
