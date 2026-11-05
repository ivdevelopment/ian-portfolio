import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AGENT_OPS, MAX_BODY_BYTES, RATE_LIMIT, handleAgentOp, rateLimited, type Rpc } from "@/lib/prospecting/agent/endpoint";
import { failureMessage } from "@/lib/prospecting/agent/messages";
import { TOKEN_PATTERN, bearerToken, generateAgentToken, hashAgentToken, tokenHint } from "@/lib/prospecting/agent/tokens";
import { checkCandidate } from "@/lib/prospecting/agent/validate";
import { SCORE_CATEGORIES, SCORE_MAX } from "@/lib/prospecting/types";

/* No database here: the functions behind the API are replaced by a fake, so these tests are about what the API accepts and refuses. */

describe("connection tokens", () => {
  it("are 256 random bits, recognisable by their prefix, unique, and stored only as a hash", () => {
    const a = generateAgentToken();
    const b = generateAgentToken();
    expect(a).toMatch(TOKEN_PATTERN);
    expect(a).not.toBe(b);
    expect(hashAgentToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAgentToken(a)).not.toContain(a.slice(4, 12));
    expect(hashAgentToken(a)).toBe(hashAgentToken(a));
    expect(tokenHint(a)).toBe(a.slice(0, 8));
  });

  it("are read only from a well-formed bearer header", () => {
    const t = generateAgentToken();
    expect(bearerToken(`Bearer ${t}`)).toBe(t);
    expect(bearerToken(`bearer ${t}`)).toBe(t);
    for (const bad of [null, "", t, `Basic ${t}`, "Bearer short", `Bearer ${t}x`, `Bearer ipa_${"!".repeat(43)}`, `Bearer ${t} extra`]) expect(bearerToken(bad), String(bad)).toBeNull();
  });
});

const cat = (score: number, obs: string[] = [], reason = "Observed from the evidence provided.") => ({ score, max: 0, reason, observations: obs });
function candidate(over: Record<string, unknown> = {}) {
  const base: Record<string, { score: number; max: number; reason: string; observations: string[] }> = {
    business_fit: { ...cat(22), max: SCORE_MAX.business_fit },
    website_need: { ...cat(20, ["o1"]), max: SCORE_MAX.website_need },
    conversion_gap: { ...cat(12, ["o1"]), max: SCORE_MAX.conversion_gap },
    service_opportunity: { ...cat(12), max: SCORE_MAX.service_opportunity },
    local_relevance: { ...cat(8), max: SCORE_MAX.local_relevance },
    contactability: { ...cat(8), max: SCORE_MAX.contactability },
  };
  return {
    company_name: "Thierry Bike Repair",
    website_url: "https://www.thierrybikerepair.be/",
    email: "info@thierrybikerepair.be",
    phone: "+3250123456",
    city: "Brugge",
    region: "West-Vlaanderen",
    industry: "bicycle",
    score: 82,
    score_breakdown: base,
    summary: "A modernisation opportunity.",
    opportunity: "Website redesign + quote request flow",
    evidence: [{ id: "o1", url: "https://www.thierrybikerepair.be/", title: "Home", fact: "No booking link was found on the pages checked.", at: "2026-11-06T09:00:00.000Z" }],
    source_urls: ["https://www.openstreetmap.org/node/1"],
    ...over,
  };
}
const withBreakdown = (patch: Record<string, Partial<{ score: number; max: number; reason: string; observations: string[] }>>, score = 82) => {
  const c = candidate({ score });
  for (const [k, v] of Object.entries(patch)) Object.assign((c.score_breakdown as Record<string, object>)[k], v);
  return c;
};

