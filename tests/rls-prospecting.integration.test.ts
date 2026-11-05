/**
 * Prospect Finder against a REAL local Supabase stack: admin-only tables, a run that only ever proposes, "Add prospect" through the CRM's own
 * creation rules (Researching, never Contacted), auditable Ignore, deterministic duplicates and the cooldown. The mock provider only: no network,
 * no AI. Skipped unless run via `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runPipeline } from "@/lib/prospecting/pipeline";
import { MockBusinessSource, MockProvider } from "@/lib/prospecting/providers/mock";
import { addDiscoveryCandidate, createRun, dbPipelineStore, finishRun, getInsightForProspect, ignoreDiscoveryCandidate, listCandidates, listRuns } from "@/lib/prospecting/service";
import type { DiscoveryRequest } from "@/lib/prospecting/types";
import { assertLocalSupabase } from "./local-only";

vi.mock("server-only", () => ({}));

const enabled = process.env.RLS_TEST === "1" || process.env.npm_lifecycle_event === "test:rls";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (enabled) assertLocalSupabase();

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const TAG = "pfinder";
const ADMIN = { email: `${TAG}-admin@portfolio.test`, password: "Finder-Admin-Password-2026!" };
const OUTSIDER = { email: `${TAG}-outsider@portfolio.test`, password: "Finder-Outsider-Password-2026!" };
const LOCATION = `Brugge ${TAG}`;

const req = (over: Partial<DiscoveryRequest> = {}): DiscoveryRequest => ({ mode: "redesign", location: LOCATION, area: null, industry: null, threshold: 40, count: 20, excludeResearched: true, ...over });

describe.skipIf(!enabled)("prospect finder (run -> review -> prospect)", () => {
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let outsider: SupabaseClient;
  let adminId = "";
  const userIds: string[] = [];

  const wipe = async () => {
    await service.from("prospect_discovery_runs").delete().like("location", `%${TAG}`);
    await service.from("prospect_discovery_seen").delete().or("domain.like.%.invalid,domain.like.name:%");
    await service.from("prospects").delete().like("source", "AI prospecting%");
    await service.from("prospects").delete().like("company_name", `${TAG}%`);
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
  });
  afterAll(async () => {
    await wipe();
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  const prospectCount = async () => (await admin.from("prospects").select("id", { count: "exact", head: true })).count ?? 0;

  async function doRun(request: DiscoveryRequest) {
    const created = await createRun(admin as never, adminId, request, "mock");
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("run");
    const outcome = await runPipeline(request, { provider: new MockProvider(), source: new MockBusinessSource(), store: dbPipelineStore(admin as never, created.id) });
    await finishRun(admin as never, created.id, outcome.status, outcome.stage, outcome.counters, outcome.errors);
    return { runId: created.id, outcome };
  }

  it("is private: the public role and a signed-in non-admin can neither read nor write any discovery table", async () => {
    const anon = createClient(url, anonKey, opts);
    for (const client of [anon, outsider]) {
      for (const table of ["prospect_discovery_runs", "prospect_discovery_candidates", "prospect_discovery_seen"]) {
        expect((await client.from(table).select("*")).data ?? [], table).toHaveLength(0);
      }
      expect((await client.from("prospect_discovery_runs").insert({ mode: "quick", location: "x", requested_count: 1, provider: "mock" })).error).not.toBeNull();
      expect((await client.from("prospect_discovery_seen").insert({ domain: "x.be", outcome: "skipped" })).error).not.toBeNull();
    }
  });

  it("a run only proposes: candidates are written, no prospect is created, progress and history are recorded", async () => {
    const before = await prospectCount();
    const { runId, outcome } = await doRun(req());
    expect(outcome.status).toBe("completed");
    expect(await prospectCount()).toBe(before);

    const pending = await listCandidates(admin as never, { status: "pending", runId });
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((c) => c.status === "pending" && c.synthetic && c.score >= 40 && c.added_prospect_id === null)).toBe(true);
    expect(pending.map((c) => c.score)).toEqual([...pending.map((c) => c.score)].sort((a, b) => b - a));

    const runs = await listRuns(admin as never, 20);
    const run = runs.find((r) => r.id === runId)!;
    expect(run).toMatchObject({ status: "completed", provider: "mock", threshold: 40, qualified: pending.length });
    expect(run.raw_found).toBeGreaterThan(0);
    expect((await service.from("prospect_discovery_seen").select("domain").or("domain.like.%.invalid,domain.like.name:%")).data!.length).toBeGreaterThan(0);
  });

  it("the cooldown stops the same domains being analysed again in the next run", async () => {
    const { outcome } = await doRun(req());
    expect(outcome.counters.skipped_cooldown).toBeGreaterThan(0);
    expect(outcome.candidates).toBe(0);
  });

  it("Add prospect creates one Researching prospect through the CRM rules, copies only verified fields, logs an activity and keeps the research", async () => {
    const [candidate] = (await listCandidates(admin as never, { status: "pending" })).filter((c) => c.website_url && c.email);
    const before = await prospectCount();
    const added = await addDiscoveryCandidate(admin as never, adminId, candidate.id);
    expect(added).toMatchObject({ ok: true, company: candidate.company_name });
    if (!added.ok) return;
    expect(await prospectCount()).toBe(before + 1);

    const prospect = await admin.from("prospects").select("*").eq("id", added.prospectId).single();
    expect(prospect.data).toMatchObject({ company_name: candidate.company_name, email: candidate.email, status: "researching", priority: "normal", source: "AI prospecting (sample data)", city: candidate.city, sector: candidate.industry, first_contact_on: null, last_contact_on: null, next_follow_up_on: null, estimated_value_eur: null, contact_name: null });
    expect(prospect.data!.status).not.toBe("contacted");
    expect(prospect.data!.website_url).toContain(candidate.domain!);

    const activities = await admin.from("prospect_activities").select("type, title, description").eq("prospect_id", added.prospectId);
    const discovered = activities.data!.find((a) => a.title === "Prospect discovered");
    expect(discovered!.description).toContain("Added from AI Prospect Finder");
    expect(discovered!.description).toContain(`${candidate.score}/100`);
    expect(activities.data!.some((a) => a.type === "contacted")).toBe(false);

    const insight = await getInsightForProspect(admin as never, added.prospectId);
    expect(insight).toMatchObject({ id: candidate.id, score: candidate.score, status: "added", added_prospect_id: added.prospectId });
    expect(insight!.evidence.length + insight!.reasons.length).toBeGreaterThan(0);

    // Double click / second tab: the same prospect comes back, nothing is created twice.
    expect(await addDiscoveryCandidate(admin as never, adminId, candidate.id)).toMatchObject({ ok: true, prospectId: added.prospectId });
    expect(await prospectCount()).toBe(before + 1);
  });

  it("two simultaneous clicks create one prospect", async () => {
    const [candidate] = await listCandidates(admin as never, { status: "pending" });
    const before = await prospectCount();
    const [a, b] = await Promise.all([addDiscoveryCandidate(admin as never, adminId, candidate.id), addDiscoveryCandidate(admin as never, adminId, candidate.id)]);
    expect([a, b].filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
    expect(await prospectCount()).toBe(before + 1);
  });

  it("Ignore is auditable and the business is not rediscovered in a later run", async () => {
    const [candidate] = (await listCandidates(admin as never, { status: "pending" })).filter((c) => c.domain);
    expect(await ignoreDiscoveryCandidate(admin as never, adminId, candidate.id)).toEqual({ ok: true });
    expect(await ignoreDiscoveryCandidate(admin as never, adminId, candidate.id)).toEqual({ ok: true });
    const row = await admin.from("prospect_discovery_candidates").select("status, ignored_at, decided_by, decision_note, company_name, domain, score").eq("id", candidate.id).single();
    expect(row.data).toMatchObject({ status: "ignored", decided_by: adminId, company_name: candidate.company_name, domain: candidate.domain });
    expect(row.data!.ignored_at).toBeTruthy();
    expect(row.data!.decision_note).toMatch(/ignored/i);

    // Even with the cooldown switched off, an ignored business is never proposed again.
    const { runId } = await doRun(req({ excludeResearched: false }));
    const again = await listCandidates(admin as never, { status: "pending", runId });
    expect(again.some((c) => c.domain === candidate.domain)).toBe(false);
  });

  it("a business already in the CRM is shown as 'Already in CRM', never proposed, and cannot be added later either", async () => {
    await service.from("prospect_discovery_seen").delete().or("domain.like.%.invalid,domain.like.name:%");
    await admin.from("prospects").insert({ company_name: `${TAG} Existing`, email: "hello@sample-car-detailing.invalid" });
    const { runId } = await doRun(req({ excludeResearched: false }));
    const dupes = await listCandidates(admin as never, { status: "rejected_duplicate", runId });
    expect(dupes.some((d) => d.company_name.includes("Car Detailing") && d.duplicate_of && /same email/i.test(d.duplicate_reason ?? ""))).toBe(true);
    expect((await listCandidates(admin as never, { status: "pending", runId })).some((c) => c.company_name.includes("Car Detailing"))).toBe(false);

    // A prospect that appears after the run is caught when someone presses Add.
    const late = (await listCandidates(admin as never, { status: "pending" })).find((c) => c.email && !c.company_name.includes("Car Detailing"));
    expect(late).toBeDefined();
    if (late?.email) {
      await admin.from("prospects").insert({ company_name: `${TAG} Late`, email: late.email.toUpperCase() });
      const before = await prospectCount();
      const result = await addDiscoveryCandidate(admin as never, adminId, late.id);
      expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/already in the crm/i) });
      expect(await prospectCount()).toBe(before);
      expect((await admin.from("prospect_discovery_candidates").select("status").eq("id", late.id).single()).data!.status).toBe("rejected_duplicate");
    }
  });
});
