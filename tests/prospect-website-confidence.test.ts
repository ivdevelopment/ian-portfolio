import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkCandidate } from "../src/lib/prospecting/agent/validate";
import { analyzeWebsite, discoverWebsite } from "../src/lib/prospecting/analyze";
import type { FetchResult } from "../src/lib/prospecting/public-fetch";
import { runPipeline, type PipelineStore } from "../src/lib/prospecting/pipeline";
import { buildBreakdown, qualify, totalScore } from "../src/lib/prospecting/scoring";
import { SCORE_CATEGORIES, SCORE_MAX, type AnalyzedBusiness, type ProviderAssessment, type RawBusiness } from "../src/lib/prospecting/types";
import {
  CONVERSION_GAP_CAP, WEBSITE_NEED_CAP, applyWebsiteCaps, corroborate, domainCandidates, identityConfidence, nameCategoryConflict, nameTokens, ownDomainOfEmail, verdictOf, websiteStateFact, websiteStateLabel,
} from "../src/lib/prospecting/website-state";

const biz = (over: Partial<RawBusiness> = {}): RawBusiness => ({ companyName: "Cloetens", websiteUrl: null, email: "cloetens.bvba@skynet.be", phone: "+32 50 42 62 20", city: "Lissewege", region: null, industry: "carpenter", sourceUrls: ["https://www.openstreetmap.org/node/7566199183"], source: "local_osm", sourceRef: "node/7566199183", category: "craft=carpenter", distanceKm: 11.1, ...over });

const html = (title: string, body: string) => `<html><head><title>${title}</title><meta name="viewport" content="width=device-width"></head><body>${body}</body></html>`;
const ok = (url: string, body: string): FetchResult => ({ ok: true, finalUrl: url, status: 200, body, truncated: false });
const dead: FetchResult = { ok: false, reason: "network" };

/** A scripted web: anything not listed does not exist. */
const web = (pages: Record<string, string>, calls: string[] = []) => async (url: string): Promise<FetchResult> => {
  calls.push(url);
  if (url.endsWith("/robots.txt")) return pages[url] !== undefined ? ok(url, pages[url]) : { ok: false, reason: "status", status: 404 };
  return pages[url] !== undefined ? ok(url, pages[url]) : dead;
};

describe("names and address probes", () => {
  it("keeps the words that identify a business and drops legal forms and filler", () => {
    expect(nameTokens("Cloetens BVBA")).toEqual(["cloetens"]);
    expect(nameTokens("De Brugse Databank")).toEqual(["brugse", "databank"]);
    expect(nameTokens("Café Français & Zonen")).toEqual(["cafe", "francais", "zonen"]);
  });

  it("derives a few conservative probe addresses, the listing's own email domain first, never a mailbox provider's", () => {
    expect(domainCandidates({ companyName: "Cloetens", email: "cloetens.bvba@skynet.be" })).toEqual(["cloetens.be", "cloetens.com", "cloetensbv.be", "cloetensbvba.be"]);
    expect(domainCandidates({ companyName: "Clicteur", email: "info@clicteur.be" })).toEqual(["clicteur.be", "clicteur.com", "clicteurbv.be", "clicteurbvba.be"]);
    expect(domainCandidates({ companyName: "WanT Logies", email: "want.reservatie@gmail.com" })).toEqual(["wantlogies.be", "wantlogies.com", "want-logies.be"]);
    expect(ownDomainOfEmail("croesalain@gmail.com")).toBeNull();
    expect(ownDomainOfEmail("Info@Kapper.BE")).toBe("kapper.be");
  });

  it("also probes the name the business uses on its own social page, ignoring generic social paths", () => {
    const c = domainCandidates({ companyName: "WanT Logies", email: "want.reservatie@gmail.com", sourceUrls: ["https://www.openstreetmap.org/node/1", "https://www.facebook.com/WanToStay/", "https://www.facebook.com/Keramiek-Anne-Perneel-260105297725278", "https://www.facebook.com/pages/x", "https://www.instagram.com/p/abc"] });
    expect(c).toEqual(["wantlogies.be", "wantlogies.com", "want-logies.be", "wantostay.be", "wantostay.com", "keramiekanneperneel.be", "keramiekanneperneel.com"]);
  });

  it("makes no guess from generic or very short names", () => {
    expect(domainCandidates({ companyName: "Garage", email: null })).toEqual([]);
    expect(domainCandidates({ companyName: "New Cars", email: null })).toEqual([]);
    expect(domainCandidates({ companyName: "Bar", email: null })).toEqual([]);
    expect(domainCandidates({ companyName: "AB", email: null })).toEqual([]);
  });
});