describe("what the server accepts from the agent", () => {
  it("accepts a well-formed, evidence-backed candidate and computes the domain itself (the worker's domain is ignored)", () => {
    const v = checkCandidate({ ...candidate(), domain: "evil.com" }, { threshold: 70 });
    expect(v).toMatchObject({ ok: true, row: { domain: "thierrybikerepair.be", synthetic: false, company_name: "Thierry Bike Repair" } });
  });

  it("rejects, one by one: shape, sample data, bad email, wrong maximums, a total that does not add up, a score below the run's minimum", () => {
    const t = 70;
    expect(checkCandidate({ company_name: "x" }, { threshold: t })).toMatchObject({ ok: false, reason: "malformed candidate" });
    expect(checkCandidate(candidate({ company_name: "Sample Bakery (sample data)" }), { threshold: t })).toMatchObject({ ok: false, reason: expect.stringContaining("sample data") });
    expect(checkCandidate(candidate({ email: "not an email" }), { threshold: t })).toMatchObject({ ok: false, reason: "invalid email" });
    expect(checkCandidate(withBreakdown({ business_fit: { max: 40 } }), { threshold: t })).toMatchObject({ ok: false, reason: expect.stringContaining("out of range") });
    expect(checkCandidate(withBreakdown({ business_fit: { score: 99 } }), { threshold: t })).toMatchObject({ ok: false });
    expect(checkCandidate(candidate({ score: 90 }), { threshold: t })).toMatchObject({ ok: false, reason: "score does not equal its breakdown" });
    expect(checkCandidate(candidate(), { threshold: 90 })).toMatchObject({ ok: false, reason: expect.stringContaining("minimum") });
  });

  it("rejects points without evidence, citations of unknown evidence, and more contactability than contact details found", () => {
    expect(checkCandidate(withBreakdown({ website_need: { observations: [] } }), { threshold: 70 })).toMatchObject({ ok: false, reason: expect.stringContaining("without evidence") });
    expect(checkCandidate(withBreakdown({ conversion_gap: { observations: ["o9"] } }), { threshold: 70 })).toMatchObject({ ok: false, reason: expect.stringContaining("unknown evidence") });
    expect(checkCandidate(candidate({ email: null, phone: null }), { threshold: 70 })).toMatchObject({ ok: false, reason: expect.stringContaining("contactability") });
    expect(checkCandidate(candidate({ email: null, phone: null, score: 76, score_breakdown: { ...candidate().score_breakdown, contactability: { ...cat(2), max: 10 } } }), { threshold: 70 }).ok).toBe(true);
  });

  it("rejects opinionated wording, unsafe URLs and a website that is not a public address", () => {
    expect(checkCandidate(candidate({ summary: "This is a terrible, ugly website." }), { threshold: 70 })).toMatchObject({ ok: false, reason: "opinionated wording" });
    expect(checkCandidate(withBreakdown({ business_fit: { reason: "An amateurish business" } }), { threshold: 70 })).toMatchObject({ ok: false });
    expect(checkCandidate(candidate({ evidence: [{ id: "o1", url: "javascript:alert(1)", title: null, fact: "x", at: "2026-11-06T09:00:00Z" }] }), { threshold: 70 })).toMatchObject({ ok: false, reason: expect.stringContaining("not http") });
    expect(checkCandidate(candidate({ source_urls: ["ftp://x.be/a"] }), { threshold: 70 })).toMatchObject({ ok: false });
    for (const url of ["http://127.0.0.1/", "http://localhost/admin", "http://169.254.169.254/", "http://10.0.0.1/", "file:///etc/passwd", "https://user:pw@x.be/"]) {
      expect(checkCandidate(candidate({ website_url: url }), { threshold: 70 }).ok, url).toBe(false);
    }
    expect(checkCandidate(candidate({ evidence: [candidate().evidence[0], candidate().evidence[0]] }), { threshold: 70 })).toMatchObject({ ok: false, reason: "duplicate evidence ids" });
  });

  it("knows all six categories and the same maximums as the CRM", () => {
    expect(SCORE_CATEGORIES).toHaveLength(6);
    expect(Object.values(SCORE_MAX).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

/** A fake database: answers each function with a prepared value and records what it was asked. */
function fakeRpc(answers: Record<string, unknown> = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args });
    const a = answers[fn];
    if (a instanceof Error) return { data: null, error: { message: a.message } };
    return { data: a ?? { ok: true }, error: null };
  };
  return { rpc, calls };
}
const TOKEN = generateAgentToken();
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const run = (op: Parameters<typeof handleAgentOp>[0], body: unknown, answers?: Record<string, unknown>) => {
  const f = fakeRpc(answers);
  return handleAgentOp(op, TOKEN, typeof body === "string" ? body : JSON.stringify(body), f.rpc).then((r) => ({ ...r, calls: f.calls }));
};

describe("the agent API", () => {
  it("has exactly the six operations a worker needs", () => {
    expect([...AGENT_OPS]).toEqual(["heartbeat", "claim", "context", "progress", "result", "fail"]);
  });

  it("refuses broken or oversized bodies before touching the database", async () => {
    expect(await run("claim", "{not json")).toMatchObject({ status: 400, body: { error: "invalid_json" }, calls: [] });
    expect(await run("claim", "x".repeat(MAX_BODY_BYTES + 1))).toMatchObject({ status: 413, calls: [] });
    expect(await run("progress", { runId: "not-a-uuid", stage: "x", counters: {} })).toMatchObject({ status: 400, calls: [] });
    expect(await run("heartbeat", { codexState: "whatever" })).toMatchObject({ status: 400, calls: [] });
    expect(await run("fail", { runId: RUN_ID, kind: "format_c_drive" })).toMatchObject({ status: 400, calls: [] });
    expect(await run("progress", { runId: RUN_ID, stage: "x", status: "completed", counters: {} })).toMatchObject({ status: 400 });
  });

  it("passes the token to the database function and maps its answers to 401 and 409", async () => {
    const r = await run("claim", {}, { agent_claim_run: { ok: true, run: null } });
    expect(r.calls[0]).toMatchObject({ fn: "agent_claim_run", args: { p_token: TOKEN, p_lease_seconds: 90 } });
    expect(await run("claim", {}, { agent_claim_run: { ok: false, error: "unauthorized" } })).toMatchObject({ status: 401, body: { ok: false, error: "unauthorized" } });
    expect(await run("progress", { runId: RUN_ID, stage: "x", counters: {} }, { agent_progress: { ok: false, error: "lease_lost" } })).toMatchObject({ status: 409 });
    expect(await run("context", { runId: RUN_ID }, { agent_context: new Error("boom") })).toMatchObject({ status: 400, body: { error: "unavailable" } });
    expect(JSON.stringify(await run("claim", {}, { agent_claim_run: new Error("password authentication failed for user x") }))).not.toContain("password");
  });

  it("heartbeat carries only diagnostics, progress only counters and short text", async () => {
    const hb = await run("heartbeat", { codexVersion: "0.46.1", codexState: "ready", failureKind: null });
    expect(hb.calls[0].args).toEqual({ p_token: TOKEN, p_codex_version: "0.46.1", p_codex_state: "ready", p_failure: null });
    // P10.2: an agent that reports its local business data sends only the whitelisted summary; an older agent sends none
    const bd = await run("heartbeat", { codexVersion: "0.46.1", codexState: "ready", failureKind: null, businessData: { state: "ready", source: "Geofabrik Belgium", dataDate: "2026-11-04T10:00:00.000Z", businesses: 123456, freshness: "fresh", path: "C:\\Users\\x\\secret" } });
    expect(bd.calls[0].args).toEqual({ p_token: TOKEN, p_codex_version: "0.46.1", p_codex_state: "ready", p_failure: null, p_business_data: { state: "ready", source: "Geofabrik Belgium", data_date: "2026-11-04T10:00:00.000Z", businesses: 123456, freshness: "fresh" } });
    expect((await run("heartbeat", { codexVersion: null, codexState: "ready", businessData: { state: "weird" } })).status).toBe(400);
    const pr = await run("progress", { runId: RUN_ID, status: "analyzing", stage: "Analyzing 5 websites…", counters: { raw_found: 12, analyzed: 4 }, errors: ["Garage: website unreachable"] });
    expect(pr.calls[0].args).toMatchObject({ p_run: RUN_ID, p_status: "analyzing", p_counters: { raw_found: 12, analyzed: 4 }, p_errors: ["Garage: website unreachable"] });
  });

  const final = { status: "completed", stage: "1 strong prospect found", counters: { raw_found: 9, analyzed: 6, qualified: 1, duplicates_removed: 1, skipped_cooldown: 0 }, errors: [], codexMs: 90_000, codexCalls: 2 };

  it("result: re-validates every candidate against the run's OWN threshold, stores only the accepted ones and says how many were rejected", async () => {
    const bad = candidate({ score: 99 });
    const r = await run(
      "result",
      { runId: RUN_ID, candidates: [candidate(), bad, "garbage"], duplicates: [], seen: [{ domain: "x.be", outcome: "candidate", score: 82 }], final },
      { agent_run_params: { ok: true, threshold: 70 }, agent_submit: { ok: true, inserted: 1, skipped_known: 0 } },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, inserted: 1, rejected: 2 });
    const submit = r.calls.find((c) => c.fn === "agent_submit")!;
    expect((submit.args.p_candidates as unknown[]).length).toBe(1);
    expect((submit.args.p_final as { errors: string[] }).errors.join(" ")).toMatch(/2 candidates rejected by the server/);
  });

  it("result: the threshold comes from the run, not from the worker, and a lost lease stops everything", async () => {
    const r = await run("result", { runId: RUN_ID, candidates: [candidate()], final, minimum: 0, threshold: 0 }, { agent_run_params: { ok: true, threshold: 95 }, agent_submit: { ok: true, inserted: 0, skipped_known: 0 } });
    expect(r.body).toMatchObject({ rejected: 1 });
    const lost = await run("result", { runId: RUN_ID, candidates: [candidate()], final }, { agent_run_params: { ok: false, error: "lease_lost" } });
    expect(lost.status).toBe(409);
    expect(lost.calls.some((c) => c.fn === "agent_submit")).toBe(false);
  });

  it("result: refuses more than 50 candidates and an unknown final status", async () => {
    expect(await run("result", { runId: RUN_ID, candidates: Array.from({ length: 51 }, () => candidate()), final })).toMatchObject({ status: 400 });
    expect(await run("result", { runId: RUN_ID, candidates: [], final: { ...final, status: "failed" } })).toMatchObject({ status: 400 });
  });

  it("fail: only a fixed set of kinds, with the person-facing words kept on the CRM side", async () => {
    const r = await run("fail", { runId: RUN_ID, kind: "codex_usage_limit", message: "limit" });
    expect(r.calls[0]).toMatchObject({ fn: "agent_fail", args: { p_kind: "codex_usage_limit", p_status: "failed" } });
    expect(failureMessage("codex_usage_limit")).toBe("Your current Codex/ChatGPT usage limit has been reached. Try again when your allowance resets.");
    expect(failureMessage("rm -rf")).toBeNull();
    expect(failureMessage(null)).toBeNull();
  });
});

describe("rate limiting", () => {
  it(`stops a token after ${RATE_LIMIT.perMinute} requests a minute, per token, and recovers`, () => {
    const t1 = generateAgentToken();
    const t2 = generateAgentToken();
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMIT.perMinute; i++) expect(rateLimited(t1, now + i)).toBe(false);
    expect(rateLimited(t1, now + 500)).toBe(true);
    expect(rateLimited(t2, now + 500)).toBe(false);
    expect(rateLimited(t1, now + 61_000)).toBe(false);
  });
});

describe("the route", () => {
  it("answers 401 without a valid bearer token, 404 for an unknown operation and 405 for GET, before anything else", async () => {
    const { POST, GET } = await import("@/app/api/prospect-agent/[op]/route");
    const ctx = (op: string) => ({ params: Promise.resolve({ op }) });
    const post = (op: string, headers: Record<string, string> = {}) => POST(new Request(`https://x.test/api/prospect-agent/${op}`, { method: "POST", headers, body: "{}" }), ctx(op));
    expect((await post("claim")).status).toBe(401);
    expect((await post("claim", { authorization: "Bearer nope" })).status).toBe(401);
    expect((await post("format", { authorization: `Bearer ${generateAgentToken()}` })).status).toBe(404);
    expect((await GET()).status).toBe(405);
    const unauth = await post("claim");
    expect(unauth.headers.get("cache-control")).toBe("no-store");
  });
});
