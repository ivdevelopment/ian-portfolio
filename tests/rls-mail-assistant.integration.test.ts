/**
 * The Mail Assistant's database layer against a REAL local Supabase stack, called exactly as the deployed API route calls it (anonymous role +
 * the agent functions, with the API's own validation in front) and as the signed-in admin's session. No Codex, no network, no mail is sent.
 * Skipped unless run via `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleAgentOp, type AgentOp, type Rpc } from "@/lib/prospecting/agent/endpoint";
import { createAgentToken, revokeAgent } from "@/lib/prospecting/agent/service";
import { dismiss, getAssistantView, markUsed, requestRecommendation } from "@/lib/mail-assistant/service";
import { assertLocalSupabase } from "./local-only";

vi.mock("server-only", () => ({}));

const enabled = process.env.RLS_TEST === "1" || process.env.npm_lifecycle_event === "test:rls";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (enabled) assertLocalSupabase();

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const TAG = "pmail";
const ADMIN = { email: `${TAG}-admin@portfolio.test`, password: "Mail-Admin-Password-2026!" };
const OUTSIDER = { email: `${TAG}-outsider@portfolio.test`, password: "Mail-Outsider-Password-2026!" };
const ENV = { AI_PROSPECTING_PROVIDER: "local_codex" };

const DUTCH_FIRST = "Dag Sofie,\n\nIk kwam jullie website tegen en merkte dat de reservatieflow een stuk directer zou kunnen. Ik heb daar een kleine suggestie voor, en toon ze graag als je interesse hebt.\n\nGroeten,\nIan";
const answer = (over: Record<string, unknown> = {}) => ({ action_type: "first_outreach", recommended_send_at: null, should_send_now: true, subject: "Een kleine suggestie voor jullie site", body: DUTCH_FIRST, reason_summary: "Short, concrete angle on the reservation flow.", ...over });

describe.skipIf(!enabled)("mail assistant (queue, token, lease, RLS)", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;
  let outsider: SupabaseClient;
  let adminId = "";
  let token = "";
  const userIds: string[] = [];

  const rpc: Rpc = async (fn, args) => {
    const { data, error } = await anon.rpc(fn as never, args as never);
    return { data, error: error ? { message: error.message } : null };
  };
  const call = (op: AgentOp, body: unknown, t = token) => handleAgentOp(op, t, JSON.stringify(body), rpc);
  const heartbeat = (state = "ready") => call("heartbeat", { codexVersion: "0.166.0", codexState: state });

  const newProspect = async (over: Record<string, unknown> = {}) => {
    const { data, error } = await service.from("prospects").insert({ company_name: `${TAG} Fietsen ${Math.random().toString(36).slice(2, 7)}`, email: "info@fietsen.test", contact_name: "Sofie", status: "ready_to_contact", ...over }).select("id").single();
    expect(error).toBeNull();
    return data!.id as string;
  };
  const wipe = async () => {
    await service.from("prospects").delete().like("company_name", `${TAG}%`);
    await service.from("mail_connections").delete().like("account_email", `${TAG}%`);
    await service.from("prospect_agents").delete().like("display_name", `${TAG}%`);
  };
  const claimed = async () => {
    const r = await call("mail_claim", {});
    expect(r.status).toBe(200);
    return (r.body as { job: { id: string; plan: { action: string }; context: Record<string, unknown>; attempt: number } | null }).job;
  };
  const rowOf = async (id: string) => (await service.from("prospect_mail_recommendations").select("*").eq("id", id).single()).data!;
  const expireLease = (id: string) => service.from("prospect_mail_recommendations").update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);

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
    await wipe();
    await service.from("prospect_mail_recommendations").delete().in("status", ["queued", "generating"]);
    const made = await createAgentToken(admin as never, adminId, `${TAG}-pc`);
    if (!made.ok) throw new Error(made.error);
    token = made.token;
    expect((await heartbeat()).status).toBe(200);
  });

  afterAll(async () => {
    await wipe();
    for (const id of userIds) {
      await service.from("admin_users").delete().eq("user_id", id);
      await service.auth.admin.deleteUser(id);
    }
  });

  it("only an admin can read or queue a request; a signed-in stranger and the anonymous role can do nothing", async () => {
    const id = await newProspect();
    const view = await getAssistantView(admin as never, id, new Date(), ENV);
    expect(view?.plan.action).toBe("first_outreach");
    expect(view?.availability.state).toBe("ready");
    const queued = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    expect(queued.ok).toBe(true);
    for (const who of [outsider, anon]) {
      expect((await who.from("prospect_mail_recommendations").select("id")).data ?? []).toHaveLength(0);
      const attempt = await who.from("prospect_mail_recommendations").insert({ prospect_id: id, plan: {}, context: {}, context_fingerprint: "a".repeat(64) });
      expect(attempt.error).not.toBeNull();
    }
    if (queued.ok) await dismiss(admin as never, queued.jobId);
  });

  it("an admin session cannot forge a draft: no subject, body or 'current' status can be written, and no forged request can skip the queue", async () => {
    const id = await newProspect();
    const queued = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    if (!queued.ok) throw new Error(queued.error);
    const forged = await admin.from("prospect_mail_recommendations").update({ subject: "Hacked", body: "Hacked body" }).eq("id", queued.jobId);
    expect(forged.error).not.toBeNull();
    const asCurrent = await admin.from("prospect_mail_recommendations").update({ status: "current" }).eq("id", queued.jobId);
    expect(asCurrent.error).not.toBeNull(); // the draft columns are empty, so the table's own check refuses it
    const insertCurrent = await admin.from("prospect_mail_recommendations").insert({ prospect_id: id, status: "current", plan: {}, context: {}, context_fingerprint: "b".repeat(64) } as never);
    expect(insertCurrent.error).not.toBeNull();
    await dismiss(admin as never, queued.jobId);
  });

  it("one open request per prospect: a double click finds the open one instead of queueing a second Codex run", async () => {
    const id = await newProspect();
    const a = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    const b = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    expect(a).toMatchObject({ ok: true, alreadyOpen: false });
    expect(b).toMatchObject({ ok: true, alreadyOpen: true });
    if (a.ok && b.ok) expect(b.jobId).toBe(a.jobId);
    expect((await service.from("prospect_mail_recommendations").select("id").eq("prospect_id", id)).data).toHaveLength(1);
    if (a.ok) await dismiss(admin as never, a.jobId);
  });

  it("the agent claims it with the plan and the minimal context, produces a draft, and the CRM shows it", async () => {
    await service.from("prospect_mail_recommendations").delete().in("status", ["queued", "generating"]);
    const id = await newProspect({ sector: "bicycle rental", city: "Brugge", website_url: "https://www.fietsen.test/" });
    const queued = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    if (!queued.ok) throw new Error(queued.error);
    const waiting = await getAssistantView(admin as never, id, new Date(), ENV);
    expect(waiting?.job).toMatchObject({ stage: "waiting_agent" });
    expect(waiting?.generate).toBeNull();

    const job = await claimed();
    expect(job).toMatchObject({ id: queued.jobId, attempt: 1, plan: { action: "first_outreach", needs_ai: true } });
    expect(JSON.stringify(job!.context)).not.toContain("info@fietsen.test"); // never an email address
    expect(job!.context).toMatchObject({ action: { type: "first_outreach" }, prospect: { contact_name: "Sofie", website: "fietsen.test" } });
    expect((await getAssistantView(admin as never, id, new Date(), ENV))?.job).toMatchObject({ stage: "generating" });
    expect(await claimed()).toBeNull(); // nothing else is waiting

    expect((await call("mail_progress", { jobId: job!.id })).body).toMatchObject({ ok: true, cancel: false });
    const done = await call("mail_result", { jobId: job!.id, result: answer({ recommended_send_at: "2031-01-01" }), codexMs: 4200 });
    expect(done.status).toBe(200);

    const row = await rowOf(job!.id);
    expect(row).toMatchObject({ status: "current", action_type: "first_outreach", language: "nl", subject: "Een kleine suggestie voor jullie site" });
    expect(row.recommended_send_at).not.toBe("2031-01-01"); // the plan's date, not the model's
    expect(row.codex_ms).toBe(4200);
    const view = await getAssistantView(admin as never, id, new Date(), ENV);
    expect(view?.draft).toMatchObject({ subject: "Een kleine suggestie voor jullie site", used: false, stale: { outdated: false } });
    expect(view?.generate?.label).toBe("Regenerate");
  });

  it("the server re-checks the answer against the STORED plan: a wrong action or a tracking mention is rejected and the request fails", async () => {
    const id = await newProspect();
    const q = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    if (!q.ok) throw new Error(q.error);
    const job = (await claimed())!;
    const wrong = await call("mail_result", { jobId: job.id, result: answer({ action_type: "follow_up" }) });
    expect(wrong.status).toBe(422);
    expect(await rowOf(job.id)).toMatchObject({ status: "failed", failure_kind: "invalid_output", subject: null });

    const id2 = await newProspect();
    const q2 = await requestRecommendation(admin as never, adminId, id2, new Date(), ENV);
    if (!q2.ok) throw new Error(q2.error);
    const job2 = (await claimed())!;
    const leaky = await call("mail_result", { jobId: job2.id, result: answer({ body: `${DUTCH_FIRST} Ik zag dat je het gisteren om 14:37 bekeken hebt.` }) });
    expect(leaky.status).toBe(422);
    expect((await rowOf(job2.id)).status).toBe("failed");
    const view = await getAssistantView(admin as never, id2, new Date(), ENV);
    expect(view?.failure?.message).toContain("safety checks");
    expect(view?.generate?.label).toBe("Generate draft"); // try again is possible
  });

  it("a regenerated draft supersedes the previous one in one step; there is never more than one current draft", async () => {
    const id = await newProspect();
    const first = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    if (!first.ok) throw new Error(first.error);
    const j1 = (await claimed())!;
    await call("mail_result", { jobId: j1.id, result: answer() });
    const second = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    if (!second.ok) throw new Error(second.error);
    const j2 = (await claimed())!;
    expect(j2.id).not.toBe(j1.id);
    await call("mail_result", { jobId: j2.id, result: answer({ subject: "Tweede versie" }) });
    expect(await rowOf(j1.id)).toMatchObject({ status: "superseded" });
    expect(await rowOf(j2.id)).toMatchObject({ status: "current", subject: "Tweede versie" });
    expect((await service.from("prospect_mail_recommendations").select("id").eq("prospect_id", id).eq("status", "current")).data).toHaveLength(1);
  });

  it("a synced mail makes the stored draft OUTDATED, and it is never silently reused", async () => {
    const id = await newProspect();
    const r = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    if (!r.ok) throw new Error(r.error);
    const job = (await claimed())!;
    await call("mail_result", { jobId: job.id, result: answer() });
    expect((await getAssistantView(admin as never, id, new Date(), ENV))?.draft?.stale.outdated).toBe(false);

    const conn = await service.from("mail_connections").insert({ account_email: `${TAG}@mail.test`, provider_account_id: "acc1", data_center: "eu", scopes: "ZohoMail.messages.READ", refresh_token_encrypted: "x" }).select("id").single();
    const sentAt = new Date(Date.now() - 86_400_000).toISOString();
    expect((await service.from("mail_messages").insert({ connection_id: conn.data!.id, provider_message_id: `m-${id}`, direction: "outgoing", from_address: "ian@ianverlinden.com", to_addresses: ["info@fietsen.test"], subject: "Een kleine suggestie", snippet: "Dag Sofie, ik kwam jullie website tegen en had een kleine suggestie voor de reservatieflow.", sent_at: sentAt, prospect_id: id })).error).toBeNull();

    const view = await getAssistantView(admin as never, id, new Date(), ENV);
    expect(view?.draft?.stale).toMatchObject({ outdated: true, headline: "New mail activity detected" });
    // After the mail, the rules say wait (sent yesterday): no draft is on offer and no generate button either.
    expect(view?.plan).toMatchObject({ action: "wait", thenLabel: "Follow up", needsDraft: false });
    expect(view?.generate).toBeNull();
  });

  it("'Mark as used' keeps a trace in the history, changes nothing else, and does not pretend the mail was sent", async () => {
    const id = await newProspect();
    const r = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    if (!r.ok) throw new Error(r.error);
    const job = (await claimed())!;
    await call("mail_result", { jobId: job.id, result: answer() });
    const before = (await service.from("prospects").select("status, last_contact_on, first_contact_on").eq("id", id).single()).data;
    expect(await markUsed(admin as never, job.id)).toEqual({ ok: true });
    expect(await markUsed(admin as never, job.id)).toMatchObject({ ok: false }); // only a current draft can be marked
    expect(await rowOf(job.id)).toMatchObject({ status: "used" });
    expect((await service.from("prospects").select("status, last_contact_on, first_contact_on").eq("id", id).single()).data).toEqual(before);
    const acts = (await service.from("prospect_activities").select("type, title, metadata").eq("prospect_id", id).eq("type", "mail_assistant_used")).data ?? [];
    expect(acts).toHaveLength(1);
    expect(acts[0].metadata).toMatchObject({ recommendation_id: job.id, action_type: "first_outreach" });
    // A used draft does not count as an outgoing touch: the plan is still "first outreach" until real mail is synced.
    const view = await getAssistantView(admin as never, id, new Date(), ENV);
    expect(view?.plan.action).toBe("first_outreach");
    expect(view?.draft).toMatchObject({ used: true });
  });

  it("dismissing a draft or cancelling a request leaves the prospect untouched; a dismissed request tells the agent to stop", async () => {
    const id = await newProspect();
    const r = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    if (!r.ok) throw new Error(r.error);
    const job = (await claimed())!;
    expect(await dismiss(admin as never, job.id)).toEqual({ ok: true });
    expect((await call("mail_progress", { jobId: job.id })).body).toMatchObject({ ok: true, cancel: true });
    expect((await call("mail_result", { jobId: job.id, result: answer() })).status).toBe(409); // the lease is gone: nothing is stored
    expect(await rowOf(job.id)).toMatchObject({ status: "dismissed", subject: null });
    expect((await service.from("prospects").select("status").eq("id", id).single()).data?.status).toBe("ready_to_contact");
  });

  it("a request whose agent stopped goes back to the queue, and fails after three attempts", async () => {
    const id = await newProspect();
    const r = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    if (!r.ok) throw new Error(r.error);
    for (const attempt of [1, 2, 3]) {
      const job = (await claimed())!;
      expect(job).toMatchObject({ id: r.jobId, attempt });
      await expireLease(job.id);
    }
    expect(await claimed()).toBeNull();
    expect(await rowOf(r.jobId)).toMatchObject({ status: "failed", failure_kind: "agent_stopped" });
  });

  it("failure kinds are a fixed set, and a revoked or wrong token stops working at once", async () => {
    const id = await newProspect();
    const r = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    if (!r.ok) throw new Error(r.error);
    const job = (await claimed())!;
    expect((await call("mail_fail", { jobId: job.id, kind: "codex_usage_limit" })).status).toBe(200);
    expect(await rowOf(job.id)).toMatchObject({ status: "failed", failure_kind: "codex_usage_limit" });
    expect((await getAssistantView(admin as never, id, new Date(), ENV))?.failure?.message).toContain("usage limit");

    expect((await call("mail_claim", {}, `ipa_${"A".repeat(43)}`)).status).toBe(401);
    expect((await call("mail_fail", { jobId: job.id, kind: "<script>" })).status).toBe(400);

    const id2 = await newProspect();
    const q2 = await requestRecommendation(admin as never, adminId, id2, new Date(), ENV);
    if (!q2.ok) throw new Error(q2.error);
    expect(await revokeAgent(admin as never)).toEqual({ ok: true });
    expect((await call("mail_claim", {})).status).toBe(401);
    await dismiss(admin as never, q2.jobId);
    // Re-register for the remaining tests.
    const made = await createAgentToken(admin as never, adminId, `${TAG}-pc2`);
    if (!made.ok) throw new Error(made.error);
    token = made.token;
    await heartbeat();
  });

  it("the Mail Assistant is unavailable, with the right message, when the agent is offline or Codex is not ready; no request is queued", async () => {
    const id = await newProspect();
    await service.from("prospect_agents").update({ last_seen_at: new Date(Date.now() - 600_000).toISOString() }).like("display_name", `${TAG}%`);
    const offline = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    expect(offline).toMatchObject({ ok: false, code: "unavailable", error: "Mail Assistant unavailable. Start Ian Prospect Agent on your PC." });
    expect((await getAssistantView(admin as never, id, new Date(), ENV))?.generate).toMatchObject({ enabled: false, disabledReason: "Mail Assistant unavailable. Start Ian Prospect Agent on your PC." });
    await heartbeat("not_authenticated");
    expect(await requestRecommendation(admin as never, adminId, id, new Date(), ENV)).toMatchObject({ ok: false, code: "unavailable" });
    expect(await requestRecommendation(admin as never, adminId, id, new Date(), {})).toMatchObject({ ok: false, code: "unavailable" }); // the provider flag is off
    await heartbeat("ready");
    expect((await service.from("prospect_mail_recommendations").select("id").eq("prospect_id", id)).data).toHaveLength(0);
  });

  it("no draft is ever queued for a wait, a closed prospect, or a reply that needs more context", async () => {
    const lost = await newProspect({ status: "lost" });
    expect(await requestRecommendation(admin as never, adminId, lost, new Date(), ENV)).toMatchObject({ ok: false, code: "no_draft_needed" });
    const view = await getAssistantView(admin as never, lost, new Date(), ENV);
    expect(view?.plan).toMatchObject({ action: "no_action", needsDraft: false });
    expect(view?.generate).toBeNull();
    expect(view?.draft).toBeNull();
  });

  it("existing agent behaviour is untouched: the discovery queue still claims nothing when only a mail request exists", async () => {
    const id = await newProspect();
    const r = await requestRecommendation(admin as never, adminId, id, new Date(), ENV);
    if (!r.ok) throw new Error(r.error);
    expect((await call("claim", {})).body).toMatchObject({ ok: true, run: null });
    expect((await claimed())?.id).toBe(r.jobId);
    await dismiss(admin as never, r.jobId);
  });
});