describe("corroboration: a resolving domain is never enough", () => {
  const b = { companyName: "Clicteur", phone: "+32 50 31 41 63", email: "info@clicteur.be", city: "Brugge" };

  it("confirmed: the name plus the phone number, or the name plus the domain of the listing's own email", () => {
    const withPhone = corroborate({ ...b, email: null }, "clicteur.be", { title: "Clicteur", text: "Autoherstelling. Bel ons: 050 31 41 63" });
    expect(verdictOf(withPhone)).toBe("confirmed_website");
    const withEmail = corroborate(b, "www.clicteur.be", { title: "Clicteur - garage", text: "Welkom bij Clicteur" });
    expect(withEmail).toMatchObject({ name: true, email: true });
    expect(verdictOf(withEmail)).toBe("confirmed_website");
  });

  it("probable: the name plus the locality only", () => {
    const c = corroborate({ ...b, email: null, phone: null }, "clicteur.com", { title: "Clicteur", text: "Onze garage in Brugge aan de Sint-Pieterskaai" });
    expect(verdictOf(c)).toBe("probable_website");
  });

  it("no match: a page without the name, a name alone, or a namesake in another place", () => {
    expect(verdictOf(corroborate(b, "clicteur.be", { title: "Domain parked", text: "This domain is for sale" }))).toBeNull();
    expect(verdictOf(corroborate({ ...b, email: null, phone: null }, "clicteur.com", { title: "Clicteur", text: "Clicteur is a software company in Texas" }))).toBeNull();
    expect(verdictOf(corroborate({ ...b, email: null, phone: null }, "cloetens.be", { title: "Cloeten", text: "Brugge" }))).toBeNull(); // no fuzzy matching
    expect(verdictOf(corroborate({ ...b, phone: "+32 50 31 41 63", email: null }, "other.be", { title: "Autos", text: "Bel 050 31 41 63" }))).toBeNull(); // phone without the name
  });
});

