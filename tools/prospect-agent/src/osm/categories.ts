/**
 * Which OpenStreetMap objects are "businesses" for Ian's prospecting, how they are grouped, and how a user-facing industry ("bike repair",
 * "car detailers") maps to OSM tags. All of it is a fixed, reviewable table: no AI is involved, nothing is guessed at runtime.
 *
 * Coverage note: OpenStreetMap is volunteer-mapped, so this finds businesses that someone has mapped with a name and a category. Some trades are
 * mapped under a generic tag (a detailer is usually shop=car_repair or craft=car_painter), and many small businesses are not mapped at all.
 */
export type OsmTags = Record<string, string>;
export type Group = "trades" | "automotive" | "professional" | "beauty_wellness" | "hospitality" | "retail" | "health" | "services";

export type Category = { key: string; value: string; group: Group };

const SHOP_SKIP = new Set(["vacant", "no", "yes", "mall", "department_store", "wholesale", "storage_rental"]);
const AUTOMOTIVE_SHOPS = new Set(["car", "car_repair", "car_parts", "tyres", "motorcycle", "motorcycle_repair", "bicycle", "caravan", "boat", "trailer", "truck", "agricultural_machinery"]);
const BEAUTY_SHOPS = new Set(["hairdresser", "beauty", "massage", "tattoo", "nails", "cosmetics", "perfumery", "piercing", "tanning", "spa"]);

const OFFICES = new Set(["company", "estate_agent", "architect", "accountant", "lawyer", "financial", "financial_advisor", "insurance", "it", "consulting", "tax_advisor", "notary", "employment_agency", "travel_agent", "advertising_agency", "coworking", "surveyor", "engineer", "property_management", "logistics", "construction_company", "security", "graphic_design", "photographer", "interior_design"]);
const AMENITIES: Record<string, Group> = {
  restaurant: "hospitality", cafe: "hospitality", bar: "hospitality", pub: "hospitality", fast_food: "hospitality", ice_cream: "hospitality", biergarten: "hospitality", nightclub: "hospitality",
  car_wash: "automotive", car_rental: "automotive", bicycle_rental: "automotive",
  dentist: "health", doctors: "health", clinic: "health", veterinary: "health", pharmacy: "health",
  driving_school: "services", language_school: "services", music_school: "services", dancing_school: "services", coworking_space: "services", studio: "services",
};
const TOURISM = new Set(["hotel", "guest_house", "hostel", "motel", "apartment", "chalet", "camp_site", "caravan_site", "gallery"]);
const HEALTHCARE = new Set(["physiotherapist", "dentist", "doctor", "optometrist", "podiatrist", "psychotherapist", "alternative", "midwife", "speech_therapist", "occupational_therapist", "clinic", "veterinary"]);
const LEISURE: Record<string, Group> = { fitness_centre: "beauty_wellness", dance: "beauty_wellness", sports_centre: "services", bowling_alley: "hospitality", escape_game: "hospitality", amusement_arcade: "hospitality" };

/** Public and non-commercial places. They are indexed ONLY so they can be classified and excluded (and counted); a search never returns them. */
const PUBLIC_AMENITIES = new Set(["townhall", "courthouse", "police", "fire_station", "library", "school", "college", "university", "kindergarten", "community_centre", "post_office", "social_facility", "public_bath", "prison"]);
const PUBLIC_OFFICES = new Set(["government", "administrative", "ngo", "association", "diplomatic", "political_party", "foundation", "educational_institution", "research", "religion", "charity"]);

/** The tag keys the importer needs from the file; everything else is skipped while reading. */
export const WANTED_KEYS = new Set([
  "operator:type", "ownership",
  "name", "shop", "craft", "office", "amenity", "tourism", "healthcare", "leisure", "place", "population",
  "website", "contact:website", "url", "phone", "contact:phone", "contact:mobile", "email", "contact:email",
  "addr:city", "addr:postcode", "addr:street", "addr:housenumber", "brand", "brand:wikidata", "operator",
  "facebook", "contact:facebook", "instagram", "contact:instagram",
]);

