import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { commercialClass, classify, isGovernmentHost, type Commercial } from "../tools/prospect-agent/src/osm/categories";
import { buildIndex, openIndex, queryRadius, type PoiRow } from "../tools/prospect-agent/src/osm/index-db";
import { bandOf, bandLabels, describePool, selectPool, type Ranked } from "../tools/prospect-agent/src/osm/select";
import { checkCandidate } from "../src/lib/prospecting/agent/validate";
import { analyzeHtml } from "../src/lib/prospecting/analyze";
import { checkEmail, isPlaceholderEmail, verifiedEmail, verifiedPhone } from "../src/lib/prospecting/contact";
import { businessKey, checkDuplicate } from "../src/lib/prospecting/dedupe";
import { contactabilityPoints, mergeContact } from "../src/lib/prospecting/scoring";
import { SCORE_CATEGORIES, SCORE_MAX } from "../src/lib/prospecting/types";
import { BRUGGE, buildPbfFile } from "./helpers/pbf-fixture";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "quality-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* a file still held open by the OS: harmless in a temp folder */
    }
  }
});

/* ------------------------------ 1. contact extraction ------------------------------ */

describe("placeholder contact details are not contacts", () => {
  it("rejects example, template and builder placeholder addresses (deterministic rules)", () => {
    for (const fake of [
      "gebruiker@domein.com", "user@example.com", "name@example.com", "email@example.com", "test@example.com", "john@doe.com", "example@bakkerij.be",
      "info@example.org", "x@example.net", "info@domain.com", "naam@domein.be", "info@yourdomain.com", "info@yourdomain.be", "contact@yourcompany.nl", "info@uwdomein.be",
      "voornaam.achternaam@bedrijf.be", "yourname@gmail.com", "Gebruiker@Domein.com", "info@site.example", "xxx@xxx.com",
    ]) expect(isPlaceholderEmail(fake), fake).toBe(true);
  });

  it("keeps legitimate and unusual real addresses", () => {
    for (const real of [
      "info@brugesbikerental.be", "mail@brugge-fietsen.be", "test@mytestlab.be", "user.support@acme.be", "gebruikerservice@bakkerij.be", "name.lastname@studio-name.be",
      "jan@example-garage.be", "info@doe-and-sons.com", "contact@mail.com", "a@b.co", "o'brien@pub.ie", "info+quote@garage.be", "boekhouding@domeinnaam.be",
    ]) expect(isPlaceholderEmail(real), real).toBe(false);
    expect(verifiedEmail("Info@Claeys.BE")).toBe("info@claeys.be");
    expect(checkEmail("not an email")).toEqual({ ok: false, reason: "invalid" });
  });

  it("screens obviously fake phone numbers and keeps real ones", () => {
    expect(verifiedPhone("+32 50 61 61 08")).toBe("+32 50 61 61 08");
    expect(verifiedPhone("0475 12 34 56")).toBe("0475 12 34 56");
    for (const fake of ["000000000", "+32 123 456 789", "1111111111", "12345", ""]) expect(verifiedPhone(fake), fake).toBeNull();
  });

  it("the website extractor skips the placeholder and finds the real address on the same page", () => {
    const html = `<html><body><input placeholder="gebruiker@domein.com"><a href="mailto:gebruiker@domein.com">mail</a><p>Mail ons: info@vanbelleghem.be</p><a href="tel:+3250344423">bel</a><a href="tel:00000000">x</a></body></html>`;
    const f = analyzeHtml(html);
    expect(f.emails).toEqual(["info@vanbelleghem.be"]);
    expect(f.phones).toEqual(["+3250344423"]);
    expect(analyzeHtml(`<p>gebruiker@domein.com</p>`).emails).toEqual([]);
  });

  it("a placeholder counts as no verified email: no contactability points and no contact in the candidate", () => {
    const analysis = { signals: {} as never, observations: [], contact: { email: "gebruiker@domein.com", phone: "+3250344423" }, note: null };
    const merged = mergeContact({ email: null, phone: null }, analysis);
    expect(merged).toEqual({ email: null, phone: "+3250344423" });
    expect(contactabilityPoints({ email: "gebruiker@domein.com", phone: null }, false)).toBe(0);
    expect(contactabilityPoints({ email: "info@bakker.be", phone: null }, false)).toBe(6);
    // an OSM-listed placeholder does not shadow a real address found on the website
    expect(mergeContact({ email: "name@example.com", phone: null }, { ...analysis, contact: { email: "info@real.be", phone: null } }).email).toBe("info@real.be");
  });

  it("the server also refuses to store a placeholder: the candidate is kept, without that email", () => {
    const breakdown = Object.fromEntries(SCORE_CATEGORIES.map((c) => [c, { score: c === "contactability" ? 2 : SCORE_MAX[c], max: SCORE_MAX[c], reason: "ok", observations: ["o1"] }]));
    const total = Object.values(breakdown).reduce((s, c) => s + (c as { score: number }).score, 0);
    const verdict = checkCandidate({ company_name: "Van Belleghem", website_url: "https://www.vanbelleghem.law/", email: "gebruiker@domein.com", phone: "000000000", city: "Brugge", score: total, score_breakdown: breakdown, summary: "s", opportunity: "o", evidence: [{ id: "o1", url: "https://www.vanbelleghem.law/", fact: "f", at: new Date().toISOString() }], source_urls: [] }, { threshold: 10 });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.row).toMatchObject({ email: null, phone: null });
  });
});