describe("looking for an official website", () => {
  it("finds and confirms a site when the page carries the business name and the listing's own email domain", async () => {
    const calls: string[] = [];
    const r = await discoverWebsite(biz({ companyName: "Clicteur", email: "info@clicteur.be", phone: "+32 50 31 41 63", city: "Brugge" }), web({ "https://clicteur.be/": html("Clicteur", "Garage Clicteur, Sint-Pieterskaai 48, Brugge") }, calls));
    expect(r).toMatchObject({ state: "confirmed_website", host: "clicteur.be" });
    expect(calls[0]).toBe("https://clicteur.be/robots.txt");
  });

  it("does not accept a domain that resolves to somebody else (the same word, another business)", async () => {
    const r = await discoverWebsite(biz(), web({ "https://cloetens.be/": html("Cloetens Tuinen", "Wij zijn tuinaannemers in Gent. Tel 09 123 45 67."), "https://cloetens.com/": html("Cloetens family", "Genealogy pages") }));
    expect(r.state).toBe("no_website_found"); // four answered probes, none belongs to this business
    expect(r.url).toBeNull();
  });

  it("no_website_found needs at least 3 answered probes; otherwise the state stays unknown", async () => {
    const timeout = async (): Promise<FetchResult> => ({ ok: false, reason: "timeout" });
    expect((await discoverWebsite(biz(), timeout)).state).toBe("unknown");
    expect((await discoverWebsite(biz({ companyName: "Kapper" }), web({}))).state).toBe("unknown"); // nothing to probe
    expect((await discoverWebsite(biz({ companyName: "Zuko", email: null }), web({}))).state).toBe("unknown"); // too short for 3 probes? (zuko = 4 letters: no probes)
    expect((await discoverWebsite(biz(), web({}))).state).toBe("no_website_found");
  });

  it("respects robots.txt: a site that asks not to be read is neither matched nor counted as an answer", async () => {
    const pages = { "https://cloetens.be/robots.txt": "User-agent: *\nDisallow: /", "https://cloetens.be/": html("Cloetens", "Cloetens schrijnwerk Lissewege") };
    const r = await discoverWebsite(biz(), web(pages));
    expect(r.url).toBeNull();
  });

  it("analyses a confirmed site like any other, and records how it was found", async () => {
    const pages = { "https://clicteur.be/": html("Clicteur", "Garage Clicteur in Brugge. Bel 050 31 41 63."), "https://clicteur.be/robots.txt": "" };
    const a = await analyzeWebsite(biz({ companyName: "Clicteur", email: "info@clicteur.be", phone: "+32 50 31 41 63", city: "Brugge" }), { fetchPage: web(pages), sleep: async () => undefined });
    expect(a.websiteState).toBe("confirmed_website");
    expect(a.discoveredUrl).toBe("https://clicteur.be/");
    expect(a.signals.reachable).toBe(true);
    expect(a.observations.find((o) => o.websiteState)?.fact).toBe("A website belonging to this business was confirmed at clicteur.be.");
  });

  it("a probable site is analysed with lower confidence and is not recorded as the business's website", async () => {
    const pages = { "https://cloetens.be/": html("Cloetens", "Schrijnwerk in Lissewege, binnendeuren en brandwerend schrijnwerk."), "https://cloetens.be/robots.txt": "" };
    const a = await analyzeWebsite(biz({ email: "cloetens.bvba@skynet.be", phone: "+32 50 99 99 99" }), { fetchPage: web(pages), sleep: async () => undefined });
    expect(a.websiteState).toBe("probable_website");
    expect(a.discoveredUrl).toBeNull();
    expect(a.signals.reachable).toBe(true);
  });

  it("states what is known without claiming the business has no website", async () => {
    const none = await analyzeWebsite(biz(), { fetchPage: web({}), sleep: async () => undefined });
    expect(none.websiteState).toBe("no_website_found");
    const facts = none.observations.map((o) => o.fact);
    expect(facts).toContain("No website URL is present in the available business listing.");
    expect(facts).toContain("No website URL is present in the OSM listing, and no matching official website was found during the deterministic checks.");
    const unknown = await analyzeWebsite(biz(), { skipWebsiteDiscovery: true });
    expect(unknown.websiteState).toBe("unknown");
    expect(unknown.observations.map((o) => o.fact)).toContain("OSM does not list a website. Website availability remains unconfirmed.");
    for (const f of [...facts, ...unknown.observations.map((o) => o.fact)]) expect(f).not.toMatch(/has no website|does not have a website|no website exists/i);
    expect(websiteStateFact("unknown")).toBe("OSM does not list a website. Website availability remains unconfirmed.");
  });

  it("a website already in the listing is confirmed without any probe", async () => {
    const calls: string[] = [];
    const a = await analyzeWebsite(biz({ websiteUrl: "https://www.anneperneel.com/" }), { fetchPage: web({ "https://www.anneperneel.com/": html("Keramiek", "Keramiek Anne Perneel") }, calls), sleep: async () => undefined });
    expect(a.websiteState).toBe("confirmed_website");
    expect(calls.every((u) => u.includes("anneperneel.com"))).toBe(true);
  });
});

/* ------------------------------------- the caps ------------------------------------- */