const clean = (v: string | undefined) => (v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/** The business category of an object, or null when it is not a business we index (no name, or not in the tables above). */
export function classify(tags: OsmTags): Category | null {
  const name = clean(tags.name);
  if (name.length < 2) return null;
  const shop = tags.shop;
  if (shop && !SHOP_SKIP.has(shop)) return { key: "shop", value: shop, group: AUTOMOTIVE_SHOPS.has(shop) ? "automotive" : BEAUTY_SHOPS.has(shop) ? "beauty_wellness" : "retail" };
  const craft = tags.craft;
  if (craft && craft !== "yes" && craft !== "no") return { key: "craft", value: craft, group: "trades" };
  const office = tags.office;
  if (office && OFFICES.has(office)) return { key: "office", value: office, group: "professional" };
  if (office && PUBLIC_OFFICES.has(office)) return { key: "office", value: office, group: "services" };
  const amenity = tags.amenity;
  if (amenity && AMENITIES[amenity]) return { key: "amenity", value: amenity, group: AMENITIES[amenity] };
  if (amenity && PUBLIC_AMENITIES.has(amenity)) return { key: "amenity", value: amenity, group: "services" };
  const tourism = tags.tourism;
  if (tourism && TOURISM.has(tourism)) return { key: "tourism", value: tourism, group: "hospitality" };
  const health = tags.healthcare;
  if (health && HEALTHCARE.has(health)) return { key: "healthcare", value: health, group: "health" };
  const leisure = tags.leisure;
  if (leisure && LEISURE[leisure]) return { key: "leisure", value: leisure, group: LEISURE[leisure] };
  return null;
}

/* ---------------------------------- Commercial or not ---------------------------------- */

/**
 * Whether a place is a business Ian would approach cold. Decided from OSM TAGS only (the kind of place and who operates it), never from the
 * name: a privately run gym, school or care business stays commercial; a municipal pool does not.
 *
 *   commercial         explicitly private (operator:type / ownership = private)
 *   likely_commercial  a kind of place that is a business unless tagged otherwise (shop, craft, restaurant, professional office...)
 *   unknown            a kind of place that is often public AND private (sports centre, clinic, music school...) with no operator information
 *   non_commercial     public or non-profit by tag: government, town hall, police, public school or library, public/NGO operator...
 *
 * Searches exclude non_commercial by default and rank unknown after the rest.
 */
export type Commercial = "commercial" | "likely_commercial" | "unknown" | "non_commercial";

const PRIVATE_OPERATOR = new Set(["private", "company", "business", "commercial"]);
const NON_COMMERCIAL_OPERATOR = new Set(["public", "government", "council", "municipal", "state", "national", "regional", "religious", "ngo", "charity", "community", "volunteer", "consortium_public"]);
const PUBLIC_OWNERSHIP = new Set(["public", "municipal", "communal", "state", "national", "regional", "government", "council"]);
/** Kinds of place that are as often public as private. */
const AMBIGUOUS = new Set(["leisure=sports_centre", "amenity=clinic", "amenity=music_school", "amenity=language_school", "amenity=dancing_school", "amenity=coworking_space", "tourism=gallery", "amenity=studio"]);

export function commercialClass(tags: OsmTags, cat: Category): Commercial {
  const operator = clean(tags["operator:type"]).toLowerCase();
  const ownership = clean(tags.ownership).toLowerCase();
  // Explicit private operation wins, even for a school or a sports facility.
  if (PRIVATE_OPERATOR.has(operator) || ownership === "private") return "commercial";
  if (NON_COMMERCIAL_OPERATOR.has(operator) || PUBLIC_OWNERSHIP.has(ownership)) return "non_commercial";
  if (cat.key === "amenity" && PUBLIC_AMENITIES.has(cat.value)) return "non_commercial";
  if (cat.key === "office" && PUBLIC_OFFICES.has(cat.value)) return "non_commercial";
  if (cat.key === "shop" && cat.value === "charity") return "non_commercial";
  if (AMBIGUOUS.has(`${cat.key}=${cat.value}`)) return "unknown";
  return "likely_commercial";
}

/** Official government web addresses (national, regional and ".gov" sites) mark a place as public even without an operator tag. */
export function isGovernmentHost(host: string): boolean {
  const h = host.toLowerCase();
  return /(^|\.)(fgov\.be|belgium\.be|vlaanderen\.be|gov|gov\.[a-z]{2})$/.test(h);
}

/** A listing that carries a brand is a chain branch: not an independent business to approach. */
export const isChain = (tags: OsmTags): boolean => Boolean(clean(tags.brand) || clean(tags["brand:wikidata"]));

/** Places used to find the centre of a search ("Brugge"). Larger places win over smaller ones with the same name. */
export const PLACE_RANK: Record<string, number> = { city: 1, town: 2, municipality: 3, village: 4, suburb: 5, hamlet: 6, quarter: 7, neighbourhood: 8 };

/* ------------------------------- "Any industry" priorities ------------------------------- */

/**
 * For a search with no industry the index is not dumped: groups are visited in this order of usefulness for Ian's services (businesses where
 * a better web presence, a quote flow or a booking flow changes something), taking businesses from each group in turn so no one group fills the
 * list. Weights are the default; they can be overridden in the agent's config.json ("discoveryPriorities": { "trades": 100, ... }).
 */
export const DEFAULT_PRIORITIES: Record<Group, number> = { trades: 100, automotive: 95, professional: 90, beauty_wellness: 85, hospitality: 75, retail: 70, health: 60, services: 50 };

export function orderedGroups(overrides: Partial<Record<Group, number>> = {}): Group[] {
  const weights = { ...DEFAULT_PRIORITIES, ...overrides };
  return (Object.keys(weights) as Group[]).filter((g) => weights[g] > 0).sort((a, b) => weights[b] - weights[a] || a.localeCompare(b));
}

/* ----------------------------------- Industries ----------------------------------- */

export type TagFilter = { key: string; values: string[] | null };
type Rule = { pattern: RegExp; label: string; filters: TagFilter[] };

/** User-facing words (Dutch and English) -> the OSM tags that mean that kind of business. First match wins. */
export const INDUSTRY_RULES: Rule[] = [
  { pattern: /car|auto|detail|garage|carrosserie/i, label: "Cars and car care", filters: [{ key: "shop", values: ["car_repair", "car", "car_parts", "tyres"] }, { key: "craft", values: ["car_painter"] }, { key: "amenity", values: ["car_wash"] }] },
  { pattern: /bike|bicycle|fiets/i, label: "Bicycles", filters: [{ key: "shop", values: ["bicycle"] }] },
  { pattern: /bak(ery|ker)/i, label: "Bakeries", filters: [{ key: "shop", values: ["bakery", "pastry"] }] },
  { pattern: /roof|dak/i, label: "Roofing", filters: [{ key: "craft", values: ["roofer", "tinsmith"] }] },
  { pattern: /garden|tuin/i, label: "Gardening", filters: [{ key: "craft", values: ["gardener"] }, { key: "shop", values: ["garden_centre"] }] },
  { pattern: /plumb|loodgiet|sanitair/i, label: "Plumbing and heating", filters: [{ key: "craft", values: ["plumber", "hvac"] }] },
  { pattern: /electri|elektr/i, label: "Electricians", filters: [{ key: "craft", values: ["electrician"] }] },
  { pattern: /carpent|schrijnwerk|joiner|timmer/i, label: "Carpentry", filters: [{ key: "craft", values: ["carpenter", "joiner"] }] },
  { pattern: /hair|kapper|kapsal/i, label: "Hairdressers", filters: [{ key: "shop", values: ["hairdresser"] }] },
  { pattern: /beauty|schoonheid|nail|nagel/i, label: "Beauty", filters: [{ key: "shop", values: ["beauty", "nails"] }] },
  { pattern: /tattoo/i, label: "Tattoo", filters: [{ key: "shop", values: ["tattoo"] }] },
  { pattern: /restaurant|horeca|caf[eé]|bar\b/i, label: "Hospitality", filters: [{ key: "amenity", values: ["restaurant", "cafe", "bar"] }] },
  { pattern: /hotel|b&b|bed and breakfast|logies/i, label: "Accommodation", filters: [{ key: "tourism", values: ["hotel", "guest_house", "hostel", "apartment", "chalet"] }] },
  { pattern: /paint|schilder/i, label: "Painters", filters: [{ key: "craft", values: ["painter"] }] },
  { pattern: /build|bouw|construct/i, label: "Building and construction", filters: [{ key: "craft", values: ["builder", "construction"] }, { key: "office", values: ["construction_company"] }] },
  { pattern: /physio|kine/i, label: "Physiotherapy", filters: [{ key: "healthcare", values: ["physiotherapist"] }] },
  { pattern: /florist|bloem/i, label: "Florists", filters: [{ key: "shop", values: ["florist"] }] },
  { pattern: /accountant|boekhoud/i, label: "Accountants", filters: [{ key: "office", values: ["accountant", "tax_advisor"] }] },
  { pattern: /estate|vastgoed|immo/i, label: "Estate agents", filters: [{ key: "office", values: ["estate_agent"] }] },
  { pattern: /fitness|gym|sport/i, label: "Fitness", filters: [{ key: "leisure", values: ["fitness_centre", "sports_centre"] }] },
];

export function matchIndustry(industry: string | null | undefined): Rule | null {
  const text = (industry ?? "").trim();
  return text ? (INDUSTRY_RULES.find((r) => r.pattern.test(text)) ?? null) : null;
}
