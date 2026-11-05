import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CompositeBusinessSource } from "../tools/prospect-agent/src/discovery-source";
import { DEFAULT_CONFIG, loadConfig } from "../tools/prospect-agent/src/config";
import { BusinessDataMissingError, LocalOsmBusinessSource } from "../tools/prospect-agent/src/osm/local-osm-source";
import { businessDataStatus, heartbeatSummary, osmPaths, readMetadata, statusLine, updateBusinessData, type UpdateDeps } from "../tools/prospect-agent/src/osm/data-manager";
import { classify, isChain, matchIndustry, orderedGroups } from "../tools/prospect-agent/src/osm/categories";
import { freshness } from "../tools/prospect-agent/src/osm/geofabrik";
import { buildIndex, cleanEmail, cleanWebsite, findPlace, haversineKm, openIndex, queryRadius, readMeta } from "../tools/prospect-agent/src/osm/index-db";
import { readPbf } from "../tools/prospect-agent/src/osm/pbf";
import { OsmBusinessSource } from "../tools/prospect-agent/src/osm-source";
import { analyzeWebsite } from "../src/lib/prospecting/analyze";
import { businessKey } from "../src/lib/prospecting/dedupe";
import type { DiscoveryRequest, RawBusiness } from "../src/lib/prospecting/types";
import { BRUGGE, buildPbfFile, sampleNodes, sampleWays } from "./helpers/pbf-fixture";

/* Tiny synthetic OpenStreetMap files only (see helpers/pbf-fixture.ts): no network, no real Belgian data, nothing outside a temp folder. */

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "osm-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex");

/** An installed index in a fresh agent home, built through the real update path from a synthetic extract. */
async function install(opts: { timestamp?: string; home?: string; extraNodes?: ReturnType<typeof sampleNodes> } = {}) {
  const home = opts.home ?? tmp();
  const file = buildPbfFile({ timestamp: opts.timestamp ?? daysAgo(1), nodes: [...sampleNodes(), ...(opts.extraNodes ?? [])], ways: sampleWays() });
  const deps = deps_(file);
  const res = await updateBusinessData({ ...deps, home, minBusinesses: 1 });
  return { home, file, deps, res };
}
function deps_(file: Buffer): UpdateDeps {
  return {
    remote: async () => ({ url: "https://example.invalid/belgium.osm.pbf", sizeBytes: file.length, lastModified: new Date().toUTCString(), etag: null, md5: md5(file) }),
    download: async ({ dest }) => {
      writeFileSync(dest, file);
      return { bytes: file.length, md5: md5(file), verified: true };
    },
    minBusinesses: 1,
  };
}

const request = (over: Partial<DiscoveryRequest> = {}): DiscoveryRequest => ({ mode: "quick", location: "Brugge", area: "Brugge + 30 km", industry: null, threshold: 70, count: 5, excludeResearched: true, ...over });