const assessment = (over: Partial<Record<string, number>> = {}): ProviderAssessment => ({
  companyName: "Cloetens",
  websiteUrl: null,
  scores: Object.fromEntries(SCORE_CATEGORIES.map((c) => [c, { score: over[c] ?? SCORE_MAX[c], reason: `Reason for ${c}.`, observations: ["o1", "o2"] }])) as ProviderAssessment["scores"],
  summary: "A summary.",
  opportunity: "Service website + quote request flow",
});
const observations = [
  { id: "o1", url: "https://www.openstreetmap.org/node/1", title: null, fact: "Listed in OpenStreetMap as craft=carpenter.", at: "2026-11-05T10:00:00.000Z", origin: "listing" as const },
  { id: "o2", url: "https://www.openstreetmap.org/node/1", title: null, fact: "No website URL is present in the available business listing.", at: "2026-11-05T10:00:00.000Z", origin: "listing" as const },
];
const analysisOf = (state: AnalyzedBusiness["analysis"]["websiteState"], extra: Partial<AnalyzedBusiness["analysis"]> = {}): AnalyzedBusiness["analysis"] => ({ signals: { contactPageFound: false } as never, observations: [...observations, { id: "o3", url: "https://www.openstreetmap.org/node/1", title: null, fact: websiteStateFact(state ?? "unknown"), at: "2026-11-05T10:00:00.000Z", origin: "listing", websiteState: state }], contact: { email: null, phone: null }, note: null, websiteState: state, ...extra });

describe("the website-state caps", () => {
  it("document the exact rule: website need and conversion gap are limited by what is known", () => {
    expect(WEBSITE_NEED_CAP).toEqual({ confirmed_website: 25, probable_website: 15, no_website_found: 18, unknown: 8 });
    expect(CONVERSION_GAP_CAP).toEqual({ confirmed_website: 15, probable_website: 9, no_website_found: 8, unknown: 0 });
  });

  it("an unconfirmed absence cannot score highly, however the AI scored it", () => {
    const b = { ...biz({ websiteUrl: null }), email: "cloetens.bvba@skynet.be" };
    const q = qualify({ business: b, analysis: analysisOf("unknown") }, assessment({ website_need: 23, conversion_gap: 12, business_fit: 25, service_opportunity: 14, local_relevance: 10 }));
    expect(q.breakdown.website_need.score).toBe(8);
    expect(q.breakdown.conversion_gap.score).toBe(0);
    expect(q.breakdown.website_need.reason).toBe("OSM does not list a website. Website availability remains unconfirmed, so this signal is kept small.");
    expect(q.score).toBeLessThan(70);
    expect(q.evidence.some((e) => e.websiteState === "unknown")).toBe(true);
  });

  it("applies per state and recalculates the total", () => {
    const base = buildBreakdown(assessment({ website_need: 23, conversion_gap: 12 }), observations, 8);
    const scoreIn = (s: Parameters<typeof applyWebsiteCaps>[1]) => applyWebsiteCaps(base, s);
    expect(scoreIn("confirmed_website").website_need.score).toBe(23);
    expect(scoreIn("probable_website")).toMatchObject({ website_need: { score: 15 }, conversion_gap: { score: 9 } });
    expect(scoreIn("no_website_found")).toMatchObject({ website_need: { score: 18 }, conversion_gap: { score: 8 } });
    expect(scoreIn("unknown")).toMatchObject({ website_need: { score: 8 }, conversion_gap: { score: 0 } });
    expect(totalScore(scoreIn("confirmed_website"))).toBeGreaterThan(totalScore(scoreIn("no_website_found")));
    expect(totalScore(base)).toBe(totalScore(scoreIn("confirmed_website"))); // the input is not modified
  });

  it("the server enforces the same caps, so an agent cannot get around them", () => {
    const mk = (state: string | null, website: string | null, need: number) => {
      const breakdown = Object.fromEntries(SCORE_CATEGORIES.map((c) => [c, { score: c === "website_need" ? need : c === "contactability" ? 2 : c === "conversion_gap" ? 0 : 5, max: SCORE_MAX[c], reason: "ok", observations: ["o1"] }]));
      const total = Object.values(breakdown).reduce((s, c) => s + (c as { score: number }).score, 0);
      const at = new Date().toISOString();
      return checkCandidate({ company_name: "Cloetens", website_url: website, email: null, phone: null, city: "Lissewege", score: total, score_breakdown: breakdown, summary: "s", opportunity: "o", evidence: [{ id: "o1", url: "https://www.openstreetmap.org/node/1", fact: "f", at, ...(state ? { websiteState: state } : {}) }], source_urls: [] }, { threshold: 10 });
    };
    expect(mk("unknown", null, 23)).toMatchObject({ ok: false, reason: expect.stringContaining("website need exceeds the cap") });
    expect(mk(null, null, 23).ok).toBe(false); // no website and no statement about one: treated as unknown
    expect(mk("unknown", null, 8).ok).toBe(true);
    expect(mk("no_website_found", null, 18).ok).toBe(true);
    expect(mk("no_website_found", null, 19).ok).toBe(false);
    expect(mk("confirmed_website", "https://x.be/", 23).ok).toBe(true);
    expect(mk(null, "https://x.be/", 23).ok).toBe(true);
  });

  it("the card wording", () => {
    expect(websiteStateLabel("confirmed_website")).toBe("Confirmed");
    expect(websiteStateLabel("no_website_found")).toBe("No official website found");
    expect(websiteStateLabel("unknown")).toBe("Not listed / unconfirmed");
    expect(websiteStateLabel(undefined)).toBe("Not listed / unconfirmed");
  });
});