/* ------------------------------ 4. commercial / non-commercial ------------------------------ */

describe("commercial classification (from OSM tags)", () => {
  const cls = (tags: Record<string, string>): Commercial | "not indexed" => {
    const cat = classify({ name: "Test Place", ...tags });
    return cat ? commercialClass({ name: "Test Place", ...tags }, cat) : "not indexed";
  };

  it("excludes public and non-profit places by tag", () => {
    expect(cls({ amenity: "townhall" })).toBe("non_commercial");
    expect(cls({ amenity: "police" })).toBe("non_commercial");
    expect(cls({ amenity: "fire_station" })).toBe("non_commercial");
    expect(cls({ amenity: "library" })).toBe("non_commercial");
    expect(cls({ amenity: "school" })).toBe("non_commercial");
    expect(cls({ office: "government" })).toBe("non_commercial");
    expect(cls({ leisure: "sports_centre", "operator:type": "public" })).toBe("non_commercial");
    expect(cls({ leisure: "sports_centre", ownership: "municipal" })).toBe("non_commercial");
    expect(cls({ amenity: "clinic", "operator:type": "government" })).toBe("non_commercial");
    expect(cls({ shop: "charity" })).toBe("non_commercial");
  });

  it("keeps commercial businesses, including privately operated schools, gyms and sports facilities", () => {
    expect(cls({ shop: "bicycle" })).toBe("likely_commercial");
    expect(cls({ craft: "roofer" })).toBe("likely_commercial");
    expect(cls({ amenity: "restaurant" })).toBe("likely_commercial");
    expect(cls({ office: "lawyer" })).toBe("likely_commercial");
    expect(cls({ leisure: "fitness_centre" })).toBe("likely_commercial");
    expect(cls({ amenity: "school", "operator:type": "private" })).toBe("commercial");
    expect(cls({ leisure: "sports_centre", "operator:type": "private" })).toBe("commercial");
    expect(cls({ amenity: "clinic", ownership: "private" })).toBe("commercial");
  });

  it("marks a place that could be either as unknown, never decided from its name", () => {
    expect(cls({ leisure: "sports_centre" })).toBe("unknown");
    expect(cls({ amenity: "clinic" })).toBe("unknown");
    expect(cls({ amenity: "music_school" })).toBe("unknown");
    // a name that sounds public changes nothing: the decision uses tags
    expect(classify({ name: "Stadsbad", leisure: "fitness_centre" })).toMatchObject({ value: "fitness_centre" });
    expect(commercialClass({ name: "Gemeentelijke Sporthal", leisure: "sports_centre" }, { key: "leisure", value: "sports_centre", group: "services" })).toBe("unknown");
    expect(commercialClass({ name: "Gemeente Pizza", amenity: "restaurant" }, { key: "amenity", value: "restaurant", group: "hospitality" })).toBe("likely_commercial");
  });

  it("recognises official government web addresses and nothing else", () => {
    expect(isGovernmentHost("www.politie.fgov.be")).toBe(true);
    expect(isGovernmentHost("www.vlaanderen.be")).toBe(true);
    expect(isGovernmentHost("www.belgium.be")).toBe(true);
    expect(isGovernmentHost("example.gov")).toBe(true);
    expect(isGovernmentHost("www.brugge.be")).toBe(false);
    expect(isGovernmentHost("peeters.be")).toBe(false);
  });

  it("the index drops public places from a search by default but still counts them", () => {
    const dir = tmp();
    const at = (dLat: number, dLon: number) => ({ lat: BRUGGE.lat + dLat, lon: BRUGGE.lon + dLon });
    const pbf = join(dir, "q.osm.pbf");
    writeFileSync(pbf, buildPbfFile({
      timestamp: new Date().toISOString(),
      nodes: [
        { id: 1, ...BRUGGE, tags: { place: "city", name: "Brugge" } },
        { id: 10, ...at(0.01, 0), tags: { name: "Stedelijk Zwembad", leisure: "sports_centre", "operator:type": "public" } },
        { id: 11, ...at(0.02, 0), tags: { name: "Stadhuis", amenity: "townhall" } },
        { id: 12, ...at(0.03, 0), tags: { name: "Private Fit", leisure: "fitness_centre", "operator:type": "private" } },
        { id: 13, ...at(0.04, 0), tags: { name: "Sporthal Onbekend", leisure: "sports_centre" } },
        { id: 14, ...at(0.05, 0), tags: { name: "Fietsen Peeters", shop: "bicycle", website: "https://www.politie.fgov.be/x" } }, // a government address: public
        { id: 15, ...at(0.06, 0), tags: { name: "Bakkerij", shop: "bakery", phone: "050 12 34 56" } },
      ],
    }));
    buildIndex({ pbfPath: pbf, outPath: join(dir, "i.sqlite") });
    const db = openIndex(join(dir, "i.sqlite"));
    const shown = queryRadius(db, { ...BRUGGE, radiusKm: 30 }).map((r) => [r.name, r.commercial]);
    expect(shown).toEqual([["Private Fit", "commercial"], ["Sporthal Onbekend", "unknown"], ["Bakkerij", "likely_commercial"]]);
    const all = queryRadius(db, { ...BRUGGE, radiusKm: 30, includeNonCommercial: true });
    expect(all.filter((r) => r.commercial === "non_commercial").map((r) => r.name).sort()).toEqual(["Fietsen Peeters", "Stadhuis", "Stedelijk Zwembad"]);
    db.close();
  });
});

