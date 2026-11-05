vi.mock("server-only", () => ({}));
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { analyzeHtml, analyzeWebsite, pickExtraPages } from "@/lib/prospecting/analyze";
import { getBusinessSource, getProvider, getProviderStatus, mockAllowed, providerFlag } from "@/lib/prospecting/config";
import { COOLDOWN_DAYS, businessKey, checkDuplicate, dropBatchDuplicates, type DedupeContext } from "@/lib/prospecting/dedupe";
import { parseDiscoveryRequest } from "@/lib/prospecting/request";
import { runPipeline, type CandidateInsert, type PipelineStore, type RunCounters, type SeenOutcome } from "@/lib/prospecting/pipeline";
import { fetchPublicPage, validatePublicUrl, type RawResponse, type RequestOnce } from "@/lib/prospecting/public-fetch";
import { MockBusinessSource, MockProvider } from "@/lib/prospecting/providers/mock";
import { ProviderUnavailableError, type ProspectAIProvider } from "@/lib/prospecting/providers/types";
import { isAllowedByRobots } from "@/lib/prospecting/robots";
import { buildBreakdown, contactabilityPoints, isDerogatory, meetsThreshold, qualify, totalScore } from "@/lib/prospecting/scoring";
import { DEFAULT_THRESHOLD, SCORE_MAX, type DiscoveryRequest, type Observation, type ScoreCategory } from "@/lib/prospecting/types";

const obs = (id: string, fact = "fact"): Observation => ({ id, url: "https://x.be/", title: null, fact, at: "2026-11-05T09:00:00.000Z" });
const request = (over: Partial<DiscoveryRequest> = {}): DiscoveryRequest => ({ mode: "redesign", location: "Brugge", area: "Brugge + 30 km", industry: null, threshold: 70, count: 10, excludeResearched: true, ...over });

