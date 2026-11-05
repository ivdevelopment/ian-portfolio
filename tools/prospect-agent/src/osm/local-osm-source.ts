import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { BusinessSource } from "../../../../src/lib/prospecting/providers/types";
import type { DiscoveryRequest, RawBusiness } from "../../../../src/lib/prospecting/types";
import { CENTERS, geocodeNominatim, radiusKm, SourceError } from "../osm-source";
import { agentHome } from "../paths";
import { matchIndustry, type Group, type TagFilter } from "./categories";
import { bandOf, describePool, selectPool } from "./select";
import { businessDataStatus, NOT_INSTALLED_MESSAGE, osmPaths, SETUP_COMMAND } from "./data-manager";
import { findPlace, nearestPlace, normName, openIndex, queryRadius, type PoiRow } from "./index-db";

/**
 * Business discovery from the local OpenStreetMap index (see data-manager.ts). A search is: find the centre of the place (the local place list,
 * a small cache, or one Nominatim lookup for an unknown place), take every indexed business within the radius (deterministic great-circle
 * distance, never decided by an AI), keep the ones that match the industry, rank them with fixed rules and hand the best few dozen to the P10
 * pipeline. Nothing here judges whether a business is a good prospect; that stays in the pipeline.
 *
 * Coverage: OpenStreetMap is volunteer-mapped. It lists many shops, trades and restaurants but not every business, and a business is only found
 * if someone mapped it with a name and a category. It is a starting list, not a directory.
 */
export class BusinessDataMissingError extends SourceError {
  override name = "BusinessDataMissingError";
  constructor() {
    super(`${NOT_INSTALLED_MESSAGE} Run: ${SETUP_COMMAND}`);
  }
}

export const LOCAL_SOURCE = "local_osm";

type Center = { lat: number; lon: number };
type Fetch = typeof fetch;