/* ------------------------------ 2, 3, 5, 6. selection of the pool ------------------------------ */

let seq = 0;
/** One synthetic indexed business at `km` from the centre. */
function row(over: Partial<Ranked> & { km: number }): Ranked {
  seq++;
  const { km, ...rest } = over;
  return {
    id: seq, osm_type: "n", osm_id: 1000 + seq, lat: 51.2, lon: 3.2, name: `Business ${seq}`, cat_key: "shop", cat_value: "bakery", grp: "retail", website: "https://x.be/", phone: null, email: null,
    city: "Brugge", postcode: null, street: null, housenumber: null, facebook: null, instagram: null, chain: 0, commercial: "likely_commercial", distanceKm: km, ...rest,
  } as PoiRow & { distanceKm: number };
}

/** A realistic imbalance: most listings are in the centre, in a few heavily mapped categories. */
function brugge(): Ranked[] {
  const rows: Ranked[] = [];
  const cats: Array<[string, string, Ranked["grp"]]> = [["shop", "bicycle", "automotive"], ["amenity", "restaurant", "hospitality"], ["office", "lawyer", "professional"], ["shop", "hairdresser", "beauty_wellness"], ["craft", "plumber", "trades"], ["shop", "bakery", "retail"], ["craft", "roofer", "trades"], ["shop", "tattoo", "beauty_wellness"]];
  for (let i = 0; i < 400; i++) {
    const [cat_key, cat_value, grp] = cats[i % cats.length];
    rows.push(row({ km: 0.1 + (i % 40) * 0.1, cat_key, cat_value, grp, website: i % 3 === 0 ? null : "https://x.be/", phone: i % 2 ? "+3250123456" : null })); // city centre, 0.1-4 km
  }
  for (let i = 0; i < 120; i++) {
    const [cat_key, cat_value, grp] = cats[(i * 3) % cats.length];
    rows.push(row({ km: 6 + (i % 90) / 10, cat_key, cat_value, grp, website: i % 3 === 0 ? null : "https://x.be/", phone: "+3250123456" })); // 6-15 km
  }
  for (let i = 0; i < 80; i++) {
    const [cat_key, cat_value, grp] = cats[(i * 5) % cats.length];
    rows.push(row({ km: 16 + (i % 140) / 10, cat_key, cat_value, grp, website: i % 4 === 0 ? null : "https://x.be/", email: "info@x.be" })); // 16-30 km
  }
  return rows;
}
const opts = { radiusKm: 30, limit: 60, mode: "quick", industrySearch: false } as const;

