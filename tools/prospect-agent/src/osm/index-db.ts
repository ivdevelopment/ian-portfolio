import { DatabaseSync, type StatementSync } from "node:sqlite";
import { statSync } from "node:fs";
import { PLACE_RANK, WANTED_KEYS, classify, commercialClass, isChain, isGovernmentHost, type Commercial, type Group, type OsmTags, type TagFilter } from "./categories";
import { readPbf } from "./pbf";
import { verifiedEmail, verifiedPhone } from "../../../../src/lib/prospecting/contact";

/**
 * The local business index: a single SQLite file (Node's built-in SQLite, with an R*Tree for radius queries). No database server, no native
 * add-on, no Docker. It holds only what prospecting needs from OpenStreetMap: named businesses (shop, craft, office, hospitality, health...)
 * with their position, public contact tags and the OSM identifier, plus named places so a search centre such as "Brugge" is found locally.
 * Contributor metadata (user, timestamps, changesets) is never read into the index.
 *
 * OSM tags are untrusted external text: every value is cleaned, length-limited and, for URLs and emails, validated before it is stored.
 */
export const SCHEMA_VERSION = 2;

const SCHEMA = `
create table meta (key text primary key, value text not null);
create table poi (
  id integer primary key, osm_type text not null, osm_id integer not null, lat real not null, lon real not null,
  name text not null, cat_key text not null, cat_value text not null, grp text not null,
  website text, phone text, email text, city text, postcode text, street text, housenumber text, facebook text, instagram text,
  chain integer not null default 0,
  commercial text not null default 'likely_commercial'
);
create unique index poi_osm on poi (osm_type, osm_id);
create index poi_grp on poi (grp);
create virtual table poi_rt using rtree (id, min_lat, max_lat, min_lon, max_lon);
create table place (id integer primary key, name text not null, name_norm text not null, kind text not null, rank integer not null, population integer, lat real not null, lon real not null);
create index place_name on place (name_norm, rank);
`;

export const normName = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const clean = (v: string | undefined, max = 200): string | null => {
  const t = (v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** One public http(s) address with a dotted host and no credentials; anything else is dropped. Never executed, only stored and displayed. */
export function cleanWebsite(raw: string | undefined): string | null {
  let t = clean(raw, 600)?.split(/[;,\s]/)[0] ?? "";
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || !u.hostname.includes(".") || /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) return null;
    return u.toString().slice(0, 500);
  } catch {
    return null;
  }
}

/** The first listed address, only when it is a real-looking, non-placeholder email ("no verified email" otherwise). */
export function cleanEmail(raw: string | undefined): string | null {
  return verifiedEmail(clean(raw, 320)?.split(/[;,\s]/)[0]);
}

const firstOf = (t: OsmTags, ...keys: string[]) => keys.map((k) => t[k]).find((v) => v && v.trim());
const validPoint = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/* ----------------------------------- building ----------------------------------- */

export type BuildStats = { businesses: number; places: number; ways: number; seconds: number; indexBytes: number; dataDate: string | null };
export type BuildOptions = { pbfPath: string; outPath: string; log?: (message: string) => void; extraMeta?: Record<string, string>; now?: () => number };

/**
 * Two passes over the extract. Pass 1 reads only the WAYS that are businesses and notes which nodes they use; pass 2 reads the NODES: business
 * and place nodes become rows, and the noted nodes give each way a position (the centre of its nodes). Written into a NEW file; the caller swaps
 * it in only after this returns, so a failure leaves the previous index untouched.
 */