export type LocalSourceOptions = {
  home?: string;
  /** Per-group weights for "Any industry" (config.json "discoveryPriorities"). */
  priorities?: Partial<Record<Group, number>>;
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type DiscoveryReport = {
  centre: Center | null;
  centreVia: "known" | "cache" | "local_places" | "nominatim" | null;
  radiusKm: number;
  /** Eligible businesses within the radius (independent and not non-commercial). */
  inRadius: number;
  /** Size of the ordered pool handed to the pipeline. */
  returned: number;
  durationMs: number;
  categories: Record<string, number>;
  pool?: ReturnType<typeof describePool>;
  inRange?: { bands: number[]; commercial: Record<string, number>; excludedNonCommercial: number; chainsOrNameless: number };
};

const isIndependent = (r: PoiRow) => r.chain === 0;

export class LocalOsmBusinessSource implements BusinessSource {
  readonly id = LOCAL_SOURCE;
  /** The report of the most recent search (for the dry-run command and the logs). */
  last: DiscoveryReport | null = null;

  constructor(private readonly opts: LocalSourceOptions = {}) {}

  private get home() {
    return this.opts.home ?? agentHome();
  }

  private readCache(): Record<string, Center> {
    try {
      const p = osmPaths(this.home).geocodeCache;
      return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Record<string, Center>) : {};
    } catch {
      return {};
    }
  }

  private async geocode(location: string, db: ReturnType<typeof openIndex>): Promise<{ centre: Center; via: NonNullable<DiscoveryReport["centreVia"]> } | null> {
    const name = location.split(",")[0].trim();
    const key = normName(name);
    if (!key) return null;
    const known = CENTERS[name.toLowerCase()];
    if (known) return { centre: known, via: "known" };
    const cache = this.readCache();
    if (cache[key]) return { centre: cache[key], via: "cache" };
    const place = findPlace(db, name);
    let result: { centre: Center; via: NonNullable<DiscoveryReport["centreVia"]> } | null = place ? { centre: { lat: place.lat, lon: place.lon }, via: "local_places" } : null;
    if (!result) {
      try {
        const c = await geocodeNominatim(name, this.opts.fetchImpl ?? fetch, this.opts.sleep);
        if (c) result = { centre: c, via: "nominatim" };
      } catch {
        /* an unknown place that cannot be looked up is reported as "not found" by the caller */
      }
    }
    if (result) {
      try {
        writeFileSync(osmPaths(this.home).geocodeCache, JSON.stringify({ ...cache, [key]: result.centre }, null, 2), "utf8");
      } catch {
        /* the cache is a convenience */
      }
    }
    return result;
  }

  async discover(request: DiscoveryRequest): Promise<RawBusiness[]> {
    const started = (this.opts.now ?? Date.now)();
    const status = businessDataStatus(this.home);
    if (!status.indexReady) throw new BusinessDataMissingError();
    const paths = osmPaths(this.home);
    const db = openIndex(paths.index);
    try {
      const geo = await this.geocode(request.location, db);
      const km = radiusKm(request.area) ?? 30;
      if (!geo) {
        this.last = { centre: null, centreVia: null, radiusKm: km, inRadius: 0, returned: 0, durationMs: 0, categories: {} };
        return [];
      }
      const rule = matchIndustry(request.industry);
      const filters: TagFilter[] | undefined = rule?.filters;
      let rows = queryRadius(db, { ...geo.centre, radiusKm: km, filters }).filter(isIndependent);
      // An industry with no table entry ("dentists") is matched, still deterministically, against the listing's category words and name.
      const words = (request.industry ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
      if (request.industry?.trim() && !rule) rows = rows.filter((r) => words.some((w) => r.cat_value.replace(/_/g, " ").includes(w) || normName(r.name).includes(normName(w))));

      const limit = Math.min(200, Math.max(30, request.count * 12));
      // Counted for the report only: places that were left out because they are public or non-profit (by OSM tags).
      const everything = queryRadius(db, { ...geo.centre, radiusKm: km, filters, includeNonCommercial: true }).filter(isIndependent);
      const excluded = everything.length - rows.length;
      const picked = selectPool(rows, { radiusKm: km, limit, mode: request.mode, industrySearch: Boolean(request.industry?.trim()), priorities: this.opts.priorities, fallbackCity: request.location.split(",")[0] });
      const stats = describePool(picked, km);
      const rangeBands = [0, 0, 0];
      const rangeCommercial: Record<string, number> = {};
      for (const r of rows) {
        rangeBands[bandOf(r.distanceKm, km)]++;
        rangeCommercial[r.commercial] = (rangeCommercial[r.commercial] ?? 0) + 1;
      }
      this.last = {
        centre: geo.centre,
        centreVia: geo.via,
        radiusKm: km,
        inRadius: rows.length,
        returned: picked.length,
        durationMs: (this.opts.now ?? Date.now)() - started,
        categories: stats.categories,
        pool: stats,
        inRange: { bands: rangeBands, commercial: rangeCommercial, excludedNonCommercial: excluded, chainsOrNameless: 0 },
      };
      return picked.map((r) => toBusiness(r, r.city ? request.location : (nearestPlace(db, r.lat, r.lon) ?? request.location)));
    } finally {
      db.close();
    }
  }
}

const social = (v: string | null, host: string): string | null => {
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return (u.hostname === host || u.hostname.endsWith(`.${host}`)) && !u.username && !u.password ? u.toString().slice(0, 500) : null;
    } catch {
      return null;
    }
  }
  return /^[A-Za-z0-9._-]{2,60}$/.test(v.replace(/^@/, "")) ? `https://www.${host}/${v.replace(/^@/, "")}` : null;
};

/** One index row as a RawBusiness: only the listing's public, business-relevant facts, plus where it came from. */
export function toBusiness(r: PoiRow & { distanceKm: number }, fallbackCity: string): RawBusiness {
  const osmType = r.osm_type === "w" ? "way" : "node";
  const links = [social(r.facebook, "facebook.com"), social(r.instagram, "instagram.com")].filter((v): v is string => Boolean(v));
  return {
    companyName: r.name,
    websiteUrl: r.website,
    email: r.email,
    phone: r.phone,
    city: r.city ?? (fallbackCity.split(",")[0].trim() || null),
    region: null,
    industry: r.cat_value.replace(/_/g, " "),
    sourceUrls: [`https://www.openstreetmap.org/${osmType}/${r.osm_id}`, ...links].slice(0, 5),
    source: LOCAL_SOURCE,
    sourceRef: `${osmType}/${r.osm_id}`,
    distanceKm: Math.round(r.distanceKm * 100) / 100,
    category: `${r.cat_key}=${r.cat_value}`,
  };
}