describe("score", () => {
  it("has six capped categories that add up to 100", () => {
    expect(Object.values(SCORE_MAX).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("caps every category at its maximum and never goes below zero or accepts nonsense", () => {
    const b = buildBreakdown({ scores: { business_fit: { score: 999, reason: "Strong local service business." }, website_need: { score: -5, reason: "x", observations: ["o1"] }, local_relevance: { score: Number.NaN, reason: "Local." } } }, [obs("o1")], 0);
    expect(b.business_fit.score).toBe(25);
    expect(b.website_need.score).toBe(0);
    expect(b.local_relevance.score).toBe(0);
    expect(totalScore(b)).toBeLessThanOrEqual(100);
  });

  it("gives website and conversion points only when an existing observation supports them", () => {
    const evidence = [obs("o1", "No booking link was found.")];
    const supported = buildBreakdown({ scores: { conversion_gap: { score: 10, reason: "No booking route.", observations: ["o1"] }, website_need: { score: 20, reason: "Dated.", observations: ["nope"] } } }, evidence, 0);
    expect(supported.conversion_gap.score).toBe(10);
    expect(supported.conversion_gap.observations).toEqual(["o1"]);
    expect(supported.website_need.score).toBe(0);
    expect(supported.website_need.observations).toEqual([]);
  });

  it("replaces opinionated wording with a neutral reason and does not let it earn full points", () => {
    expect(isDerogatory("This is a terrible, ugly website")).toBe(true);
    expect(isDerogatory("Weak mobile experience and limited conversion flow")).toBe(false);
    const b = buildBreakdown({ scores: { business_fit: { score: 24, reason: "A terrible business with an ugly site" } } }, [], 0);
    expect(b.business_fit.reason).not.toMatch(/terrible|ugly/i);
    expect(b.business_fit.score).toBeLessThan(24);
  });

  it("computes contactability from the facts, not from the provider", () => {
    expect(contactabilityPoints({ email: "info@x.be", phone: "+3250000000" }, true)).toBe(10);
    expect(contactabilityPoints({ email: null, phone: null }, false)).toBe(0);
    const b = buildBreakdown({ scores: { contactability: { score: 10, reason: "Everything found" } } }, [], 0);
    expect(b.contactability.score).toBe(0);
  });

  it("applies the minimum score exactly: 70 passes, 69 does not, and the threshold is per run", () => {
    expect(DEFAULT_THRESHOLD).toBe(70);
    expect(meetsThreshold(70, 70)).toBe(true);
    expect(meetsThreshold(69, 70)).toBe(false);
    expect(meetsThreshold(69, 60)).toBe(true);
    expect(meetsThreshold(0, 0)).toBe(true);
  });

  it("only keeps the evidence a reason actually cites", () => {
    const business = { companyName: "A", websiteUrl: "https://a.be", email: "info@a.be", phone: null, city: "Brugge", region: null, industry: null, sourceUrls: [] };
    const analysis = { signals: {} as never, observations: [obs("o1"), obs("o2")], contact: { email: null, phone: null }, note: null };
    const q = qualify({ business, analysis }, { companyName: "A", websiteUrl: "https://a.be", scores: { website_need: { score: 10, reason: "Dated markup.", observations: ["o2"] } }, summary: "s", opportunity: "o" });
    expect(q.evidence.filter((e) => e.origin !== "ai").map((e) => e.id)).toEqual(["o2"]);
    expect(q.evidence.filter((e) => e.origin === "ai").map((e) => e.fact)).toEqual(["Interpretation: o"]); // the AI's own line, labelled as such
  });
});

describe("duplicates, ignored businesses and the cooldown", () => {
  const prospects = [
    { id: "p1", company_name: "Garage Heyrick", email: "info@garage-heyrick.be", website_url: "https://www.garage-heyrick.be", city: "Brugge" },
    { id: "p2", company_name: "Anna Nails", email: "anna@gmail.com", website_url: null, city: "Gent" },
  ];
  const ctx = (over: Partial<DedupeContext> = {}): DedupeContext => ({ prospects, ignored: { domains: new Set(), emails: new Set() }, seen: [], excludeResearched: true, now: new Date("2026-11-05T12:00:00Z"), ...over });
  const biz = (over = {}) => ({ companyName: "Other", websiteUrl: null as string | null, email: null as string | null, city: null as string | null, ...over });

  it("matches by exact email, case-insensitively", () => {
    expect(checkDuplicate(biz({ email: "INFO@Garage-Heyrick.be" }), ctx())).toMatchObject({ kind: "duplicate", rule: "email", prospectId: "p1" });
  });

  it("matches by normalised website domain (www, scheme, path) and by a prospect's own business email domain", () => {
    expect(checkDuplicate(biz({ websiteUrl: "http://garage-heyrick.be/contact" }), ctx())).toMatchObject({ kind: "duplicate", rule: "domain", prospectId: "p1" });
    expect(checkDuplicate(biz({ websiteUrl: "https://WWW.Garage-Heyrick.be" }), ctx())).toMatchObject({ kind: "duplicate", rule: "domain" });
  });

  it("does not treat a shared mail domain as a company domain", () => {
    expect(checkDuplicate(biz({ websiteUrl: "https://gmail.com" }), ctx()).kind).toBe("new");
  });

  it("matches by company name plus locality, but never by name alone", () => {
    expect(checkDuplicate(biz({ companyName: "Garage Heyrick BV", city: "Brugge" }), ctx())).toMatchObject({ kind: "duplicate", rule: "company_locality" });
    expect(checkDuplicate(biz({ companyName: "Garage Heyrick", city: "Kortrijk" }), ctx()).kind).toBe("new");
    expect(checkDuplicate(biz({ companyName: "Garage Heyrick", city: null }), ctx()).kind).toBe("new");
  });

  it("never rediscovers an ignored business (by domain or email)", () => {
    expect(checkDuplicate(biz({ websiteUrl: "https://ignored.be" }), ctx({ ignored: { domains: new Set(["ignored.be"]), emails: new Set() } })).kind).toBe("ignored");
    expect(checkDuplicate(biz({ email: "x@ignored.be" }), ctx({ ignored: { domains: new Set(), emails: new Set(["x@ignored.be"]) } })).kind).toBe("ignored");
  });

  it(`skips a domain analysed within ${COOLDOWN_DAYS} days, and analyses it again after`, () => {
    const day = 86_400_000;
    const now = new Date("2026-11-05T12:00:00Z");
    const seen = (days: number) => [{ domain: "seen.be", last_analyzed_at: new Date(now.getTime() - days * day).toISOString() }];
    expect(checkDuplicate(biz({ websiteUrl: "https://seen.be" }), ctx({ seen: seen(COOLDOWN_DAYS - 1) })).kind).toBe("cooldown");
    expect(checkDuplicate(biz({ websiteUrl: "https://seen.be" }), ctx({ seen: seen(COOLDOWN_DAYS + 1) })).kind).toBe("new");
    expect(checkDuplicate(biz({ websiteUrl: "https://seen.be" }), ctx({ seen: seen(1), excludeResearched: false })).kind).toBe("new");
  });

  it("remembers a business WITHOUT a website by its name and locality (cooldown, ignored, already waiting)", () => {
    const bakery = biz({ companyName: "Sample Bakery", city: "Damme" });
    const key = businessKey(bakery);
    expect(key).toBe("name:samplebakery|damme");
    expect(businessKey(biz({ companyName: "Sample Bakery", city: null }))).toBe("");
    expect(businessKey(biz({ websiteUrl: "https://www.x.be/a" }))).toBe("x.be");
    const now = new Date("2026-11-05T12:00:00Z");
    expect(checkDuplicate(bakery, ctx({ seen: [{ domain: key, last_analyzed_at: now.toISOString() }] })).kind).toBe("cooldown");
    expect(checkDuplicate(bakery, ctx({ ignored: { domains: new Set([key]), emails: new Set() } })).kind).toBe("ignored");
    expect(checkDuplicate(bakery, ctx({ pending: new Set([key]), excludeResearched: false }))).toMatchObject({ kind: "cooldown", reason: "Already waiting for review" });
    expect(checkDuplicate(biz({ companyName: "Sample Bakery", city: "Gent" }), ctx({ pending: new Set([key]) })).kind).toBe("new");
  });

  it("drops repeats inside one batch, first one wins", () => {
    const { kept, dropped } = dropBatchDuplicates([biz({ companyName: "A", websiteUrl: "https://a.be" }), biz({ companyName: "A2", websiteUrl: "https://www.a.be/x" }), biz({ companyName: "B", email: "b@b.be" }), biz({ companyName: "B2", email: "B@b.be" })]);
    expect(kept.map((k) => k.companyName)).toEqual(["A", "B"]);
    expect(dropped).toBe(2);
  });
});

describe("fetching untrusted websites (SSRF)", () => {
  it("accepts only public http(s) names on standard ports", () => {
    expect(validatePublicUrl("https://garage-heyrick.be/contact").ok).toBe(true);
    expect(validatePublicUrl("http://garage-heyrick.be").ok).toBe(true);
    for (const bad of ["file:///etc/passwd", "ftp://x.be/", "javascript:alert(1)", "gopher://x.be", "http://localhost/", "http://127.0.0.1/", "http://0.0.0.0/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://2130706433/", "http://0x7f000001/", "http://intranet.local/", "http://x.internal/", "http://user:pw@x.be/", "http://x.be:8080/", "https://x.be:22/", "https://nodot/", ""]) {
      expect(validatePublicUrl(bad).ok, bad).toBe(false);
    }
  });

  const body = (text: string): AsyncIterable<Buffer> => (async function* () { yield Buffer.from(text); })();
  const response = (over: Partial<RawResponse> & { text?: string } = {}): RawResponse => ({ status: 200, headers: { "content-type": "text/html" }, body: body(over.text ?? "<html></html>"), ...over });

  it("refuses a redirect into a private network before dialling it", async () => {
    const request = vi.fn<RequestOnce>(async (url) => (url.hostname === "public.be" ? response({ status: 302, headers: { location: "http://127.0.0.1:80/admin" } }) : response()));
    const result = await fetchPublicPage("https://public.be/", { request });
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
    expect(request).toHaveBeenCalledTimes(1);
    for (const target of ["http://169.254.169.254/", "http://localhost/", "http://[::1]/", "file:///etc/passwd", "http://10.1.2.3/"]) {
      const r = vi.fn<RequestOnce>(async () => response({ status: 301, headers: { location: target } }));
      expect((await fetchPublicPage("https://public.be/", { request: r })).ok).toBe(false);
      expect(r).toHaveBeenCalledTimes(1);
    }
  });

  it("limits redirects, size and content type, and reports a blocked address or a timeout instead of throwing", async () => {
    const loop: RequestOnce = async () => response({ status: 302, headers: { location: "https://public.be/again" } });
    expect(await fetchPublicPage("https://public.be/", { request: loop })).toMatchObject({ ok: false, reason: "too_many_redirects" });

    const big: RequestOnce = async () => response({ text: "x".repeat(5000) });
    const capped = await fetchPublicPage("https://public.be/", { request: big, limits: { maxBytes: 1000 } });
    expect(capped).toMatchObject({ ok: true, truncated: true });
    expect(capped.ok && capped.body.length).toBe(1000);

    expect(await fetchPublicPage("https://public.be/", { request: async () => response({ headers: { "content-type": "application/pdf" } }) })).toMatchObject({ ok: false, reason: "not_html" });
    expect(await fetchPublicPage("https://public.be/", { request: async () => { throw Object.assign(new Error("blocked address"), { code: "EBLOCKED" }); } })).toMatchObject({ ok: false, reason: "blocked" });
    expect(await fetchPublicPage("https://public.be/", { request: async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); } })).toMatchObject({ ok: false, reason: "timeout" });
    expect(await fetchPublicPage("https://public.be/", { request: async () => response({ status: 500 }) })).toMatchObject({ ok: false, reason: "status", status: 500 });
  });

  it("follows a normal public redirect (http to https)", async () => {
    const r: RequestOnce = async (url) => (url.protocol === "http:" ? response({ status: 301, headers: { location: "https://public.be/home" } }) : response({ text: "<title>Hi</title>" }));
    expect(await fetchPublicPage("http://public.be/", { request: r })).toMatchObject({ ok: true, finalUrl: "https://public.be/home" });
  });
});

describe("robots.txt", () => {
  it("honours Disallow, Allow, the longest match and our own group", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/open\n\nUser-agent: ProspectFinder\nDisallow: /nope\n";
    expect(isAllowedByRobots(robots, "/private/x")).toBe(true); // our own group applies instead of *
    expect(isAllowedByRobots(robots, "/nope/x")).toBe(false);
    const generic = "User-agent: *\nDisallow: /private\nAllow: /private/open";
    expect(isAllowedByRobots(generic, "/private/x")).toBe(false);
    expect(isAllowedByRobots(generic, "/private/open/y")).toBe(true);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /", "/")).toBe(false);
    expect(isAllowedByRobots("", "/anything")).toBe(true);
  });
});