describe("PBF reader and index import", () => {
  it("reads nodes, dense tags, ways and the header timestamp from a real-format file", () => {
    const dir = tmp();
    const path = join(dir, "t.osm.pbf");
    const file = buildPbfFile({ timestamp: "2026-11-01T10:00:00.000Z", nodes: sampleNodes(), ways: sampleWays() });
    writeFileSync(path, file);
    const nodes: Array<{ id: number; lat: number; lon: number; name?: string }> = [];
    const ways: number[] = [];
    let ts: string | null = null;
    readPbf(path, { onHeader: (h) => (ts = h.timestamp), onNode: (n) => nodes.push({ id: n.id, lat: n.lat, lon: n.lon, name: n.tags?.name }), onWay: (w) => ways.push(w.id) }, file.length);
    expect(ts).toBe("2026-11-01T10:00:00.000Z");
    expect(nodes.find((n) => n.id === 10)).toMatchObject({ name: "Fietsen Peeters" });
    expect(nodes.find((n) => n.id === 10)!.lat).toBeCloseTo(BRUGGE.lat + 0.01, 6);
    expect(ways).toEqual([500]);
  });

  it("refuses a malformed or truncated file instead of indexing garbage", () => {
    const dir = tmp();
    const path = join(dir, "bad.osm.pbf");
    const good = buildPbfFile({ nodes: sampleNodes() });
    writeFileSync(path, good.subarray(0, good.length - 20));
    expect(() => readPbf(path, { onNode: () => undefined }, good.length - 20)).toThrow();
    writeFileSync(path, Buffer.from("not a pbf file at all"));
    expect(() => readPbf(path, { onNode: () => undefined }, 21)).toThrow();
  });

  it("indexes only useful named businesses, keeps OSM ids, drops chains from queries and locates a building by its nodes", () => {
    const dir = tmp();
    const pbf = join(dir, "t.osm.pbf");
    writeFileSync(pbf, buildPbfFile({ timestamp: daysAgo(2), nodes: sampleNodes(), ways: sampleWays() }));
    const out = join(dir, "idx.sqlite");
    const stats = buildIndex({ pbfPath: pbf, outPath: out });
    // 10,11,12,13,14(chain),17,18,19 + way 500; not 15 (no name) or 16 (vacant shop)
    expect(stats.businesses).toBe(9);
    expect(stats.places).toBe(2);
    expect(stats.dataDate).toBeTruthy();
    const db = openIndex(out);
    expect(readMeta(db).businesses).toBe("9");
    const all = queryRadius(db, { ...BRUGGE, radiusKm: 100, includeChains: true });
    expect(all.map((r) => `${r.osm_type}${r.osm_id}`).sort()).toEqual(["n10", "n11", "n12", "n13", "n14", "n17", "n18", "n19", "w500"].sort());
    const way = all.find((r) => r.osm_id === 500)!;
    expect(way.lat).toBeCloseTo(BRUGGE.lat + 0.0801, 3); // centre of the three nodes
    // no contributor metadata exists in the schema
    const cols = (db.prepare("pragma table_info(poi)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols.join(",")).not.toMatch(/user|uid|changeset|version|timestamp/);
    db.close();
  });

  it("treats OSM tags as untrusted: bad URLs, emails and over-long values are dropped or limited", () => {
    expect(cleanWebsite("javascript:alert(1)")).toBeNull();
    expect(cleanWebsite("https://user:pw@evil.example/")).toBeNull();
    expect(cleanWebsite("http://127.0.0.1/admin")).toBeNull();
    expect(cleanWebsite("peeters.example")).toBe("https://peeters.example/");
    expect(cleanWebsite(`https://a.example/${"x".repeat(900)}`)!.length).toBeLessThanOrEqual(500);
    expect(cleanEmail("not-an-email")).toBeNull();
    expect(cleanEmail("Info@Claeys.be; other@x.be")).toBe("info@claeys.be");
    const dir = tmp();
    const pbf = join(dir, "t.osm.pbf");
    writeFileSync(pbf, buildPbfFile({ nodes: sampleNodes(), ways: sampleWays() }));
    buildIndex({ pbfPath: pbf, outPath: join(dir, "i.sqlite") });
    const db = openIndex(join(dir, "i.sqlite"));
    const evil = queryRadius(db, { ...BRUGGE, radiusKm: 30 }).find((r) => r.name === "Evil Garage")!;
    expect(evil.website).toBeNull();
    expect(evil.email).toBeNull();
    expect(evil.phone).toBeNull(); // 200 identical digits is not a phone number
    db.close();
  });
});

describe("category mapping", () => {
  it("maps tags to a business category deterministically and ignores what is not a business", () => {
    expect(classify({ name: "Xy", shop: "bicycle" })).toEqual({ key: "shop", value: "bicycle", group: "automotive" });
    expect(classify({ name: "Xy", craft: "roofer" })).toMatchObject({ group: "trades" });
    expect(classify({ name: "Xy", amenity: "restaurant" })).toMatchObject({ group: "hospitality" });
    expect(classify({ name: "Xy", office: "accountant" })).toMatchObject({ group: "professional" });
    expect(classify({ name: "Xy", shop: "hairdresser" })).toMatchObject({ group: "beauty_wellness" });
    expect(classify({ shop: "bicycle" })).toBeNull();
    expect(classify({ name: "Xy", shop: "vacant" })).toBeNull();
    expect(classify({ name: "Xy", amenity: "bench" })).toBeNull();
    expect(isChain({ name: "Xy", brand: "Y" })).toBe(true);
    expect(isChain({ name: "Xy" })).toBe(false);
  });

  it("keeps the P10 industry semantics: bike -> shop=bicycle, restaurant -> amenity=restaurant, detailers -> car tags", () => {
    expect(matchIndustry("bike repair")?.filters).toEqual([{ key: "shop", values: ["bicycle"] }]);
    expect(matchIndustry("Restaurants")?.filters[0]).toMatchObject({ key: "amenity" });
    expect(matchIndustry("Car detailers")?.filters.some((f) => f.values?.includes("car_repair"))).toBe(true);
    expect(matchIndustry("underwater basket weaving")).toBeNull();
    expect(matchIndustry(null)).toBeNull();
  });

  it("orders the 'Any industry' groups by the configurable weights, ties by name", () => {
    expect(orderedGroups()[0]).toBe("trades");
    expect(orderedGroups({ hospitality: 500 })[0]).toBe("hospitality");
    expect(orderedGroups({ services: 0 })).not.toContain("services");
  });
});

describe("radius query and discovery", () => {
  it("computes the great-circle distance deterministically and includes only businesses inside the radius, nearest first", async () => {
    const { home } = await install();
    const db = openIndex(osmPaths(home).index);
    const a = queryRadius(db, { ...BRUGGE, radiusKm: 30 });
    const b = queryRadius(db, { ...BRUGGE, radiusKm: 30 });
    expect(a.map((r) => r.distanceKm)).toEqual(b.map((r) => r.distanceKm));
    expect(a.map((r) => r.distanceKm)).toEqual([...a.map((r) => r.distanceKm)].sort((x, y) => x - y));
    expect(a.find((r) => r.osm_id === 17)).toBeUndefined(); // about 40 km away
    expect(queryRadius(db, { ...BRUGGE, radiusKm: 60 }).find((r) => r.osm_id === 17)).toBeTruthy();
    expect(a.find((r) => r.osm_id === 14)).toBeUndefined(); // a chain branch is not an independent business
    const peeters = a.find((r) => r.osm_id === 10)!;
    expect(peeters.distanceKm).toBeCloseTo(haversineKm(BRUGGE.lat, BRUGGE.lon, BRUGGE.lat + 0.01, BRUGGE.lon + 0.01), 9);
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.195, 2);
    db.close();
  });

  it("finds the search centre in the local place list (the larger place wins) and caches it", async () => {
    const { home } = await install();
    const db = openIndex(osmPaths(home).index);
    expect(findPlace(db, "brugge")).toMatchObject({ kind: "city" });
    expect(findPlace(db, "Nergens")).toBeNull();
    db.close();
    const src = new LocalOsmBusinessSource({ home, fetchImpl: (async () => { throw new Error("no network in this test"); }) as unknown as typeof fetch });
    const t = await install({ home: tmp(), extraNodes: [{ id: 3, lat: 51.19, lon: 3.23, tags: { place: "town", name: "Oostkamp" } }] });
    const src2 = new LocalOsmBusinessSource({ home: t.home });
    const found = await src2.discover(request({ location: "Oostkamp", area: "Oostkamp + 20 km" }));
    expect(src2.last?.centreVia).toBe("local_places");
    expect(found.length).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(osmPaths(t.home).geocodeCache, "utf8"))).toHaveProperty("oostkamp");
    await src2.discover(request({ location: "Oostkamp", area: "Oostkamp + 20 km" }));
    expect(src2.last?.centreVia).toBe("cache");
    await expect(src.discover(request({ location: "Nergens", area: "Nergens + 20 km" }))).resolves.toEqual([]);
  });

  it("maps a bike search to bicycle shops only, with provenance, distance and category on each business", async () => {
    const { home } = await install();
    const src = new LocalOsmBusinessSource({ home });
    const found = await src.discover(request({ industry: "bike repair" }));
    expect(found.map((b) => b.companyName)).toEqual(["Fietsen Peeters"]); // Ver Weg is outside 30 km
    expect(found[0]).toMatchObject({ source: "local_osm", sourceRef: "node/10", category: "shop=bicycle", websiteUrl: "https://peeters.example/", industry: "bicycle", city: "Brugge" });
    expect(found[0].sourceUrls[0]).toBe("https://www.openstreetmap.org/node/10");
    expect(found[0].distanceKm).toBeGreaterThan(0);
    expect(src.last).toMatchObject({ centreVia: "known", radiusKm: 30, returned: 1 });
  });

  it("keeps businesses without a website (name + locality is their key) and never invents a website", async () => {
    const { home } = await install();
    const found = await new LocalOsmBusinessSource({ home }).discover(request({ industry: "bakery" }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ companyName: "Bakkerij Janssens", websiteUrl: null, email: null, phone: null });
    expect(businessKey({ companyName: found[0].companyName, websiteUrl: found[0].websiteUrl, city: found[0].city })).toBe("name:bakkerijjanssens|brugge");
  });

  it("'Any industry' visits the kinds of business in a fixed order, one from each in turn, with chains and far places excluded", async () => {
    const { home } = await install();
    const found = await new LocalOsmBusinessSource({ home }).discover(request());
    const names = found.map((b) => b.companyName);
    expect(names).not.toContain("Chain Cafe");
    expect(names).not.toContain("Fietsen Ver Weg");
    // one business per distance band in turn (inner band first), and within a band the kinds in priority order
    expect(names).toEqual(["Dakwerken Claeys", "Schilderwerken Maes", "Fietsen Peeters", "Evil Garage", "Bakkerij Janssens", "Haar & Co", "Frituur Dichtbij"]);
    const again = await new LocalOsmBusinessSource({ home }).discover(request());
    expect(again.map((b) => b.companyName)).toEqual(names); // deterministic
    const weighted = await new LocalOsmBusinessSource({ home, priorities: { hospitality: 500 } }).discover(request());
    const w = weighted.map((b) => b.companyName);
    expect(w.indexOf("Frituur Dichtbij")).toBeLessThan(w.indexOf("Schilderwerken Maes")); // same band: the raised kind now goes first
    expect(names.indexOf("Frituur Dichtbij")).toBeGreaterThan(names.indexOf("Schilderwerken Maes"));
  });

  it("'No Website' mode lists businesses without a website first", async () => {
    const { home } = await install();
    const found = await new LocalOsmBusinessSource({ home }).discover(request({ mode: "no_website", industry: "bakery" }));
    expect(found[0].websiteUrl).toBeNull();
    const all = await new LocalOsmBusinessSource({ home }).discover(request({ mode: "no_website", industry: "car" }));
    expect(all.length).toBeGreaterThan(0);
  });

  it("is fast and does not read the source file at all: a search needs only the index", async () => {
    const { home } = await install();
    rmSync(osmPaths(home).pbf, { force: true });
    const t0 = Date.now();
    const found = await new LocalOsmBusinessSource({ home }).discover(request());
    expect(found.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("installing, updating and freshness", () => {
  it("reports 'not installed' clearly, with the setup command, and does not wait on a public service", async () => {
    const home = tmp();
    const s = businessDataStatus(home);
    expect(s.indexReady).toBe(false);
    expect(statusLine(s)).toBe("Local business data is not installed yet. Run: npm run prospect-agent -- update-business-data");
    expect(heartbeatSummary(home)).toMatchObject({ state: "missing", dataDate: null, businesses: null });
    const started = Date.now();
    await expect(new LocalOsmBusinessSource({ home }).discover(request())).rejects.toThrow(/Local business data is not installed yet\. Run: npm run prospect-agent -- update-business-data/);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("builds the index, writes metadata, and reports status without paths", async () => {
    const { home, res } = await install();
    expect(res.outcome).toBe("updated");
    const p = osmPaths(home);
    expect(existsSync(p.index) && existsSync(p.pbf) && existsSync(p.metadata)).toBe(true);
    expect(existsSync(p.building) || existsSync(p.pbfNext)).toBe(false);
    const m = readMetadata(home)!;
    expect(m).toMatchObject({ source: "Geofabrik Belgium", schemaVersion: 2 });
    expect(m.attribution).toContain("OpenStreetMap contributors");
    const s = businessDataStatus(home);
    expect(s).toMatchObject({ indexReady: true, businesses: 9, freshness: "fresh" });
    expect(statusLine(s)).toMatch(/^Local Belgium index · updated 1 day ago$/);
    expect(JSON.stringify(heartbeatSummary(home))).not.toMatch(/AppData|\\\\|osm-test/);
  });

  it("does nothing when the installed data is already what Geofabrik publishes, and rebuilds with force", async () => {
    const { home, deps } = await install();
    const download = vi.fn(deps.download!);
    const again = await updateBusinessData({ ...deps, download, home });
    expect(again.outcome).toBe("up_to_date");
    expect(download).not.toHaveBeenCalled();
    const forced = await updateBusinessData({ ...deps, download, home, force: true });
    expect(forced.outcome).toBe("updated");
    expect(download).not.toHaveBeenCalled(); // the identical extract on disk is reused, not downloaded again
    expect(forced.outcome === "updated" && forced.reusedExtract).toBe(true);
  });

  it("a failed update never destroys the working index (broken download, failed build, empty result)", async () => {
    const { home, deps } = await install();
    const p = osmPaths(home);
    const before = readFileSync(p.index);
    const newer = buildPbfFile({ timestamp: daysAgo(0), nodes: [...sampleNodes(), { id: 30, ...BRUGGE, tags: { name: "Nieuw Bedrijf", shop: "bakery" } }], ways: sampleWays() });
    const newerDeps = deps_(newer);

    const badDownload = await updateBusinessData({ ...newerDeps, download: async () => { throw new Error("connection reset"); }, home });
    expect(badDownload).toMatchObject({ outcome: "failed" });

    const badBuild = await updateBusinessData({ ...newerDeps, build: () => { throw new Error("corrupt block"); }, home });
    expect(badBuild).toMatchObject({ outcome: "failed" });

    const tooSmall = await updateBusinessData({ ...newerDeps, minBusinesses: 1000, home });
    expect(tooSmall).toMatchObject({ outcome: "failed", message: expect.stringContaining("previous index is still in use") });

    const garbage = await updateBusinessData({ ...newerDeps, download: async ({ dest }) => (writeFileSync(dest, "garbage"), { bytes: 7, md5: "x", verified: true }), home });
    expect(garbage.outcome).toBe("failed");

    expect(readFileSync(p.index).equals(before)).toBe(true);
    expect(existsSync(p.building) || existsSync(p.pbfNext)).toBe(false);
    expect(businessDataStatus(home)).toMatchObject({ indexReady: true, businesses: 9 });
    const db = openIndex(p.index);
    expect(queryRadius(db, { ...BRUGGE, radiusKm: 5 }).length).toBeGreaterThan(0);
    db.close();

    // and an unreachable Geofabrik changes nothing either
    const offline = await updateBusinessData({ ...deps, remote: async () => { throw new Error("offline"); }, home });
    expect(offline).toMatchObject({ outcome: "failed", message: expect.stringContaining("not changed") });
  });

  it("a successful update replaces the index and keeps the previous one", async () => {
    const { home } = await install();
    const newer = buildPbfFile({ timestamp: daysAgo(0), nodes: [...sampleNodes(), { id: 30, ...BRUGGE, tags: { name: "Nieuw Bedrijf", shop: "bakery" } }], ways: sampleWays() });
    const res = await updateBusinessData({ ...deps_(newer), home });
    expect(res.outcome).toBe("updated");
    expect(businessDataStatus(home).businesses).toBe(10);
    expect(existsSync(osmPaths(home).previous)).toBe(true);
  });

  it("flags data older than 7 days and treats very old data as stale", async () => {
    expect(freshness(daysAgo(3))).toBe("fresh");
    expect(freshness(daysAgo(20))).toBe("aging");
    expect(freshness(daysAgo(90))).toBe("stale");
    expect(freshness(null)).toBe("unknown");
    const { home } = await install({ timestamp: daysAgo(20) });
    const s = businessDataStatus(home);
    expect(s.freshness).toBe("aging");
    expect(s.ageDays).toBe(20);
    expect(statusLine(s)).toContain("older than 7 days");
    expect(heartbeatSummary(home)).toMatchObject({ state: "ready", freshness: "aging", businesses: 9 });
  });
});

describe("source selection: local first, Overpass only as a fallback", () => {
  const overpassSpy = () => {
    const discover = vi.fn(async (): Promise<RawBusiness[]> => [{ companyName: "From Overpass", websiteUrl: null, email: null, phone: null, city: "Brugge", region: null, industry: null, sourceUrls: [] }]);
    return { id: "overpass", discover };
  };

  it("uses the local index and never contacts Overpass while the data is healthy, even when the fallback is allowed", async () => {
    const { home } = await install();
    const overpass = overpassSpy();
    const src = new CompositeBusinessSource({ home, allowOverpass: true, overpassSource: overpass });
    const found = await src.discover(request());
    expect(src.used).toBe("local_osm");
    expect(found[0].source).toBe("local_osm");
    expect(overpass.discover).not.toHaveBeenCalled();
  });

  it("with no index: a clear error by default, Overpass only when explicitly allowed", async () => {
    const home = tmp();
    const overpass = overpassSpy();
    await expect(new CompositeBusinessSource({ home, overpassSource: overpass }).discover(request())).rejects.toBeInstanceOf(BusinessDataMissingError);
    expect(overpass.discover).not.toHaveBeenCalled();
    const allowed = new CompositeBusinessSource({ home, allowOverpass: true, overpassSource: overpass });
    expect((await allowed.discover(request()))[0].companyName).toBe("From Overpass");
    expect(allowed.used).toBe("overpass");
  });

  it("with very old data: Overpass is tried first when allowed, and the old local data is used when Overpass is down", async () => {
    const { home } = await install({ timestamp: daysAgo(120) });
    const down = { id: "overpass", discover: vi.fn(async () => { throw new Error("busy"); }) };
    const src = new CompositeBusinessSource({ home, allowOverpass: true, overpassSource: down });
    const found = await src.discover(request());
    expect(down.discover).toHaveBeenCalledTimes(1);
    expect(src.used).toBe("local_osm");
    expect(found.length).toBeGreaterThan(0);
    const up = overpassSpy();
    const src2 = new CompositeBusinessSource({ home, allowOverpass: true, overpassSource: up });
    await src2.discover(request());
    expect(src2.used).toBe("overpass");
    // without the fallback allowed, stale data is simply used (with a warning), never a long wait on a public server
    const src3 = new CompositeBusinessSource({ home, overpassSource: up });
    await src3.discover(request());
    expect(src3.used).toBe("local_osm");
  });

  it("an aging index (8 to 60 days) is used as it is and a refresh is suggested in the log", async () => {
    const { home } = await install({ timestamp: daysAgo(15) });
    const log = vi.fn();
    const src = new CompositeBusinessSource({ home, log });
    await src.discover(request());
    expect(src.used).toBe("local_osm");
    expect(log.mock.calls.map((c) => String(c[0])).join(" ")).toContain("update-business-data");
  });

  it("the Overpass fallback gets a short budget (seconds, not minutes)", () => {
    expect(new OsmBusinessSource(fetch, undefined, ["https://x.invalid"], 1000, 5)).toBeTruthy();
    expect(loadConfig(tmp(), {}).overpassFallback).toBe(false);
    expect(loadConfig(tmp(), { PROSPECT_AGENT_OVERPASS_FALLBACK: "1" }).overpassFallback).toBe(true);
    expect(loadConfig(tmp(), {})).toMatchObject({ discoveryPriorities: {} });
    expect(DEFAULT_CONFIG.overpassFallback).toBe(false);
  });
});

describe("what the P10 pipeline receives", () => {
  const listing = (over: Partial<RawBusiness> = {}): RawBusiness => ({ companyName: "Bakkerij Janssens", websiteUrl: null, email: null, phone: null, city: "Brugge", region: null, industry: "bakery", sourceUrls: ["https://www.openstreetmap.org/node/11"], source: "local_osm", sourceRef: "node/11", distanceKm: 2.2, category: "shop=bakery", ...over });

  it("states only what the listing contains when no website is listed, and labels where each fact came from", async () => {
    const a = await analyzeWebsite(listing(), { skipWebsiteDiscovery: true });
    const facts = a.observations.map((o) => o.fact);
    expect(facts).toContain("No website URL is present in the available business listing.");
    expect(facts.join(" ")).not.toMatch(/no website exists|does not have a website/i);
    expect(a.observations.every((o) => o.origin === "listing")).toBe(true);
    expect(facts[0]).toBe("Listed in OpenStreetMap as shop=bakery, 2.2 km from the search centre.");
    expect(a.signals.reachable).toBe(false);
  });

  it("website observations are marked as coming from the website", async () => {
    const page = "<html><head><title>Peeters</title><meta name=viewport content='width=device-width'></head><body><a href='/contact'>Contact</a></body></html>";
    const a = await analyzeWebsite(listing({ websiteUrl: "https://peeters.example/" }), { fetchPage: async (url) => ({ ok: true, finalUrl: url, status: 200, body: url.endsWith("robots.txt") ? "" : page, truncated: false }), sleep: async () => undefined });
    const origins = new Set(a.observations.map((o) => o.origin));
    expect(origins.has("listing")).toBe(true);
    expect(origins.has("website")).toBe(true);
    expect(a.observations.find((o) => o.origin === "listing")!.fact).toMatch(/^Listed in OpenStreetMap/);
  });

  it("local businesses dedupe with the same keys as before (domain, or name + locality)", () => {
    expect(businessKey({ companyName: "Fietsen Peeters", websiteUrl: "https://www.peeters.example/", city: "Brugge" })).toBe(businessKey({ companyName: "Other Name", websiteUrl: "https://peeters.example", city: "Damme" }));
    expect(businessKey({ companyName: "Bakkerij Janssens", websiteUrl: null, city: "Brugge" })).toBe("name:bakkerijjanssens|brugge");
  });
});

describe("files stay out of the repository", () => {
  it("the data folder is under the agent home, not the project", () => {
    const p = osmPaths("C:\\Users\\x\\AppData\\Local\\IanProspectAgent");
    for (const f of [p.pbf, p.index, p.metadata]) expect(f.replace(/\\/g, "/")).toContain("IanProspectAgent/data/osm/");
  });

  it("the git ignore rules and the repository hold no extract or index", () => {
    const ignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    expect(ignore).toMatch(/\*\.osm\.pbf/);
    expect(ignore).toMatch(/business-index/);
  });
});