describe("a business with an observable website weakness stays strong (Keramiek Anne Perneel)", () => {
  it("keeps its 77: a listed website is confirmed, so the site analysis decides", () => {
    const perneel = biz({ companyName: "Keramiek Anne Perneel", websiteUrl: "https://www.anneperneel.com/", email: null, phone: "+32 50 82 38 38", category: "craft=pottery", city: "Loppem" });
    const obs = [
      { id: "o1", url: "https://www.openstreetmap.org/node/5844090939", title: null, fact: "Listed in OpenStreetMap as craft=pottery, 6.5 km from the search centre.", at: "2026-11-05T17:41:00.000Z", origin: "listing" as const },
      { id: "o2", url: "https://www.openstreetmap.org/node/5844090939", title: null, fact: "Website URL listed in OpenStreetMap.", at: "2026-11-05T17:41:00.000Z", origin: "listing" as const, websiteState: "confirmed_website" as const },
      { id: "o3", url: "https://www.anneperneel.com/", title: null, fact: "No call-to-action for a quote, booking or enquiry was found on the pages checked (2 pages checked).", at: "2026-11-05T17:41:00.000Z", origin: "website" as const },
      { id: "o4", url: "https://www.anneperneel.com/", title: null, fact: "No projects, gallery or references section was found on the pages checked (2 pages checked).", at: "2026-11-05T17:41:00.000Z", origin: "website" as const },
    ];
    const analysis: AnalyzedBusiness["analysis"] = { signals: { contactPageFound: true, reachable: true } as never, observations: obs, contact: { email: "anne@anneperneel.com", phone: null }, note: null, websiteState: "confirmed_website" };
    const given = { companyName: perneel.companyName, websiteUrl: perneel.websiteUrl, scores: { business_fit: { score: 22, reason: "A pottery business is a plausible fit.", observations: ["o1"] }, website_need: { score: 9, reason: "No gallery was found on the checked pages.", observations: ["o4"] }, conversion_gap: { score: 13, reason: "No enquiry call to action or form was found.", observations: ["o3"] }, service_opportunity: { score: 14, reason: "A gallery and enquiry flow address the gaps.", observations: ["o3", "o4"] }, local_relevance: { score: 9, reason: "Listed 6.5 km from the centre.", observations: ["o1"] }, contactability: { score: 10, reason: "x", observations: [] } }, summary: "s", opportunity: "Gallery + enquiry form and calls to action" } as ProviderAssessment;
    const q = qualify({ business: perneel, analysis }, given);
    expect(q.score).toBe(77);
    expect(q.breakdown.conversion_gap.score).toBe(13);
    expect(q.score).toBeGreaterThanOrEqual(70);
  });
});