export function buildIndex(opts: BuildOptions): BuildStats {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? Date.now;
  const started = now();
  const size = statSync(opts.pbfPath).size;
  const pass = (n: number) => (done: number, total: number) => log(`pass ${n}/2: ${Math.round((done / total) * 100)}%`);

  let dataDate: string | null = null;
  const ways: Array<{ id: number; refs: number[]; tags: OsmTags }> = [];
  const needed = new Set<number>();
  readPbf(opts.pbfPath, {
    wantKey: (k) => WANTED_KEYS.has(k),
    skipNodes: true,
    onHeader: (h) => (dataDate = h.timestamp),
    onWay: (w) => {
      if (!classify(w.tags) || w.refs.length === 0) return;
      const refs = w.refs.length > 500 ? w.refs.filter((_, i) => i % Math.ceil(w.refs.length / 500) === 0) : w.refs;
      ways.push({ id: w.id, refs, tags: w.tags });
      for (const r of refs) needed.add(r);
    },
    onProgress: pass(1),
  }, size);
  log(`pass 1 done: ${ways.length} business ways, ${needed.size} nodes to locate`);

  const db = new DatabaseSync(opts.outPath);
  db.exec("pragma journal_mode = off; pragma synchronous = off; pragma temp_store = memory;");
  db.exec(SCHEMA);
  const insertPoi = db.prepare("insert or ignore into poi (osm_type, osm_id, lat, lon, name, cat_key, cat_value, grp, website, phone, email, city, postcode, street, housenumber, facebook, instagram, chain, commercial) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertRt = db.prepare("insert or ignore into poi_rt (id, min_lat, max_lat, min_lon, max_lon) values (?,?,?,?,?)");
  const insertPlace = db.prepare("insert into place (name, name_norm, kind, rank, population, lat, lon) values (?,?,?,?,?,?,?)");
  let businesses = 0;
  let places = 0;
  const poi = (type: "n" | "w", id: number, lat: number, lon: number, tags: OsmTags): void => {
    const cat = classify(tags);
    const name = clean(tags.name);
    if (!cat || !name || !validPoint(lat, lon)) return;
    const website = cleanWebsite(firstOf(tags, "website", "contact:website", "url"));
    let commercial = commercialClass(tags, cat);
    // An official government web address marks a place as public even when nobody tagged who operates it (unless explicitly private).
    if (commercial !== "commercial" && commercial !== "non_commercial" && website && isGovernmentHost(new URL(website).hostname)) commercial = "non_commercial";
    const r = insertPoi.run(type, id, lat, lon, name, cat.key, cat.value, cat.group, website, verifiedPhone(clean(firstOf(tags, "phone", "contact:phone", "contact:mobile"), 60)), cleanEmail(firstOf(tags, "email", "contact:email")), clean(tags["addr:city"], 120), clean(tags["addr:postcode"], 20), clean(tags["addr:street"], 120), clean(tags["addr:housenumber"], 20), clean(firstOf(tags, "contact:facebook", "facebook"), 200), clean(firstOf(tags, "contact:instagram", "instagram"), 200), isChain(tags) ? 1 : 0, commercial);
    if (r.changes > 0) {
      insertRt.run(Number(r.lastInsertRowid), lat, lat, lon, lon);
      businesses++;
    }
  };

  // Node coordinates for the ways: two compact arrays and an id -> slot map (only the nodes pass 1 asked for).
  const slot = new Map<number, number>();
  const lats = new Float64Array(needed.size);
  const lons = new Float64Array(needed.size);
  db.exec("begin");
  let sinceCommit = 0;
  readPbf(opts.pbfPath, {
    wantKey: (k) => WANTED_KEYS.has(k),
    onNode: (n) => {
      if (needed.has(n.id) && !slot.has(n.id)) {
        const i = slot.size;
        slot.set(n.id, i);
        lats[i] = n.lat;
        lons[i] = n.lon;
      }
      if (!n.tags) return;
      const kind = n.tags.place;
      const placeName = clean(n.tags.name, 120);
      if (kind && placeName && PLACE_RANK[kind] !== undefined && validPoint(n.lat, n.lon)) {
        const pop = Number(n.tags.population);
        insertPlace.run(placeName, normName(placeName), kind, PLACE_RANK[kind], Number.isFinite(pop) && pop > 0 ? Math.round(pop) : null, n.lat, n.lon);
        places++;
      }
      poi("n", n.id, n.lat, n.lon, n.tags);
      if (++sinceCommit >= 50_000) {
        db.exec("commit; begin");
        sinceCommit = 0;
      }
    },
    onProgress: pass(2),
  }, size);
  let placed = 0;
  for (const w of ways) {
    let la = 0;
    let lo = 0;
    let n = 0;
    for (const ref of w.refs) {
      const i = slot.get(ref);
      if (i !== undefined) {
        la += lats[i];
        lo += lons[i];
        n++;
      }
    }
    if (n > 0) {
      poi("w", w.id, la / n, lo / n, w.tags);
      placed++;
    }
  }
  db.exec("commit");
  log(`pass 2 done: ${businesses} businesses (${placed} of ${ways.length} ways located), ${places} places`);

  const seconds = Math.round((now() - started) / 1000);
  const meta = db.prepare("insert into meta (key, value) values (?, ?)");
  for (const [k, v] of Object.entries({ schema_version: String(SCHEMA_VERSION), built_at: new Date(now()).toISOString(), data_date: dataDate ?? "", businesses: String(businesses), places: String(places), import_seconds: String(seconds), ...opts.extraMeta })) meta.run(k, v);
  db.exec("create index poi_chain on poi (chain)");
  db.exec("analyze");
  db.close();
  return { businesses, places, ways: placed, seconds, indexBytes: statSync(opts.outPath).size, dataDate };
}

/* ------------------------------------ querying ------------------------------------ */

export type PoiRow = {
  id: number; osm_type: string; osm_id: number; lat: number; lon: number; name: string; cat_key: string; cat_value: string; grp: Group;
  website: string | null; phone: string | null; email: string | null; city: string | null; postcode: string | null; street: string | null; housenumber: string | null;
  facebook: string | null; instagram: string | null; chain: number; commercial: Commercial;
};

export function openIndex(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

export function readMeta(db: DatabaseSync): Record<string, string> {
  return Object.fromEntries((db.prepare("select key, value from meta").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
}

const EARTH_KM = 6371.0088;
/** Great-circle distance in km. Deterministic: this, not an AI, decides whether a business is inside the requested radius. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type RadiusQuery = { lat: number; lon: number; radiusKm: number; filters?: TagFilter[]; groups?: Group[]; includeChains?: boolean; /** Public and non-profit places are left out unless asked for (they are never prospects by default). */ includeNonCommercial?: boolean };

/** Every indexed business within `radiusKm` of the centre, nearest first. The R*Tree narrows to a box; the exact distance is computed per row. */
export function queryRadius(db: DatabaseSync, q: RadiusQuery): Array<PoiRow & { distanceKm: number }> {
  const dLat = q.radiusKm / 111.195;
  const dLon = q.radiusKm / (111.195 * Math.max(0.05, Math.cos((q.lat * Math.PI) / 180)));
  const where: string[] = ["r.min_lat >= ?", "r.max_lat <= ?", "r.min_lon >= ?", "r.max_lon <= ?"];
  const params: Array<string | number> = [q.lat - dLat, q.lat + dLat, q.lon - dLon, q.lon + dLon];
  if (!q.includeChains) where.push("p.chain = 0");
  if (!q.includeNonCommercial) where.push("p.commercial <> 'non_commercial'");
  if (q.groups?.length) {
    where.push(`p.grp in (${q.groups.map(() => "?").join(",")})`);
    params.push(...q.groups);
  }
  if (q.filters?.length) {
    const parts = q.filters.map((f) => {
      if (!f.values) return "p.cat_key = ?";
      return `(p.cat_key = ? and p.cat_value in (${f.values.map(() => "?").join(",")}))`;
    });
    where.push(`(${parts.join(" or ")})`);
    for (const f of q.filters) params.push(f.key, ...(f.values ?? []));
  }
  const stmt: StatementSync = db.prepare(`select p.* from poi_rt r join poi p on p.id = r.id where ${where.join(" and ")}`);
  const rows = stmt.all(...params) as unknown as PoiRow[];
  return rows
    .map((row) => ({ ...row, distanceKm: haversineKm(q.lat, q.lon, row.lat, row.lon) }))
    .filter((row) => row.distanceKm <= q.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.osm_id - b.osm_id);
}

/** A named place from the extract (the best-ranked and most populous one with that name), or null. */
export function findPlace(db: DatabaseSync, name: string): { name: string; kind: string; lat: number; lon: number } | null {
  const row = db.prepare("select name, kind, lat, lon from place where name_norm = ? order by rank asc, coalesce(population, 0) desc, id asc limit 1").get(normName(name)) as { name: string; kind: string; lat: number; lon: number } | undefined;
  return row ?? null;
}

/** The nearest named place (city, town, village, suburb or hamlet) within `maxKm`, used as the locality of a listing that has no address. */
export function nearestPlace(db: DatabaseSync, lat: number, lon: number, maxKm = 6): string | null {
  const dLat = maxKm / 111.195;
  const dLon = maxKm / (111.195 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const rows = db.prepare("select name, lat, lon, rank from place where lat between ? and ? and lon between ? and ? and rank <= 6").all(lat - dLat, lat + dLat, lon - dLon, lon + dLon) as Array<{ name: string; lat: number; lon: number; rank: number }>;
  let best: { name: string; d: number } | null = null;
  for (const r of rows) {
    const d = haversineKm(lat, lon, r.lat, r.lon);
    if (d <= maxKm && (best === null || d < best.d || (d === best.d && r.name < best.name))) best = { name: r.name, d };
  }
  return best?.name ?? null;
}

export function categoryCounts(db: DatabaseSync): Array<{ grp: string; n: number }> {
  return db.prepare("select grp, count(*) as n from poi group by grp order by n desc").all() as Array<{ grp: string; n: number }>;
}
