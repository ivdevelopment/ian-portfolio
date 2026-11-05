import { DEFAULT_PRIORITIES, orderedGroups, type Group } from "./categories";
import { normName, type PoiRow } from "./index-db";

/**
 * Which businesses of a search area go forward to the P10 pipeline, and in which order. The pipeline analyses them in that order and stops as
 * soon as it has enough candidates, so the ORDER decides who is ever looked at. Everything here is fixed rules (no randomness, no AI):
 *
 *  1. DISTANCE BANDS. The radius is split into three bands (inner sixth, to half, to the full radius: 0-5, 5-15 and 15-30 km for 30 km) and the
 *     list takes one business from each band in turn. A 30 km search therefore explores the whole area instead of only the busy town centre,
 *     where OpenStreetMap is densest. Distance only enforces the requested area: nothing is scored down for being farther away.
 *  2. KINDS OF BUSINESS. Inside a band the kinds (trades, automotive, professional, ...) are visited in the configured order, one at a time, and a
 *     single category (for example "shop=bicycle") may not fill more than a small share of the list, so a heavily mapped category cannot dominate.
 *  3. WEBSITE PRESENCE IS NEUTRAL. Businesses with and without a listed website alternate, so businesses without a website stay discoverable
 *     (mode "No Website" lists those first instead).
 *  4. QUALITY OF THE LISTING. Commercial businesses before "unknown" ones; ones with some contact route (website, phone or email) before ones
 *     with none; then the more complete listing; then the OSM id as the final, stable tie-break.
 */
export type Ranked = PoiRow & { distanceKm: number };
export type Band = 0 | 1 | 2;
export const BAND_EDGES = [1 / 6, 1 / 2, 1] as const;

export const bandOf = (distanceKm: number, radiusKm: number): Band => {
  const ratio = distanceKm / radiusKm;
  return ratio <= BAND_EDGES[0] ? 0 : ratio <= BAND_EDGES[1] ? 1 : 2;
};

/** "0-5 km", "5-15 km", "15-30 km" for the given radius. */
export const bandLabels = (radiusKm: number): [string, string, string] => {
  const a = Math.round(radiusKm * BAND_EDGES[0]);
  const b = Math.round(radiusKm * BAND_EDGES[1]);
  return [`0-${a} km`, `${a}-${b} km`, `${b}-${Math.round(radiusKm)} km`];
};

const hasWebsite = (r: Ranked) => Boolean(r.website);
const hasContactRoute = (r: Ranked) => Boolean(r.website || r.phone || r.email);
/** Listing completeness WITHOUT the website (so a missing website is never penalised): phone, email, street address, social page. */
const completeness = (r: Ranked) => Number(Boolean(r.phone)) + Number(Boolean(r.email)) + Number(Boolean(r.street)) + Number(Boolean(r.facebook || r.instagram));

/** The order inside one queue: commercial before unknown, reachable before not, more complete first, then the OSM id. Website presence is not a key. */
function baseOrder(a: Ranked, b: Ranked): number {
  return (
    Number(a.commercial === "unknown") - Number(b.commercial === "unknown") ||
    Number(!hasContactRoute(a)) - Number(!hasContactRoute(b)) ||
    completeness(b) - completeness(a) ||
    a.distanceKm - b.distanceKm ||
    a.osm_id - b.osm_id ||
    a.osm_type.localeCompare(b.osm_type)
  );
}

/** Bit-reversed position of `i` among `bits` bits: 0, n/2, n/4, 3n/4, ... A fixed permutation that visits a sorted list spread out instead of from one end. */
const spreadKey = (i: number, bits: number): number => {
  let r = 0;
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
  return r;
};

/**
 * Among listings that rank EQUALLY on quality (same tier, reachability and completeness) the order would otherwise fall back to "nearest first",
 * which makes every band behave like its inner edge. Equal listings are instead visited in a spread-out order along the distance (middle, then
 * the quarters, then the eighths...). It is a fixed permutation, not randomness: the same input always gives the same order.
 */
function spreadTies(sorted: Ranked[]): Ranked[] {
  const out: Ranked[] = [];
  const sameRank = (a: Ranked, b: Ranked) => a.commercial === "unknown" === (b.commercial === "unknown") && hasContactRoute(a) === hasContactRoute(b) && completeness(a) === completeness(b);
  for (let start = 0; start < sorted.length; ) {
    let end = start + 1;
    while (end < sorted.length && sameRank(sorted[start], sorted[end])) end++;
    const run = sorted.slice(start, end);
    const bits = Math.max(1, Math.ceil(Math.log2(run.length)));
    out.push(...run.map((r, i) => ({ r, k: spreadKey(i, bits) })).sort((a, b) => a.k - b.k).map((x) => x.r));
    start = end;
  }
  return out;
}

/** With and without a website alternate (within the same commercial tier), keeping each side's own order. */
function interleaveWebsite(sorted: Ranked[]): Ranked[] {
  const out: Ranked[] = [];
  for (const unknown of [false, true]) {
    const tier = sorted.filter((r) => (r.commercial === "unknown") === unknown);
    const withSite = tier.filter(hasWebsite);
    const without = tier.filter((r) => !hasWebsite(r));
    // Start with the side that has the best-ranked business, then alternate.
    let takeWith = tier.length > 0 && hasWebsite(tier[0]);
    while (withSite.length > 0 || without.length > 0) {
      const next = takeWith ? (withSite.length ? withSite : without) : without.length ? without : withSite;
      out.push(next.shift() as Ranked);
      takeWith = !takeWith;
    }
  }
  return out;
}