describe("website analysis", () => {
  const html = (body: string, head = "") => `<html><head><title>Garage</title>${head}</head><body>${body}</body></html>`;

  it("reads plain observable signals", () => {
    const f = analyzeHtml(html('<a href="/contact">Contact</a><a href="https://www.facebook.com/x">fb</a><a href="mailto:Info@Garage.be">mail</a><a href="tel:+32 50 12 34 56">bel</a><footer>© 2018</footer>', '<meta name="viewport" content="width=device-width"><meta name="generator" content="WordPress 6">'));
    expect(f).toMatchObject({ viewport: true, cms: "WordPress 6", copyrightYear: 2018, social: ["facebook.com"], emails: ["info@garage.be"], phones: ["+3250123456"], cta: true });
    expect(analyzeHtml(html("<font>old</font><marquee>x</marquee>")).legacyMarkup).toBe(true);
    expect(analyzeHtml(html('<a href="/offerte">Vraag een offerte aan</a>')).quote).toBe(true);
    expect(analyzeHtml(html('<a href="/x">Reserveer nu</a>')).booking).toBe(true);
  });

  it("picks at most the contact, services and about page of the same site", () => {
    const home = analyzeHtml(html('<a href="/contact">Contact</a><a href="/diensten">Diensten</a><a href="/over-ons">Over ons</a><a href="https://other.be/contact">x</a><a href="/files/a.pdf">pdf</a>'));
    expect(pickExtraPages(home, "https://garage.be/", 3)).toEqual(["https://garage.be/contact", "https://garage.be/diensten", "https://garage.be/over-ons"]);
    expect(pickExtraPages(home, "https://garage.be/", 1)).toHaveLength(1);
  });

  const business = (over = {}) => ({ companyName: "Garage", websiteUrl: "https://garage.be/", email: null, phone: null, city: "Brugge", region: null, industry: null, sourceUrls: ["https://directory.be/garage"], ...over });
  const ok = (body: string) => ({ ok: true as const, finalUrl: "https://garage.be/", status: 200, body, truncated: false });
  const now = () => new Date("2026-11-05T09:00:00Z");

  it("turns a dated site into small, dated, factual observations (absence is phrased as 'not found on the pages checked')", async () => {
    const fetchPage = async (url: string) => (url.endsWith("robots.txt") ? ok("") : ok(html("<font>Welcome</font><footer>© 2016</footer>")));
    const a = await analyzeWebsite(business({ websiteUrl: "http://garage.be/" }), { fetchPage, now, sleep: async () => {} });
    const facts = a.observations.map((o) => o.fact).join(" | ");
    expect(a.signals).toMatchObject({ reachable: true, hasMobileViewport: false, ctaFound: false });
    expect(facts).toMatch(/no mobile viewport/i);
    expect(facts).toMatch(/not found on the pages checked|No call-to-action/i);
    expect(facts).toMatch(/copyright year of 2016/);
    expect(a.observations.every((o) => o.at === "2026-11-05T09:00:00.000Z" && o.url.startsWith("http"))).toBe(true);
    expect(facts).not.toMatch(/terrible|ugly|bad/i);
  });

  it("a failed website does not throw: it becomes an 'unreachable' observation", async () => {
    const fetchPage = async (url: string) => (url.endsWith("robots.txt") ? ({ ok: false, reason: "status", status: 404 } as const) : ({ ok: false, reason: "timeout" } as const));
    const a = await analyzeWebsite(business(), { fetchPage, now, sleep: async () => {} });
    expect(a.signals.reachable).toBe(false);
    expect(a.note).toMatch(/unreachable/);
    expect(a.observations[0].fact).toMatch(/did not respond in time/);
  });

  it("does not analyse a site whose robots.txt asks automated visitors to stay out", async () => {
    const fetchPage = vi.fn(async (url: string) => (url.endsWith("robots.txt") ? ok("User-agent: *\nDisallow: /") : ok("<html></html>")));
    const a = await analyzeWebsite(business(), { fetchPage, now, sleep: async () => {} });
    expect(a.note).toMatch(/robots/);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("a business without a website is recorded as such (social-only when found on a social page)", async () => {
    const a = await analyzeWebsite(business({ websiteUrl: null, sourceUrls: ["https://www.facebook.com/garage"] }), { now });
    expect(a.signals.socialOnly).toBe(true);
    expect(a.observations[0].fact).toMatch(/No website URL is present in the available business listing.*social media page is listed/);
  });

  it("reads at most the homepage plus three more pages", async () => {
    const pages: string[] = [];
    const fetchPage = async (url: string) => {
      pages.push(url);
      return url.endsWith("robots.txt") ? ok("") : ok(html('<a href="/contact">Contact</a><a href="/diensten">Diensten</a><a href="/over-ons">Over ons</a><a href="/team">Team</a>'));
    };
    await analyzeWebsite(business(), { fetchPage, now, sleep: async () => {} });
    expect(pages.filter((p) => !p.endsWith("robots.txt")).length).toBeLessThanOrEqual(4);
  });
});

describe("search request", () => {
  const form = { mode: "redesign", location: "Brugge", area: "Brugge + 30 km", industry: null, count: 10, threshold: 70, excludeResearched: true };
  it("accepts what the form sends, including null and blank optional fields", () => {
    expect(parseDiscoveryRequest(form)).toMatchObject({ ok: true, request: { industry: null, area: "Brugge + 30 km", threshold: 70 } });
    expect(parseDiscoveryRequest({ ...form, area: "", industry: "   " })).toMatchObject({ ok: true, request: { area: null, industry: null } });
    expect(parseDiscoveryRequest({ ...form, area: undefined })).toMatchObject({ ok: true, request: { area: null } });
  });
  it("caps the count at what the mode allows and refuses nonsense", () => {
    expect(parseDiscoveryRequest({ ...form, mode: "quick", count: 50 })).toMatchObject({ ok: true, request: { count: 8 } });
    expect(parseDiscoveryRequest({ ...form, mode: "bogus" }).ok).toBe(false);
    expect(parseDiscoveryRequest({ ...form, threshold: 101 }).ok).toBe(false);
    expect(parseDiscoveryRequest({ ...form, location: " " })).toMatchObject({ ok: false, error: "Enter a location." });
    expect(parseDiscoveryRequest({ ...form, count: 0 }).ok).toBe(false);
  });
  it("an Industry Hunt needs an industry", () => {
    expect(parseDiscoveryRequest({ ...form, mode: "industry" })).toMatchObject({ ok: false, error: "Enter the industry to hunt in." });
    expect(parseDiscoveryRequest({ ...form, mode: "industry", industry: "Car detailers" }).ok).toBe(true);
  });
});

describe("provider flag", () => {
  it("is disabled by default and for anything unknown; never falls back", () => {
    expect(providerFlag({})).toBe("disabled");
    expect(providerFlag({ AI_PROSPECTING_PROVIDER: "openai" })).toBe("disabled");
    expect(providerFlag({ AI_PROSPECTING_PROVIDER: "CHATGPT_PLAN" })).toBe("chatgpt_plan");
    expect(getProvider({})).toBeNull();
    expect(getBusinessSource({})).toBeNull();
    const status = getProviderStatus({});
    expect(status).toMatchObject({ ready: false, flag: "disabled" });
    expect(status.message).toMatch(/not connected yet/);
  });

  it("chatgpt_plan is never ready, says why, and refuses to run", async () => {
    const env = { AI_PROSPECTING_PROVIDER: "chatgpt_plan" };
    expect(getProviderStatus(env)).toMatchObject({ ready: false, flag: "chatgpt_plan" });
    expect(getProviderStatus(env).blocker).toMatch(/OpenAI to approve/);
    const provider = getProvider(env)!;
    expect(await provider.capabilities()).toMatchObject({ available: false });
    await expect(provider.qualifyBusinesses({ request: request(), items: [] })).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("the sample provider never runs in production against a hosted database", () => {
    expect(mockAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(mockAllowed({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" })).toBe(true);
    expect(mockAllowed({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" })).toBe(false);
    const prod = { AI_PROSPECTING_PROVIDER: "mock", NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" };
    expect(getProvider(prod)).toBeNull();
    expect(getBusinessSource(prod)).toBeNull();
    expect(getProviderStatus(prod)).toMatchObject({ ready: false });
  });

  it("no source file of the feature reads an OpenAI API key or calls the API", () => {
    const dir = join(process.cwd(), "src", "lib", "prospecting");
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
    for (const f of files(dir)) {
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/OPENAI_API_KEY|api\.openai\.com\/v1\/(responses|chat)|new OpenAI\(|from "openai"/);
    }
  });
});

describe("pipeline", () => {
  function memoryStore(over: Partial<Awaited<ReturnType<PipelineStore["context"]>>> = {}) {
    const saved: CandidateInsert[] = [];
    const progress: Array<{ stage?: string }> = [];
    const seen: Array<{ domain: string; outcome: SeenOutcome; score: number | null }> = [];
    const counters: Partial<RunCounters> = {};
    const store: PipelineStore = {
      context: async () => ({ prospects: [], ignored: { domains: new Set(), emails: new Set() }, seen: [], ...over }),
      progress: async (p) => void (progress.push(p), Object.assign(counters, p)),
      saveCandidates: async (rows) => void saved.push(...rows),
      markSeen: async (e) => void seen.push(...e),
    };
    return { store, saved, progress, seen, counters };
  }
  const run = (req: DiscoveryRequest, store: PipelineStore, provider: ProspectAIProvider = new MockProvider()) => runPipeline(req, { provider, source: new MockBusinessSource(), store });
  const kept = (rows: CandidateInsert[]) => rows.filter((r): r is Extract<CandidateInsert, { kind: "candidate" }> => r.kind === "candidate");

  it("finds, qualifies and proposes candidates above the threshold, highest evidence first, and never creates anything else", async () => {
    const { store, saved, progress } = memoryStore();
    const outcome = await run(request({ count: 10, threshold: 70 }), store);
    expect(outcome.status).toBe("completed");
    const candidates = kept(saved);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.candidate.score >= 70 && c.candidate.business.synthetic === true)).toBe(true);
    expect(candidates.every((c) => /sample data/.test(c.candidate.business.companyName))).toBe(true);
    expect(candidates.every((c) => c.candidate.evidence.length > 0 || c.candidate.business.websiteUrl === null)).toBe(true);
    expect(progress.map((p) => p.stage).filter(Boolean)).toEqual(expect.arrayContaining(["Finding businesses…", "Checking duplicates…", "Qualifying candidates…"]));
    expect(outcome.stage).toMatch(/strong prospects? found/);
    // The store has no way to create a prospect: this stage only ever writes candidates.
    expect(Object.keys(store).sort()).toEqual(["context", "markSeen", "progress", "saveCandidates"]);
  });

  it("applies the per-run threshold: a higher minimum shows fewer, an impossible one shows none", async () => {
    const lax = memoryStore();
    await run(request({ threshold: 40, count: 20 }), lax.store);
    const strict = memoryStore();
    await run(request({ threshold: 95, count: 20 }), strict.store);
    expect(kept(lax.saved).length).toBeGreaterThan(kept(strict.saved).length);
    expect(kept(strict.saved)).toHaveLength(0);
    expect(strict.seen.some((s) => s.outcome === "below_threshold")).toBe(true);
  });

  it("stops at the requested number of results", async () => {
    const m = memoryStore();
    await run(request({ threshold: 0, count: 2 }), m.store);
    expect(kept(m.saved)).toHaveLength(2);
  });

  it("records a CRM duplicate as 'Already in CRM' and does not propose it", async () => {
    const m = memoryStore({ prospects: [{ id: "p9", company_name: "Existing", email: "info@sample-bike-repair.invalid", website_url: null, city: null }] });
    const outcome = await run(request({ threshold: 0, count: 20 }), m.store);
    expect(m.saved.filter((r) => r.kind === "duplicate")).toMatchObject([{ duplicateOf: "p9" }]);
    expect(kept(m.saved).some((c) => c.candidate.business.email === "info@sample-bike-repair.invalid")).toBe(false);
    expect(outcome.counters.duplicates_removed).toBe(1);
  });

  it("does not analyse an ignored business or one inside the cooldown again", async () => {
    const m = memoryStore({ ignored: { domains: new Set(["sample-car-detailing.invalid"]), emails: new Set() }, seen: [{ domain: "sample-roofing.invalid", last_analyzed_at: new Date().toISOString() }] });
    const outcome = await run(request({ threshold: 0, count: 20 }), m.store);
    const names = kept(m.saved).map((c) => c.candidate.business.companyName);
    expect(names.some((n) => /Car Detailing/.test(n))).toBe(false);
    expect(names.some((n) => /Roofing/.test(n))).toBe(false);
    expect(outcome.counters.skipped_cooldown).toBe(1);
  });

  it("an unreachable or crashing website does not fail the run", async () => {
    const m = memoryStore();
    const analyzed: string[] = [];
    const outcome = await runPipeline(request({ threshold: 0, count: 20 }), {
      provider: new MockProvider(),
      source: new MockBusinessSource(),
      store: m.store,
      analyze: async (b) => {
        analyzed.push(b.companyName);
        if (/Roofing/.test(b.companyName)) throw new Error("boom");
        return (await import("@/lib/prospecting/analyze")).analyzeWebsite(b);
      },
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.errors.some((e) => /Roofing.*analysis skipped/.test(e))).toBe(true);
    expect(outcome.errors.some((e) => /Plumbing.*unreachable/.test(e))).toBe(true);
    expect(kept(m.saved).length).toBeGreaterThan(0);
    expect(m.seen.some((s) => s.outcome === "unreachable")).toBe(true);
  });

  it("an unavailable provider stops the run before any discovery and falls back to nothing", async () => {
    const m = memoryStore();
    const source = { id: "x", discover: vi.fn(async () => []) };
    const provider: ProspectAIProvider = { id: "chatgpt_plan", capabilities: async () => ({ id: "chatgpt_plan", available: false, supportsWebSearch: false, synthetic: false, reason: "not approved" }), qualifyBusinesses: vi.fn() };
    const outcome = await runPipeline(request(), { provider, source, store: m.store });
    expect(outcome).toMatchObject({ status: "failed", stage: "AI provider not available", errors: ["not approved"] });
    expect(source.discover).not.toHaveBeenCalled();
    expect(provider.qualifyBusinesses).not.toHaveBeenCalled();
    expect(m.saved).toHaveLength(0);
  });

  it("keeps what was found when the provider stops halfway (partial run)", async () => {
    const m = memoryStore();
    const mock = new MockProvider();
    let calls = 0;
    const provider: ProspectAIProvider = {
      id: "mock",
      capabilities: () => mock.capabilities(),
      qualifyBusinesses: async (input) => {
        if (++calls > 1) throw new ProviderUnavailableError("The usage limit was reached.", "usage_limit");
        return mock.qualifyBusinesses({ ...input, items: input.items.slice(0, 5) });
      },
    };
    const many = { id: "many", discover: async () => Array.from({ length: 12 }, (_, i) => ({ companyName: `Sample ${i} (sample data)`, websiteUrl: null, email: null, phone: null, city: "Brugge", region: "West-Vlaanderen", industry: "Test", sourceUrls: ["sample://x"], synthetic: true })) };
    const outcome = await runPipeline(request({ threshold: 0, count: 20 }), { provider, source: many, store: m.store });
    expect(outcome.status).toBe("partial");
    expect(outcome.errors).toContain("The usage limit was reached.");
    expect(kept(m.saved).length).toBeGreaterThan(0);
    expect(kept(m.saved).length).toBeLessThan(12);
  });

  it("with no discovery source it says so and finds nothing instead of inventing anything", async () => {
    const m = memoryStore();
    const outcome = await runPipeline(request(), { provider: new MockProvider(), source: null, store: m.store });
    expect(outcome.errors).toEqual(["No discovery source is available for this provider."]);
    expect(m.saved).toHaveLength(0);
  });
});

describe("candidate scoring categories used by the mock", () => {
  it("every candidate carries all six categories with a reason", async () => {
    const m = await (async () => {
      const saved: CandidateInsert[] = [];
      const store: PipelineStore = { context: async () => ({ prospects: [], ignored: { domains: new Set(), emails: new Set() }, seen: [] }), progress: async () => undefined, saveCandidates: async (r) => void saved.push(...r), markSeen: async () => undefined };
      await runPipeline(request({ threshold: 0, count: 20 }), { provider: new MockProvider(), source: new MockBusinessSource(), store });
      return saved;
    })();
    for (const row of m) {
      if (row.kind !== "candidate") continue;
      for (const c of Object.keys(SCORE_MAX) as ScoreCategory[]) expect(row.candidate.breakdown[c].reason.length).toBeGreaterThan(3);
      expect(row.candidate.score).toBe(Object.values(row.candidate.breakdown).reduce((s, v) => s + v.score, 0));
    }
  });
});
