/**
 * P6 prospect CRM checks against a REAL local Supabase stack: admin-only access, the activity trail, delete
 * behaviour, linking, constraints, the summary maths and the indexes. Skipped unless run via `npm run test:rls`.
 */
import { execFileSync } from "node:child_process";
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
const TAG = "p6test";
const ADMIN = { email: `${TAG}-admin@portfolio.test`, password: "P6-Admin-Password-2026!" };
const OUTSIDER = { email: `${TAG}-outsider@portfolio.test`, password: "P6-Outsider-Password-2026!" };

describe.skipIf(!enabled)("P6 prospect CRM", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;
  let outsider: SupabaseClient;
  const userIds: string[] = [];
  const created: string[] = [];

  const name = (n: string) => `${TAG} ${n}`;
  async function make(n: string, extra: Record<string, unknown> = {}) {
    const { data, error } = await admin.from("prospects").insert({ company_name: name(n), ...extra }).select("id").single();
    expect(error, n).toBeNull();
    created.push(data!.id);
    return data!.id as string;
  }
  const wipe = async () => {
    await service.from("prospects").delete().like("company_name", `${TAG}%`);
    await service.from("client_previews").delete().like("subdomain", `${TAG}-%`);
    await service.from("projects").delete().like("slug", `${TAG}-%`);
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
  });

  afterAll(async () => {
    await wipe();
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  describe("security: admins only", () => {
    it("lets the admin create, read, edit and delete prospects", async () => {
      const id = await make("crud", { sector: "Bouw", estimated_value_eur: 1500 });
      const read = await admin.from("prospects").select("company_name, status, priority, contact_delivery_status").eq("id", id).single();
      expect(read.data).toEqual({ company_name: name("crud"), status: "new", priority: "normal", contact_delivery_status: "unknown" });
      expect((await admin.from("prospects").update({ city: "Brugge", priority: "high" }).eq("id", id)).error).toBeNull();
      expect((await admin.from("prospects").select("city, priority").eq("id", id).single()).data).toEqual({ city: "Brugge", priority: "high" });
      expect((await admin.from("prospects").delete().eq("id", id)).error).toBeNull();
      expect((await admin.from("prospects").select("id").eq("id", id)).data).toEqual([]);
    });

    it("gives the public (anon) role no access to prospects, activities, imports or the summary", async () => {
      const id = await make("secret", { email: "private@example.test", notes: "private note", estimated_value_eur: 9999 });
      await admin.from("prospect_activities").insert({ prospect_id: id, type: "note", title: "private activity" });

      for (const table of ["prospects", "prospect_activities", "prospect_imports"]) {
        const read = await anon.from(table).select("*");
        expect(read.error, `${table} read`).not.toBeNull();
        expect(read.data ?? []).toHaveLength(0);
      }
      expect((await anon.from("prospects").insert({ company_name: name("hack") })).error).not.toBeNull();
      expect((await anon.from("prospects").update({ notes: "pwned" }).eq("id", id)).error).not.toBeNull();
      expect((await anon.from("prospects").delete().eq("id", id)).error).not.toBeNull();
      expect((await anon.from("prospect_activities").insert({ prospect_id: id, type: "note", title: "x" })).error).not.toBeNull();
      expect((await anon.rpc("prospect_summary", { p_today: "2026-11-02", p_week_end: "2026-11-08" })).error).not.toBeNull();
      // Nothing leaked and nothing changed.
      expect((await service.from("prospects").select("notes").eq("id", id).single()).data!.notes).toBe("private note");
    });

    it("gives a signed-in non-admin no access either (RLS, not just authentication)", async () => {
      const id = await make("outsider-target");
      expect((await outsider.from("prospects").select("id").eq("id", id)).data ?? []).toHaveLength(0);
      expect((await outsider.from("prospects").insert({ company_name: name("outsider-insert") })).error).not.toBeNull();
      expect((await outsider.from("prospects").update({ notes: "x" }).eq("id", id)).data ?? []).toHaveLength(0);
      expect((await service.from("prospects").select("notes").eq("id", id).single()).data!.notes).toBeNull();
      expect((await outsider.from("prospects").delete().eq("id", id).select("id")).data ?? []).toHaveLength(0);
      expect((await service.from("prospects").select("id").eq("id", id)).data).toHaveLength(1);
      expect((await outsider.from("prospect_activities").select("id")).data ?? []).toHaveLength(0);
      expect((await outsider.from("prospect_imports").insert({ source: "x", rows_parsed: 0, rows_imported: 0, rows_skipped: 0 })).error).not.toBeNull();
      const summary = await outsider.rpc("prospect_summary", { p_today: "2026-11-02", p_week_end: "2026-11-08" });
      expect((summary.data as { total: number } | null)?.total ?? 0).toBe(0);
    });
  });

  describe("constraints", () => {
    it("rejects invalid statuses, priorities, delivery values, negative amounts and blank names", async () => {
      const bad = async (values: Record<string, unknown>) => (await admin.from("prospects").insert({ company_name: name("bad"), ...values })).error;
      expect(await bad({ status: "interested-ish" })).not.toBeNull();
      expect(await bad({ priority: "critical" })).not.toBeNull();
      expect(await bad({ contact_delivery_status: "sent" })).not.toBeNull();
      expect(await bad({ estimated_value_eur: -1 })).not.toBeNull();
      expect(await bad({ quote_value_eur: -0.01 })).not.toBeNull();
      expect(await bad({ company_name: "   " })).not.toBeNull();
      expect(await bad({ first_contact_on: "2026-02-30" })).not.toBeNull();
      // A blank amount is allowed and stays null (not zero).
      const id = await make("blank-values");
      expect((await admin.from("prospects").select("estimated_value_eur, quote_value_eur").eq("id", id).single()).data).toEqual({ estimated_value_eur: null, quote_value_eur: null });
    });

    it("accepts every pipeline status and priority", async () => {
      for (const status of ["new", "researching", "ready_to_contact", "contacted", "follow_up_due", "replied", "interested", "concept_sent", "meeting_planned", "quote_sent", "won", "lost", "not_interested", "no_response"]) {
        expect((await admin.from("prospects").insert({ company_name: name(`s-${status}`), status })).error, status).toBeNull();
      }
      for (const priority of ["low", "normal", "high", "urgent"]) {
        expect((await admin.from("prospects").insert({ company_name: name(`p-${priority}`), priority })).error, priority).toBeNull();
      }
    });

    it("keeps date columns as calendar days and the legacy_ref unique (idempotent imports)", async () => {
      const id = await make("dates", { first_contact_on: "2026-10-30", next_follow_up_on: "2026-11-06", legacy_ref: `${TAG}:1` });
      expect((await admin.from("prospects").select("first_contact_on, next_follow_up_on").eq("id", id).single()).data).toEqual({ first_contact_on: "2026-10-30", next_follow_up_on: "2026-11-06" });
      expect((await admin.from("prospects").insert({ company_name: name("dates-2"), legacy_ref: `${TAG}:1` })).error?.code).toBe("23505");
    });
  });

  describe("activity history", () => {
    it("records creation, and every status change with the old and new status", async () => {
      const id = await make("history");
      expect((await admin.from("prospects").update({ status: "contacted" }).eq("id", id)).error).toBeNull();
      expect((await admin.from("prospects").update({ status: "replied" }).eq("id", id)).error).toBeNull();
      // Changing something other than the status adds no event.
      expect((await admin.from("prospects").update({ city: "Gent" }).eq("id", id)).error).toBeNull();

      const { data } = await admin.from("prospect_activities").select("type, title, metadata").eq("prospect_id", id).order("created_at");
      expect(data!.map((a) => a.type)).toEqual(["created", "status_changed", "status_changed"]);
      expect(data![1].metadata).toEqual({ from: "new", to: "contacted" });
      expect(data![2].metadata).toEqual({ from: "contacted", to: "replied" });
    });

    it("does not invent a 'created today' event for one-time migrations (legacy_ref)", async () => {
      const id = await make("legacy-history", { legacy_ref: `${TAG}:legacy` });
      expect((await admin.from("prospect_activities").select("id").eq("prospect_id", id)).data).toEqual([]);
    });

    it("keeps the list summary (last activity) current without loading the timeline", async () => {
      const id = await make("last-activity");
      await admin.from("prospect_activities").insert({ prospect_id: id, type: "note", title: "Called the owner", occurred_on: "2099-01-01" });
      await admin.from("prospect_activities").insert({ prospect_id: id, type: "note", title: "Older note", occurred_on: "2098-01-01" });
      const { data } = await admin.from("prospects").select("last_activity_on, last_activity_title").eq("id", id).single();
      expect(data).toEqual({ last_activity_on: "2099-01-01", last_activity_title: "Called the owner" });
    });

    it("rejects unknown activity types, and history cannot be edited (append-only)", async () => {
      const id = await make("append-only");
      expect((await admin.from("prospect_activities").insert({ prospect_id: id, type: "teleported", title: "x" })).error).not.toBeNull();
      const { data } = await admin.from("prospect_activities").insert({ prospect_id: id, type: "note", title: "keep me" }).select("id").single();
      const update = await admin.from("prospect_activities").update({ title: "rewritten" }).eq("id", data!.id);
      expect(update.error).not.toBeNull();
    });

    it("sorts the sort keys in pipeline order (status_order / priority_order)", async () => {
      const a = await make("order-a", { status: "won", priority: "urgent" });
      const b = await make("order-b", { status: "new", priority: "low" });
      const { data } = await admin.from("prospects").select("id, status_order, priority_order").in("id", [a, b]);
      const by = Object.fromEntries(data!.map((r) => [r.id, r]));
      expect(by[b].status_order).toBeLessThan(by[a].status_order);
      expect(by[a].priority_order).toBeLessThan(by[b].priority_order);
    });
  });

  describe("delete behaviour and links", () => {
    async function previewAndProject(n: string) {
      const preview = await service
        .from("client_previews")
        .insert({ client_name: "C", project_name: "P", subdomain: `${TAG}-${n}`, target_url: "https://client.example-host.com", access_code_hash: "$2a$12$notarealhash" })
        .select("id")
        .single();
      expect(preview.error).toBeNull();
      const project = await service
        .from("projects")
        .insert({ slug: `${TAG}-${n}`, title: `Project ${n}`, short_description: "d", category: "Website" })
        .select("id")
        .single();
      expect(project.error).toBeNull();
      return { previewId: preview.data!.id as string, projectId: project.data!.id as string };
    }

    it("links a preview and a project, and lets the admin read them through the prospect", async () => {
      const { previewId, projectId } = await previewAndProject("link");
      const id = await make("linked", { linked_preview_id: previewId, linked_project_id: projectId });
      const { data } = await admin.from("prospects").select("linked_preview_id, linked_project_id").eq("id", id).single();
      expect(data).toEqual({ linked_preview_id: previewId, linked_project_id: projectId });
      // A link to something that doesn't exist is refused.
      expect((await admin.from("prospects").update({ linked_preview_id: randomUUID() }).eq("id", id)).error?.code).toBe("23503");
    });

    it("deleting a prospect deletes its activities but NOT the linked preview or project", async () => {
      const { previewId, projectId } = await previewAndProject("keep");
      const id = await make("to-delete", { linked_preview_id: previewId, linked_project_id: projectId });
      await admin.from("prospects").update({ status: "contacted" }).eq("id", id);
      expect((await service.from("prospect_activities").select("id").eq("prospect_id", id)).data!.length).toBeGreaterThan(0);

      expect((await admin.from("prospects").delete().eq("id", id)).error).toBeNull();
      expect((await service.from("prospect_activities").select("id").eq("prospect_id", id)).data).toEqual([]);
      expect((await service.from("client_previews").select("id").eq("id", previewId)).data).toHaveLength(1);
      expect((await service.from("projects").select("id").eq("id", projectId)).data).toHaveLength(1);
    });

    it("deleting a linked preview or project only clears the link (the prospect stays)", async () => {
      const { previewId, projectId } = await previewAndProject("orphan");
      const id = await make("keeps-existing", { linked_preview_id: previewId, linked_project_id: projectId });
      await service.from("client_previews").delete().eq("id", previewId);
      await service.from("projects").delete().eq("id", projectId);
      expect((await admin.from("prospects").select("linked_preview_id, linked_project_id").eq("id", id).single()).data).toEqual({ linked_preview_id: null, linked_project_id: null });
    });
  });

  describe("summary maths", () => {
    const summary = async () =>
      (await admin.rpc("prospect_summary", { p_today: "2026-11-02", p_week_end: "2026-11-08" })).data as Record<string, number>;

    it("counts honestly: blank values are not EUR 0, closed prospects are not pipeline, follow-ups skip closed ones", async () => {
      // Other prospects (the real CRM or an earlier import) may exist: measure the change these rows cause.
      const before = await summary();
      await make("sum-new", { status: "new" });
      await make("sum-contacted-overdue", { status: "contacted", next_follow_up_on: "2026-10-30", estimated_value_eur: 1000 });
      await make("sum-contacted-today", { status: "contacted", next_follow_up_on: "2026-11-02" });
      await make("sum-replied-week", { status: "replied", next_follow_up_on: "2026-11-05", estimated_value_eur: 2000, quote_value_eur: 1800 });
      await make("sum-quote", { status: "quote_sent", estimated_value_eur: 3000, quote_value_eur: 2800 });
      await make("sum-won", { status: "won", estimated_value_eur: 5000, quote_value_eur: 4500, next_follow_up_on: "2026-10-01" });
      await make("sum-lost", { status: "lost", estimated_value_eur: 7000, next_follow_up_on: "2026-10-01" });
      const after = await summary();

      const delta = Object.fromEntries(Object.keys(after).map((k) => [k, Number(after[k]) - Number(before[k])]));
      expect(delta).toEqual({
        total: 7,
        contacted: 6, // everything except "new"
        replies: 3, // replied, quote sent, won
        active_opportunities: 2, // replied + quote sent (open and responded)
        followups_overdue: 1, // contacted 30 Oct; the won/lost ones with old dates are not overdue
        followups_today: 1,
        followups_week: 1, // 5 Nov
        pipeline_value: 6000, // 1000 + 2000 + 3000: no won/lost, and blanks add nothing
        pipeline_count: 3,
        quote_total: 9100, // 1800 + 2800 + 4500 (lost has no quote)
        quote_count: 3,
        won_value: 4500,
        won_count: 1,
      });
    });
  });

  describe("schema expectations", () => {
    it("has the practical indexes (and no more than needed)", () => {
      const out = execFileSync(
        "npx",
        ["--yes", "supabase@latest", "db", "query", "--local", `"select indexname from pg_indexes where schemaname='public' and tablename in ('prospects','prospect_activities') order by indexname"`],
        { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      for (const index of [
        "prospects_status_idx",
        "prospects_priority_idx",
        "prospects_next_follow_up_idx",
        "prospects_created_at_idx",
        "prospects_company_name_idx",
        "prospects_linked_project_idx",
        "prospects_linked_preview_idx",
        "prospect_activities_timeline_idx",
      ]) expect(out, index).toContain(index);
    });

    it("has RLS enabled on all three tables", async () => {
      const out = execFileSync(
        "npx",
        ["--yes", "supabase@latest", "db", "query", "--local", `"select relname, relrowsecurity from pg_class where relname in ('prospects','prospect_activities','prospect_imports') order by relname"`],
        { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      expect((out.match(/"relrowsecurity": true/g) ?? []).length).toBe(3);
    });
  });
});