describe("distance bands and balance", () => {
  it("splits the radius into inner / middle / outer bands (0-5, 5-15, 15-30 km for 30 km)", () => {
    expect(bandLabels(30)).toEqual(["0-5 km", "5-15 km", "15-30 km"]);
    expect([0.1, 5, 5.1, 15, 15.1, 29.9].map((d) => bandOf(d, 30))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(bandLabels(12)).toEqual(["0-2 km", "2-6 km", "6-12 km"]);
  });

  it("a 30 km search covers all three bands, even though nearly everything is mapped in the centre", () => {
    const rows = brugge();
    const inCentre = rows.filter((r) => r.distanceKm <= 5).length / rows.length;
    expect(inCentre).toBeGreaterThan(0.6); // the raw data really is centre-heavy
    const pool = selectPool(rows, opts);
    expect(pool).toHaveLength(60);
    const stats = describePool(pool, 30);
    expect(stats.bands).toEqual([20, 20, 20]);
    expect(stats.distance.max).toBeGreaterThan(20);
    // and the businesses the pipeline looks at FIRST are already spread out (it stops once it has enough candidates)
    const firstFive = describePool(pool.slice(0, 5), 30).bands;
    expect(firstFive.filter((n) => n > 0).length).toBe(3);
  });

  it("is deterministic: the same input gives the same list, whatever order it arrives in", () => {
    const rows = brugge();
    const a = selectPool(rows, opts).map((r) => r.osm_id);
    const b = selectPool([...rows].reverse(), opts).map((r) => r.osm_id);
    const c = selectPool(rows.map((r) => ({ ...r })), opts).map((r) => r.osm_id);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("when a band is thin the others fill the list; nothing is invented", () => {
    const rows = [...Array.from({ length: 50 }, (_, i) => row({ km: 1 + i * 0.05, osm_id: 5000 + i } as never)), ...Array.from({ length: 3 }, (_, i) => row({ km: 20 + i }))];
    const pool = selectPool(rows, { ...opts, limit: 30 });
    expect(pool).toHaveLength(30);
    expect(describePool(pool, 30).bands[2]).toBe(3);
  });

  it("does not penalise a business for being far away: the same listing ranks the same in any band", () => {
    const near = row({ km: 1, cat_value: "plumber", cat_key: "craft", grp: "trades", phone: "+3250123456", email: "a@x.be", name: "Near Plumber" });
    const far = row({ km: 25, cat_value: "plumber", cat_key: "craft", grp: "trades", phone: "+3250123456", email: "a@y.be", name: "Far Plumber" });
    const poor = row({ km: 25, cat_value: "plumber", cat_key: "craft", grp: "trades", website: null, name: "Far Plumber With Nothing" });
    const pool = selectPool([near, far, poor], { ...opts, limit: 30 });
    expect(pool.map((r) => r.name)).toEqual(["Near Plumber", "Far Plumber", "Far Plumber With Nothing"]);
    expect(pool.slice(0, 2).every((r) => r.commercial === "likely_commercial")).toBe(true);
  });

  it("one heavily mapped category cannot fill the list (Any industry)", () => {
    const bikes = Array.from({ length: 120 }, (_, i) => row({ km: 0.2 + i * 0.1, cat_key: "shop", cat_value: "bicycle", grp: "automotive" }));
    const others = [["craft", "plumber", "trades"], ["office", "lawyer", "professional"], ["amenity", "restaurant", "hospitality"], ["shop", "hairdresser", "beauty_wellness"], ["shop", "florist", "retail"], ["craft", "painter", "trades"], ["amenity", "dentist", "health"], ["shop", "bakery", "retail"]]
      .flatMap(([k, v, g]) => Array.from({ length: 12 }, (_, i) => row({ km: 0.5 + i * 2, cat_key: k, cat_value: v, grp: g as Ranked["grp"] })));
    const pool = selectPool([...bikes, ...others], opts);
    const counts = describePool(pool, 30).categories;
    expect(counts["shop=bicycle"]).toBeLessThanOrEqual(7); // 9 kinds share 60 places: the cap rises evenly, never into one category
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(9);
    // the cap is not applied to a search that asks for one industry
    const bikeSearch = selectPool(bikes, { ...opts, industrySearch: true, limit: 30 });
    expect(describePool(bikeSearch, 30).categories["shop=bicycle"]).toBe(30);
    // and a thin area is still filled once the cap has done its work
    expect(selectPool(bikes, { ...opts, limit: 30 })).toHaveLength(30);
  });

  it("unknown (maybe public) places come after commercial ones", () => {
    const unknown = row({ km: 1, cat_key: "leisure", cat_value: "sports_centre", grp: "services", commercial: "unknown", name: "Sports Centre" });
    const shops = Array.from({ length: 4 }, (_, i) => row({ km: 2 + i * 0.5, cat_key: "shop", cat_value: `kind${i}`, grp: "services", name: `Florist ${i}` }));
    expect(selectPool([unknown, ...shops], { ...opts, limit: 30 }).map((r) => r.name).at(-1)).toBe("Sports Centre");
  });

  it("businesses without a listed website stay in the pool, alternating with the ones that have one", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ km: 1 + (i % 4), cat_key: "craft", cat_value: "plumber", grp: "trades", website: i < 30 ? "https://x.be/" : null, phone: "+3250123456" }));
    const pool = selectPool(rows, { ...opts, limit: 20, industrySearch: true });
    expect(pool.filter((r) => !r.website).length).toBeGreaterThanOrEqual(9); // 10 of 20 while they last, instead of being pushed behind 30 websites
    const firstSix = pool.slice(0, 6).map((r) => Boolean(r.website));
    expect(firstSix).toContain(false);
    expect(firstSix).toContain(true);
  });

  it("'No Website' mode lists the businesses without a website first", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ km: 1 + i, website: i % 2 ? "https://x.be/" : null, phone: "+3250123456" }));
    const pool = selectPool(rows, { ...opts, mode: "no_website", limit: 10 });
    expect(pool.slice(0, 5).every((r) => !r.website)).toBe(true);
  });

  it("the same business listed twice is taken once", () => {
    const a = row({ km: 1, name: "Bakkerij Janssens", city: "Brugge" });
    const b = row({ km: 12, name: "Bakkerij  JANSSENS", city: "brugge" });
    expect(selectPool([a, b], { ...opts, limit: 30 })).toHaveLength(1);
  });
});

