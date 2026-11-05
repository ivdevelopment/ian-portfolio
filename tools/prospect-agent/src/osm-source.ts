import type { BusinessSource } from "../../../src/lib/prospecting/providers/types";
import type { DiscoveryRequest, RawBusiness } from "../../../src/lib/prospecting/types";

/**
 * Public business discovery from OpenStreetMap, which publishes structured business data (name, website, phone, email) under the ODbL licence.
 * Two polite requests per search: one geocoding lookup (Nominatim) and one query (Overpass), each with an identifying User-Agent.
 * Only businesses with a name are used, chains with a brand tag are skipped, and only tags a business chose to publish are read.
 *
 * Coverage depends on what mapping volunteers have added, so it is a starting list, not a directory. It is the P10.1 discovery source because
 * it is public, legal to query and needs no key; a search-engine or directory adapter can be added behind the same interface later.
 */
const UA = "IanProspectAgent/1.0 (+https://ianverlinden.com)";
export const NOMINATIM = "https://nominatim.openstreetmap.org/search";
export const OVERPASS = "https://overpass-api.de/api/interpreter";
/** The public instances are shared and often at capacity (HTTP 502/504 or a long wait), so a few mirrors are tried with a pause between rounds. */
export const OVERPASS_ENDPOINTS = [OVERPASS, "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
export const DISCOVERY_BUDGET_MS = 180_000;

/** The public business source could not answer in time. Reported to the CRM as the fixed kind `source_error`, never as a Codex problem. */
export class SourceError extends Error {
  override name = "SourceError";
}

type Fetch = typeof fetch;
type Tags = Record<string, string>;
type Element = { type: "node" | "way" | "relation"; id: number; tags?: Tags };

/** industry words (nl/en) -> OSM tag filters. Anything not listed falls back to the general craft/shop/office set. */
const INDUSTRIES: Array<[RegExp, string[]]> = [
  [/car|auto|detail|garage|carrosserie/i, ['["shop"~"^(car_repair|car|car_parts|tyres)$"]', '["craft"="car_painter"]', '["amenity"="car_wash"]']],
  [/bike|bicycle|fiets/i, ['["shop"="bicycle"]']],
  [/bak(ery|ker)/i, ['["shop"~"^(bakery|pastry)$"]']],
  [/roof|dak/i, ['["craft"~"^(roofer|tinsmith)$"]']],
  [/garden|tuin/i, ['["craft"="gardener"]', '["shop"="garden_centre"]']],
  [/plumb|loodgiet|sanitair/i, ['["craft"~"^(plumber|hvac)$"]']],
  [/electri|elektr/i, ['["craft"="electrician"]']],
  [/carpent|schrijnwerk|joiner|timmer/i, ['["craft"~"^(carpenter|joiner)$"]']],
  [/hair|kapper|kapsal/i, ['["shop"="hairdresser"]']],
  [/beauty|schoonheid|nail|nagel/i, ['["shop"~"^(beauty|nails)$"]']],
  [/restaurant|horeca|caf[eé]|bar\b/i, ['["amenity"~"^(restaurant|cafe|bar)$"]']],
  [/paint|schilder/i, ['["craft"="painter"]']],
  [/build|bouw|construct/i, ['["craft"~"^(builder|construction)$"]', '["office"="construction_company"]']],
  [/physio|kine/i, ['["healthcare"="physiotherapist"]']],
];
const GENERAL = ['["craft"]', '["shop"~"^(bicycle|car_repair|hairdresser|beauty|bakery|florist|furniture|interior_decoration|garden_centre|pet|tattoo|optician|jewelry|clothes)$"]', '["office"~"^(company|estate_agent|architect|accountant|lawyer|financial)$"]'];

export function industryFilters(industry: string | null): string[] {
  if (!industry) return GENERAL;
  const hit = INDUSTRIES.find(([re]) => re.test(industry));
  return hit ? hit[1] : GENERAL;
}

/** "Brugge + 30 km" -> 30. Without a distance, the area is treated as a named region. */
export function radiusKm(area: string | null): number | null {
  const m = /(\d{1,3})\s*km/i.exec(area ?? "");
  return m ? Math.min(60, Math.max(2, Number(m[1]))) : null;
}

export function buildQuery(opts: { filters: string[]; around?: { lat: number; lon: number; km: number }; region?: string | null; limit: number }): string {
  const parts = opts.filters.map((f) => (opts.around ? `nwr${f}["name"]["brand"!~"."](around:${Math.round(opts.around.km * 1000)},${opts.around.lat},${opts.around.lon});` : `nwr(area.a)${f}["name"]["brand"!~"."];`));
  const region = (opts.region ?? "").replace(/[^\p{L}\p{N} .'-]/gu, "").slice(0, 80);
  const head = opts.around ? "" : `area["name"="${region}"]["boundary"="administrative"]->.a;`;
  return `[out:json][timeout:50];${head}(${parts.join("")});out tags center ${opts.limit};`;
}

const first = (t: Tags, ...keys: string[]) => keys.map((k) => t[k]).find((v) => v && v.trim());

export function toBusiness(el: Element, fallbackCity: string, region: string | null): RawBusiness | null {
  const t = el.tags ?? {};
  const name = t.name?.trim();
  if (!name) return null;
  let website = first(t, "website", "contact:website", "url") ?? null;
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  const social = [first(t, "contact:facebook", "facebook"), first(t, "contact:instagram", "instagram")].filter((v): v is string => Boolean(v)).map((v) => (/^https?:\/\//i.test(v) ? v : v.includes("instagram") ? `https://www.instagram.com/${v.replace(/^@/, "")}` : `https://www.facebook.com/${v}`));
  const email = first(t, "email", "contact:email")?.split(/[;,]/)[0]?.trim().toLowerCase() ?? null;
  const phone = first(t, "phone", "contact:phone", "contact:mobile")?.split(/[;,]/)[0]?.trim() ?? null;
  const kind = first(t, "craft", "shop", "amenity", "office", "healthcare") ?? null;
  return {
    companyName: name.slice(0, 200),
    websiteUrl: website ? website.slice(0, 500) : null,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    phone: phone ? phone.slice(0, 60) : null,
    city: (t["addr:city"] ?? fallbackCity).slice(0, 120) || null,
    region,
    industry: kind ? kind.replace(/_/g, " ") : null,
    sourceUrls: [`https://www.openstreetmap.org/${el.type}/${el.id}`, ...social].slice(0, 5),
    source: "overpass",
    sourceRef: `${el.type}/${el.id}`,
  };
}

export const CENTERS: Record<string, { lat: number; lon: number }> = { brugge: { lat: 51.2093, lon: 3.2247 } };

/** One polite Nominatim lookup for a search centre (Belgium only). Used only when a place is not in the local data or the cache. */
export async function geocodeNominatim(place: string, fetchImpl: Fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<{ lat: number; lon: number } | null> {
  const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=be&q=${encodeURIComponent(place)}`;
  const res = await fetchImpl(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  await sleep(1100); // Nominatim's usage policy: at most one request per second.
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  const hit = data[0];
  const lat = Number(hit?.lat);
  const lon = Number(hit?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

export class OsmBusinessSource implements BusinessSource {
  readonly id = "openstreetmap";
  constructor(
    private readonly fetchImpl: Fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly endpoints: readonly string[] = OVERPASS_ENDPOINTS,
    private readonly requestMs = 70_000,
    /** Total time allowed for the Overpass query. The default is generous (it is the only source); as a fallback behind the local index it is short. */
    private readonly budgetMs = DISCOVERY_BUDGET_MS,
  ) {}

  private async geocode(place: string): Promise<{ lat: number; lon: number } | null> {
    const known = CENTERS[place.trim().toLowerCase()];
    return known ?? geocodeNominatim(place, this.fetchImpl, this.sleep);
  }

  /** One Overpass query, retried across mirrors with a growing pause. Gives up after the time budget with a SourceError. */
  private async query(query: string): Promise<{ elements?: Element[] }> {
    const started = Date.now();
    let last = "no answer";
    for (let round = 0; round < 2; round++) {
      for (const endpoint of this.endpoints) {
        if (Date.now() - started > this.budgetMs) throw new SourceError(`OpenStreetMap did not answer in time (${last})`);
        try {
          const res = await this.fetchImpl(endpoint, { method: "POST", headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(this.requestMs) });
          if (!res.ok) {
            last = `HTTP ${res.status}`;
            continue;
          }
          const data = (await res.json()) as { elements?: Element[]; remark?: string };
          if ((data.elements ?? []).length === 0 && /runtime error|timed out|out of memory/i.test(data.remark ?? "")) {
            last = "query timed out";
            continue;
          }
          return data;
        } catch {
          last = "no response";
        }
      }
      await this.sleep(5000 * (round + 1));
    }
    throw new SourceError(`OpenStreetMap is busy or unreachable (${last})`);
  }

  async discover(request: DiscoveryRequest): Promise<RawBusiness[]> {
    const filters = industryFilters(request.industry);
    const km = radiusKm(request.area);
    const limit = Math.min(200, Math.max(30, request.count * 12));
    let query: string;
    let region: string | null = null;
    if (km !== null) {
      const center = await this.geocode(request.location);
      if (!center) return [];
      query = buildQuery({ filters, around: { ...center, km }, limit });
    } else {
      region = (request.area ?? request.location).trim();
      query = buildQuery({ filters, region, limit });
    }
    const data = await this.query(query);
    const seen = new Set<string>();
    const out: RawBusiness[] = [];
    for (const el of data.elements ?? []) {
      const b = toBusiness(el, request.location, region ?? "West-Vlaanderen");
      const key = `${b?.companyName.toLowerCase()}|${b?.city?.toLowerCase()}`;
      if (!b || seen.has(key)) continue;
      seen.add(key);
      out.push(b);
    }
    // "No website": businesses without one first; otherwise those WITH a website first, since those can be analysed.
    const withSite = (b: RawBusiness) => Number(Boolean(b.websiteUrl));
    return out.sort((a, b) => (request.mode === "no_website" ? withSite(a) - withSite(b) : withSite(b) - withSite(a)));
  }
}