export type SelectOptions = {
  radiusKm: number;
  limit: number;
  mode: string;
  /** True when the search names an industry: kinds of business are then not balanced (there is only one). */
  industrySearch: boolean;
  priorities?: Partial<Record<Group, number>>;
  /** Place key for dropping the same business listed twice. */
  fallbackCity?: string;
};

/** The ordered pool. `rows` must already be limited to the radius, to independent (non-chain) and non-non-commercial listings. */
export function selectPool(rows: readonly Ranked[], opts: SelectOptions): Ranked[] {
  const noWebsiteFirst = opts.mode === "no_website";
  const groups = orderedGroups(opts.priorities ?? DEFAULT_PRIORITIES);
  const cap = Math.max(2, Math.ceil(opts.limit / 20));

  // queues[band][group]: for an industry search there is one queue per band (group "all").
  const queues = new Map<string, Ranked[]>();
  const keyOf = (band: Band, group: string) => `${band}:${group}`;
  for (const band of [0, 1, 2] as Band[]) {
    const inBand = rows.filter((r) => bandOf(r.distanceKm, opts.radiusKm) === band);
    const make = (list: Ranked[]) => {
      const sorted = spreadTies([...list].sort(baseOrder));
      return noWebsiteFirst ? [...sorted].sort((a, b) => Number(hasWebsite(a)) - Number(hasWebsite(b))) : interleaveWebsite(sorted);
    };
    if (opts.industrySearch) queues.set(keyOf(band, "all"), make(inBand));
    else for (const g of groups) queues.set(keyOf(band, g), make(inBand.filter((r) => r.grp === g)));
  }

  const picked: Ranked[] = [];
  const names = new Set<string>();
  const perBandCategory = new Map<string, number>();
  const capLevel: Record<Band, number> = { 0: cap, 1: cap, 2: cap };
  const pointer: Record<Band, number> = { 0: 0, 1: 0, 2: 0 };
  const queueGroups = opts.industrySearch ? ["all"] : groups;

  /** One business from this band, or null when its queues are empty. Dropped duplicates are removed on the way. */
  const drawOnce = (band: Band): boolean | "capped" => {
    let capped = false;
    for (let step = 0; step < queueGroups.length; step++) {
      const gi = (pointer[band] + step) % queueGroups.length;
      const q = queues.get(keyOf(band, queueGroups[gi])) ?? [];
      for (let i = 0; i < q.length; i++) {
        const r = q[i];
        const category = `${band}|${r.cat_key}=${r.cat_value}`;
        const nameKey = `${normName(r.name)}|${normName(r.city ?? opts.fallbackCity ?? "")}`;
        if (names.has(nameKey)) {
          q.splice(i--, 1);
          continue;
        }
        if (!opts.industrySearch && (perBandCategory.get(category) ?? 0) >= capLevel[band]) {
          capped = true;
          continue;
        }
        q.splice(i, 1);
        names.add(nameKey);
        perBandCategory.set(category, (perBandCategory.get(category) ?? 0) + 1);
        pointer[band] = (gi + 1) % queueGroups.length;
        picked.push(r);
        return true;
      }
    }
    return capped ? "capped" : false;
  };

  // The cap on one category (per band) starts small. If a band has too few kinds of business to fill its share under it, ITS cap rises one step
  // at a time, so the supply is shared out evenly and never dumped into one category, until the band is exhausted.
  const draw = (band: Band): boolean => {
    for (;;) {
      const r = drawOnce(band);
      if (r === true) return true;
      if (r === false || capLevel[band] >= opts.limit) return false;
      capLevel[band]++;
    }
  };
  let progressed = true;
  while (picked.length < opts.limit && progressed) {
    progressed = false;
    for (const band of [0, 1, 2] as Band[]) {
      if (picked.length >= opts.limit) break;
      if (draw(band)) progressed = true;
    }
  }
  return picked;
}

/** Counts for the dry-run report and the logs. */
export function describePool(pool: readonly Ranked[], radiusKm: number) {
  const bands = [0, 0, 0];
  const categories: Record<string, number> = {};
  const commercial: Record<string, number> = {};
  let withWebsite = 0;
  for (const r of pool) {
    bands[bandOf(r.distanceKm, radiusKm)]++;
    categories[`${r.cat_key}=${r.cat_value}`] = (categories[`${r.cat_key}=${r.cat_value}`] ?? 0) + 1;
    commercial[r.commercial] = (commercial[r.commercial] ?? 0) + 1;
    if (r.website) withWebsite++;
  }
  const d = pool.map((r) => r.distanceKm).sort((a, b) => a - b);
  const at = (p: number) => (d.length ? Math.round(d[Math.min(d.length - 1, Math.floor(p * d.length))] * 10) / 10 : 0);
  return { bands, bandLabels: bandLabels(radiusKm), categories, commercial, withWebsite, withoutWebsite: pool.length - withWebsite, distance: { min: at(0), median: at(0.5), p90: at(0.9), max: d.length ? Math.round(d[d.length - 1] * 10) / 10 : 0 } };
}
