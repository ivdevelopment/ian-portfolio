/**
 * The Local Prospect Agent's database layer against a REAL local Supabase stack, called exactly as the deployed API route calls it: through the
 * anonymous role and the agent functions, with the API's own request handling in front. No Codex, no network. Skipped unless run via `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleAgentOp, type AgentOp, type Rpc } from "@/lib/prospecting/agent/endpoint";
import { createAgentToken, getAgentStatus, revokeAgent } from "@/lib/prospecting/agent/service";
import { cancelRun, createRun, getRun, listCandidates } from "@/lib/prospecting/service";
import type { DiscoveryRequest } from "@/lib/prospecting/types";
import { assertLocalSupabase } from "./local-only";

vi.mock("server-only", () => ({}));

const enabled = process.env.RLS_TEST === "1" || process.env.npm_lifecycle_event === "test:rls";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (enabled) assertLocalSupabase();

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const TAG = "pagent";
const ADMIN = { email: `${TAG}-admin@portfolio.test`, password: "Agent-Admin-Password-2026!" };
const OUTSIDER = { email: `${TAG}-outsider@portfolio.test`, password: "Agent-Outsider-Password-2026!" };
const LOCATION = `Brugge ${TAG}`;
const req = (over: Partial<DiscoveryRequest> = {}): DiscoveryRequest => ({ mode: "quick", location: LOCATION, area: null, industry: null, threshold: 70, count: 5, excludeResearched: true, ...over });

const cat = (score: number, max: number, obs: string[] = []) => ({ score, max, reason: "Observed from the evidence provided.", observations: obs });
const goodCandidate = (name: string, domain: string, email: string | null = `info@${domain}`) => ({
  company_name: name,
  website_url: `https://${domain}/`,
  email,
  phone: null,
  city: "Brugge",
  region: "West-Vlaanderen",
  industry: "bicycle",
  score: 82,
  score_breakdown: { business_fit: cat(22, 25), website_need: cat(20, 25, ["o1"]), conversion_gap: cat(12, 15, ["o1"]), service_opportunity: cat(12, 15), local_relevance: cat(8, 10), contactability: cat(8, 10) },
  summary: "A modernisation opportunity.",
  opportunity: "Website redesign + quote request flow",
  evidence: [{ id: "o1", url: `https://${domain}/`, title: "Home", fact: "No booking link was found on the pages checked.", at: "2026-11-06T09:00:00.000Z" }],
  source_urls: ["https://www.openstreetmap.org/node/1"],
});
const FINAL = { status: "completed", stage: "done", counters: { raw_found: 9, analyzed: 6, qualified: 1, duplicates_removed: 0, skipped_cooldown: 0 }, errors: [] as string[], codexMs: 1234, codexCalls: 2 };

describe.skipIf(!enabled)("local prospect agent (queue, token, lease)", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;
  let outsider: SupabaseClient;
  let adminId = "";
  const userIds: string[] = [];
  let token = "";

  const rpc: Rpc = async (fn, args) => {
    const { data, error } = await anon.rpc(fn as never, args as never);
    return { data, error: error ? { message: error.message } : null };
  };
  const call = (op: AgentOp, body: unknown, t = token) => handleAgentOp(op, t, JSON.stringify(body), rpc);
  const queue = async (over: Partial<DiscoveryRequest> = {}) => {
    const r = await createRun(admin as never, adminId, req(over), "local_codex", { queued: true });
    if (!r.ok) throw new Error(r.error);
    return r.id;
  };
  const wipe = async () => {
    await service.from("prospect_discovery_runs").delete().like("location", `%${TAG}`);
    await service.from("prospect_discovery_seen").delete().or("domain.like.%.pagent-test.be,domain.like.name:%");
    await service.from("prospects").delete().like("company_name", `${TAG}%`);
    await service.from("prospect_agents").delete().like("display_name", `${TAG}%`);
  };
  const expireLease = (id: string) => service.from("prospect_discovery_runs").update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);

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
    adminId = userIds[0];
    expect((await service.from("admin_users").insert({ user_id: adminId })).error).toBeNull();
    admin = createClient(url, anonKey, opts);
    expect((await admin.auth.signInWithPassword(ADMIN)).error).toBeNull();
    outsider = createClient(url, anonKey, opts);
    expect((await outsider.auth.signInWithPassword(OUTSIDER)).error).toBeNull();
    await service.from("prospect_discovery_runs").delete().in("status", ["queued", "claimed", "discovering", "analyzing", "qualifying", "running"]);
    await wipe();
    const made = await createAgentToken(admin as never, adminId, `${TAG}-PC`);
    expect(made.ok).toBe(true);
    if (made.ok) token = made.token;
  });
  afterAll(async () => {
    await wipe();
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  it("refuses every operation without a valid token, and the internal helper cannot be called at all", async () => {
    const wrong = `ipa_${"A".repeat(43)}`;
    for (const op of ["heartbeat", "claim", "context", "progress", "result", "fail"] as const) {
      const body = op === "heartbeat" ? { codexState: "ready" } : op === "claim" ? {} : { runId: "33333333-3333-4333-8333-333333333333", stage: "x", counters: {}, candidates: [], final: FINAL, kind: "agent_error" };
      expect((await call(op, body, wrong)).status, op).toBe(401);
    }
    expect((await anon.rpc("agent_resolve" as never, { p_token: token } as never)).error).not.toBeNull();
    expect((await anon.from("prospect_agents").select("*")).data ?? []).toHaveLength(0);
  });

  it("is admin-only: no token hash can be read back, a non-admin sees and changes nothing", async () => {
    expect((await admin.from("prospect_agents").select("token_hash")).error).not.toBeNull();
    const list = await admin.from("prospect_agents").select("id, display_name, token_hint");
    expect(list.data!.length).toBeGreaterThan(0);
    expect((await outsider.from("prospect_agents").select("id")).data ?? []).toHaveLength(0);
    expect((await outsider.from("prospect_agents").update({ revoked_at: new Date().toISOString() }).is("revoked_at", null).select("id")).data ?? []).toHaveLength(0);
    expect((await outsider.from("prospect_agents").insert({ display_name: "x", token_hash: "a".repeat(64), token_hint: "ipa_xxxx" })).error).not.toBeNull();
    expect(token).not.toBe("");
    const raw = await service.from("prospect_agents").select("token_hash, token_hint").like("display_name", `${TAG}%`).single();
    expect(raw.data!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(raw.data!.token_hash).not.toContain(token.slice(4, 14));
  });

  it("heartbeat: the device is online, with its Codex diagnostics, and never a failure it did not report", async () => {
    expect((await call("heartbeat", { codexVersion: "0.46.1", codexState: "ready" })).body).toMatchObject({ ok: true, device: `${TAG}-PC` });
    const status = await getAgentStatus(admin as never);
    expect(status).toMatchObject({ name: `${TAG}-PC`, online: true, codexVersion: "0.46.1", codexState: "ready" });
    expect(await getAgentStatus(admin as never, Date.now() + 5 * 60_000)).toMatchObject({ online: false });
  });

  it("heartbeat: the business-data summary is whitelisted and shown to the admin; an older agent without it keeps the last value", async () => {
    const sent = { state: "ready", source: "Geofabrik Belgium", dataDate: "2026-11-04T10:00:00.000Z", businesses: 321000, freshness: "fresh", path: "C:\\secret" };
    expect((await call("heartbeat", { codexVersion: "0.46.1", codexState: "ready", businessData: sent })).body).toMatchObject({ ok: true });
    const status = await getAgentStatus(admin as never);
    expect(status?.businessData).toEqual({ state: "ready", source: "Geofabrik Belgium", data_date: "2026-11-04T10:00:00.000Z", businesses: 321000, freshness: "fresh" });
    expect(JSON.stringify(status?.businessData)).not.toContain("secret");
    await call("heartbeat", { codexVersion: "0.46.1", codexState: "ready" });
    expect((await getAgentStatus(admin as never))?.businessData).toMatchObject({ state: "ready", businesses: 321000 });
    await call("heartbeat", { codexVersion: "0.46.1", codexState: "ready", businessData: { state: "missing", source: "Geofabrik Belgium", dataDate: null, businesses: null, freshness: "unknown" } });
    expect((await getAgentStatus(admin as never))?.businessData).toEqual({ state: "missing", source: "Geofabrik Belgium", freshness: "unknown" });
  });

  it("fail: business_data_missing is a stored failure kind", async () => {
    const id = await queue();
    await call("claim", {});
    expect((await call("fail", { runId: id, kind: "business_data_missing", message: "Local business data is not installed on the agent PC yet." })).body).toMatchObject({ ok: true });
    expect(await getRun(admin as never, id)).toMatchObject({ status: "failed", failure_kind: "business_data_missing" });
  });

  it("claim: an empty queue gives nothing; a queued run is claimed once, with its search parameters and an 'Picked up by' stage", async () => {
    expect((await call("claim", {})).body).toMatchObject({ ok: true, run: null });
    const id = await queue({ industry: "Car detailers" });
    expect(await getRun(admin as never, id)).toMatchObject({ status: "queued", provider: "local_codex" });
    const claimed = (await call("claim", {})).body as { run: { id: string; mode: string; industry: string; threshold: number; attempt: number } };
    expect(claimed.run).toMatchObject({ id, mode: "quick", industry: "Car detailers", threshold: 70, attempt: 1 });
    expect(await getRun(admin as never, id)).toMatchObject({ status: "claimed", stage: `Picked up by ${TAG}-PC` });
    expect((await call("claim", {})).body).toMatchObject({ run: null });
    await call("fail", { runId: id, kind: "agent_error", message: "test cleanup" });
  });

  it("two workers claiming at the same moment: exactly one gets the run", async () => {
    const id = await queue();
    const [a, b] = await Promise.all([call("claim", {}), call("claim", {})]);
    const got = [a, b].filter((r) => (r.body as { run: unknown }).run !== null);
    expect(got).toHaveLength(1);
    expect(((got[0].body as { run: { id: string } }).run).id).toBe(id);
    await call("fail", { runId: id, kind: "agent_error", message: "cleanup" });
  });

  it("only one search at a time can be queued", async () => {
    const id = await queue();
    const again = await createRun(admin as never, adminId, req(), "local_codex", { queued: true });
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/already running/i) });
    expect(await cancelRun(admin as never, id)).toEqual({ ok: true });
    expect((await getRun(admin as never, id))!.status).toBe("cancelled");
    expect((await call("claim", {})).body).toMatchObject({ run: null });
  });

  it("progress: updates the stage and counters, extends the lease, and tells the agent when the admin cancels", async () => {
    const id = await queue();
    await call("claim", {});
    const p1 = await call("progress", { runId: id, status: "analyzing", stage: "Analyzing 5 websites…", counters: { raw_found: 12, analyzed: 3 }, errors: ["Garage: website unreachable"] });
    expect(p1.body).toMatchObject({ ok: true, cancel: false });
    expect(await getRun(admin as never, id)).toMatchObject({ status: "analyzing", stage: "Analyzing 5 websites…", raw_found: 12, analyzed: 3, errors: ["Garage: website unreachable"] });
    expect(await cancelRun(admin as never, id)).toEqual({ ok: true });
    expect((await call("progress", { runId: id, stage: "Qualifying candidates…", counters: {} })).body).toMatchObject({ ok: true, cancel: true });
    const done = await call("result", { runId: id, candidates: [goodCandidate("Kept Bike Shop", "kept.pagent-test.be")], final: { ...FINAL, status: "cancelled", stage: "Cancelled: 1 candidate kept" } });
    expect(done.body).toMatchObject({ ok: true, inserted: 1 });
    expect(await getRun(admin as never, id)).toMatchObject({ status: "cancelled", qualified: 1 });
    expect((await listCandidates(admin as never, { status: "pending", runId: id })).map((c) => c.company_name)).toEqual(["Kept Bike Shop"]);
  });

  it("context: the CRM's businesses arrive as facts and email HASHES, never a raw email address", async () => {
    await admin.from("prospects").insert({ company_name: `${TAG} Existing`, email: "secret.person@pagent-test.be", website_url: "https://existing.pagent-test.be", city: "Brugge" });
    const id = await queue();
    await call("claim", {});
    const ctx = (await call("context", { runId: id })).body as { prospects: Array<{ company_name: string; email_hash: string | null }>; run: { threshold: number } };
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("secret.person@pagent-test.be");
    expect(ctx.run.threshold).toBe(70);
    const mine = ctx.prospects.find((p) => p.company_name === `${TAG} Existing`)!;
    expect(mine.email_hash).toMatch(/^[0-9a-f]{64}$/);
    const { emailHash } = await import("@/lib/prospecting/dedupe");
    expect(mine.email_hash).toBe(emailHash("secret.person@pagent-test.be"));
    await call("fail", { runId: id, kind: "agent_error", message: "cleanup" });
  });

  it("result: stores accepted candidates, rejects invalid ones, skips businesses the CRM already has, remembers the cooldown, and records the run", async () => {
    const id = await queue();
    await call("claim", {});
    const invalid = { ...goodCandidate("Invalid Total", "invalid.pagent-test.be"), score: 99 };
    const r = await call("result", {
      runId: id,
      candidates: [goodCandidate("Fresh Shop", "fresh.pagent-test.be", "hi@fresh.pagent-test.be"), invalid, goodCandidate("Same Email", "another.pagent-test.be", "secret.person@pagent-test.be"), goodCandidate("Same Site", "existing.pagent-test.be")],
      duplicates: [{ company_name: "Dup", website_url: null, email: null, city: null, duplicate_of: null, duplicate_reason: "Already in the CRM" }],
      seen: [{ domain: "fresh.pagent-test.be", outcome: "candidate", score: 82 }, { domain: "low.pagent-test.be", outcome: "below_threshold", score: 40 }],
      final: { ...FINAL, errors: ["one website unreachable"], codexMs: 90_000, codexCalls: 3 },
    });
    expect(r.body).toMatchObject({ ok: true, inserted: 1, skipped_known: 2, rejected: 1 });
    const stored = await listCandidates(admin as never, { status: "pending", runId: id });
    expect(stored.map((c) => c.company_name)).toEqual(["Fresh Shop"]);
    expect(stored[0]).toMatchObject({ domain: "fresh.pagent-test.be", synthetic: false, score: 82 });
    expect((await listCandidates(admin as never, { status: "rejected_duplicate", runId: id })).map((c) => c.company_name)).toEqual(["Dup"]);
    const run = await getRun(admin as never, id);
    expect(run).toMatchObject({ status: "completed", qualified: 1, codex_ms: 90_000, codex_calls: 3, raw_found: 9 });
    expect(run!.errors.join(" ")).toMatch(/1 candidate rejected by the server/);
    const seen = await service.from("prospect_discovery_seen").select("domain, outcome").like("domain", "%.pagent-test.be");
    expect(seen.data!.map((s) => s.domain).sort()).toEqual(["fresh.pagent-test.be", "low.pagent-test.be"]);
    const events = (await service.from("prospect_discovery_runs").select("events").eq("id", id).single()).data!.events as Array<{ type: string }>;
    expect(events.map((e) => e.type)).toEqual(["queued", "claimed", "completed"]);
    // A second submission of the same run is refused: the run is finished.
    expect((await call("result", { runId: id, candidates: [], final: FINAL })).status).toBe(409);
  });

  it("fail: a fixed failure kind is stored with a short message, the lease is released and the run can be retried by a new search", async () => {
    const id = await queue();
    await call("claim", {});
    expect((await call("fail", { runId: id, kind: "codex_usage_limit", message: "Your current Codex/ChatGPT usage limit has been reached." })).body).toMatchObject({ ok: true });
    const run = await getRun(admin as never, id);
    expect(run).toMatchObject({ status: "failed", failure_kind: "codex_usage_limit", lease_expires_at: null });
    expect(run!.errors[0]).toMatch(/usage limit/);
    expect((await getAgentStatus(admin as never))!.lastFailureKind).toBe("codex_usage_limit");
    expect(await queue()).toBeTruthy();
    await service.from("prospect_discovery_runs").delete().in("status", ["queued"]);
  });

  it("an expired lease is not trusted: the old claim cannot report, the run returns to the queue, and a worker that crashed is retried up to three times", async () => {
    const id = await queue();
    await call("claim", {});
    await expireLease(id);
    expect((await call("progress", { runId: id, stage: "late", counters: {} })).status).toBe(409);
    expect((await call("result", { runId: id, candidates: [], final: FINAL })).status).toBe(409);
    expect((await call("context", { runId: id })).status).toBe(409);
    const again = (await call("claim", {})).body as { run: { id: string; attempt: number } };
    expect(again.run).toMatchObject({ id, attempt: 2 });
    await expireLease(id);
    expect(((await call("claim", {})).body as { run: { attempt: number } }).run.attempt).toBe(3);
    await expireLease(id);
    // Third lease expired: the run is failed instead of being retried forever.
    expect((await call("claim", {})).body).toMatchObject({ run: null });
    expect(await getRun(admin as never, id)).toMatchObject({ status: "failed", failure_kind: "agent_stopped" });
  });

  it("an expired lease on a cancelled run ends it as cancelled", async () => {
    const id = await queue();
    await call("claim", {});
    await cancelRun(admin as never, id);
    await expireLease(id);
    await call("claim", {});
    expect((await getRun(admin as never, id))!.status).toBe("cancelled");
  });

  it("revoking the device stops its token at once; a new token cannot touch a run the old device owns", async () => {
    const id = await queue();
    await call("claim", {});
    const old = token;
    const next = await createAgentToken(admin as never, adminId, `${TAG}-PC2`);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect((await call("heartbeat", { codexState: "ready" }, old)).status).toBe(401);
    expect((await call("claim", {}, old)).status).toBe(401);
    expect((await call("progress", { runId: id, stage: "x", counters: {} }, old)).status).toBe(401);
    // The new device is not the owner of the run the old one claimed.
    expect((await call("progress", { runId: id, stage: "hijack", counters: {} }, next.token)).status).toBe(409);
    expect((await call("result", { runId: id, candidates: [goodCandidate("Hijack", "hijack.pagent-test.be")], final: FINAL }, next.token)).status).toBe(409);
    expect((await listCandidates(admin as never, { status: "pending", runId: id }))).toHaveLength(0);
    expect(await revokeAgent(admin as never)).toEqual({ ok: true });
    expect((await call("heartbeat", { codexState: "ready" }, next.token)).status).toBe(401);
    expect(await getAgentStatus(admin as never)).toBeNull();
    // Rotate back to a fresh device for the remaining tests.
    const fresh = await createAgentToken(admin as never, adminId, `${TAG}-PC3`);
    if (fresh.ok) token = fresh.token;
    await service.from("prospect_discovery_runs").delete().eq("id", id);
  });

  it("nothing the agent does touches existing prospects, mail, quotes or previews", async () => {
    const count = async (t: string) => (await service.from(t).select("id", { count: "exact", head: true })).count ?? 0;
    const before = { prospects: await count("prospects"), mail: await count("mail_messages"), quotes: await count("quotes"), activities: await count("prospect_activities") };
    const id = await queue();
    await call("claim", {});
    await call("result", { runId: id, candidates: [goodCandidate("Only A Candidate", "only.pagent-test.be")], final: FINAL });
    expect({ prospects: await count("prospects"), mail: await count("mail_messages"), quotes: await count("quotes"), activities: await count("prospect_activities") }).toEqual(before);
  });
});