/* ------------------------------ evidence origins, duplicates and cooldown ------------------------------ */

describe("evidence origins survive the server", () => {
  it("listing, website and ai origins are kept exactly as sent", () => {
    const breakdown = Object.fromEntries(SCORE_CATEGORIES.map((c) => [c, { score: c === "contactability" ? 2 : 10, max: SCORE_MAX[c], reason: "ok", observations: c === "website_need" || c === "conversion_gap" ? ["o2"] : [] }]));
    const total = Object.values(breakdown).reduce((s, c) => s + (c as { score: number }).score, 0);
    const at = new Date().toISOString();
    const evidence = [
      { id: "o1", url: "https://www.openstreetmap.org/node/1", title: null, fact: "Website URL listed in OpenStreetMap.", at, origin: "listing" },
      { id: "o2", url: "https://x.be/", title: null, fact: "No booking link was found on the pages checked (1 page checked).", at, origin: "website" },
      { id: "ai1", url: "https://x.be/", title: "Codex interpretation", fact: "Interpretation: a booking flow appears to be a plausible service opportunity.", at, origin: "ai" },
    ];
    const v = checkCandidate({ company_name: "X", website_url: "https://x.be/", email: "info@x.be", phone: null, city: "Brugge", score: total, score_breakdown: breakdown, summary: "s", opportunity: "o", evidence, source_urls: [] }, { threshold: 10 });
    expect(v.ok).toBe(true);
    if (v.ok) expect((v.row.evidence as Array<{ origin: string }>).map((e) => e.origin)).toEqual(["listing", "website", "ai"]);
    // an unknown origin is refused, so the stored values stay a small fixed set
    const bad = checkCandidate({ company_name: "X", website_url: null, score: total, score_breakdown: breakdown, summary: "s", opportunity: "o", evidence: [{ ...evidence[0], origin: "rumour" }], source_urls: [] }, { threshold: 10 });
    expect(bad.ok).toBe(false);
  });
});

describe("duplicates and the cooldown still apply to the preselected pool", () => {
  it("a pool member that is already a prospect, or recently researched, is dropped by the unchanged P10 rules", () => {
    const ctx = { prospects: [{ id: "p1", company_name: "Bakkerij Janssens", email: null, website_url: null, city: "Brugge" }], ignored: { domains: new Set<string>(), emails: new Set<string>() }, seen: [{ domain: "peeters.be", last_analyzed_at: new Date().toISOString() }], excludeResearched: true, now: new Date() };
    expect(checkDuplicate({ companyName: "Bakkerij Janssens", websiteUrl: null, email: null, city: "Brugge" }, ctx)).toMatchObject({ kind: "duplicate", rule: "company_locality" });
    expect(checkDuplicate({ companyName: "Fietsen Peeters", websiteUrl: "https://www.peeters.be/", email: null, city: "Brugge" }, ctx).kind).toBe("cooldown");
    expect(checkDuplicate({ companyName: "Dakwerken Claeys", websiteUrl: "https://claeys.be/", email: null, city: "Damme" }, ctx).kind).toBe("new");
    expect(businessKey({ companyName: "Bakkerij Janssens", websiteUrl: null, city: "Brugge" })).toBe("name:bakkerijjanssens|brugge");
  });
});