/* ----------------------------------- identity ----------------------------------- */

describe("identity confidence", () => {
  it("New-Cars tagged as a bicycle rental is low: the name and the category disagree", () => {
    expect(nameCategoryConflict("New-Cars", "amenity=bicycle_rental")).toMatch(/name suggests cars but the listing category is amenity=bicycle_rental/);
    expect(identityConfidence({ companyName: "New-Cars", email: "croesalain@gmail.com", phone: "+32 50 41 39 33", category: "amenity=bicycle_rental" }, "unknown").confidence).toBe("low");
  });

  it("coherent listings are not flagged, and a confirmed website outweighs a disagreement", () => {
    expect(identityConfidence({ companyName: "WanT Logies", email: null, phone: null, category: "tourism=guest_house" }, "unknown").confidence).toBe("medium");
    expect(identityConfidence({ companyName: "Clicteur", email: "info@clicteur.be", phone: "+32 50 31 41 63", category: "shop=car_repair" }, "unknown").confidence).toBe("high");
    expect(identityConfidence({ companyName: "Garage Pizza", email: null, phone: null, category: "amenity=restaurant" }, "unknown").confidence).toBe("medium");
    expect(identityConfidence({ companyName: "Brugse Bike Rental", email: null, phone: null, category: "shop=rental" }, "unknown").confidence).toBe("medium");
    expect(identityConfidence({ companyName: "New-Cars", email: null, phone: null, category: "amenity=bicycle_rental" }, "confirmed_website").confidence).toBe("medium");
    expect(identityConfidence({ companyName: "Cloetens", email: "cloetens.bvba@skynet.be", phone: "1", category: "craft=carpenter" }, "unknown").confidence).toBe("medium");
  });

  it("the pipeline neither analyses-for-AI nor proposes a low-identity listing", async () => {
    const asked: string[] = [];
    const provider = {
      id: "mock" as const,
      capabilities: async () => ({ id: "mock" as const, available: true, supportsWebSearch: false, synthetic: false, reason: null }),
      qualifyBusinesses: async ({ items }: { items: AnalyzedBusiness[] }) => {
        asked.push(...items.map((i) => i.business.companyName));
        return items.map((i) => ({ companyName: i.business.companyName, websiteUrl: i.business.websiteUrl, scores: {}, summary: "", opportunity: "" }));
      },
    };
    const seen: Array<{ domain: string; outcome: string }> = [];
    const store: PipelineStore = { context: async () => ({ prospects: [], ignored: { domains: new Set(), emails: new Set() }, seen: [] }), progress: async () => undefined, saveCandidates: async () => undefined, markSeen: async (e) => void seen.push(...e) };
    const source = { id: "t", discover: async () => [biz({ companyName: "New-Cars", category: "amenity=bicycle_rental", email: "croesalain@gmail.com" }), biz({ companyName: "Clicteur", category: "shop=car_repair", email: "info@clicteur.be" })] };
    const outcome = await runPipeline({ mode: "quick", location: "Brugge", area: null, industry: null, threshold: 70, count: 5, excludeResearched: true }, { provider: provider as never, source, store, analyzeDeps: { skipWebsiteDiscovery: true } });
    expect(asked).toEqual(["Clicteur"]);
    expect(outcome.errors.join(" ")).toMatch(/New-Cars: skipped \(Name and category do not agree/);
    expect(seen.find((s) => s.domain.includes("new"))?.outcome).toBe("skipped");
  });
});
