import type { RawBusiness, ScoreBreakdown } from "./types";

/**
 * How sure we are about a business's website, and what that means for the score. A business listing that has no website URL (OpenStreetMap
 * especially: volunteers often leave it out) is NOT proof that the business has no website, so the missing-website signal is held back unless
 * independent, deterministic checks support it. Nothing here uses AI and nothing here may be overridden by an AI.
 *
 *   confirmed_website   Strong evidence that a website belongs to the business: its URL is in the listing, or a probed address was corroborated
 *                       by the business's own details (name AND phone, or name AND the domain of the listing's email).
 *   probable_website    Good but not definitive: a probed address carries the business name and its locality, without phone or email corroboration.
 *   no_website_found    Several reasonable checks (at least 3 address probes, all answered) found no official standalone website. Still not proof.
 *   unknown             Not enough evidence either way (the listing has no URL and the checks could not settle it).
 */
export type WebsiteState = "confirmed_website" | "probable_website" | "no_website_found" | "unknown";
export const WEBSITE_STATES: readonly WebsiteState[] = ["confirmed_website", "probable_website", "no_website_found", "unknown"];

/**
 * The highest score a category may receive in each state. Applied after the AI's assessment, so the AI cannot exceed it.
 *
 *  - website_need (of 25): with a confirmed website the actual site analysis decides; a probable site is analysed but with lower confidence;
 *    after several checks found nothing, a missing website may score materially, but not fully; with an unconfirmed absence the signal is small.
 *  - conversion_gap (of 15): only measurable on pages that were really read, so it is 0 while the website is unknown, and limited otherwise.
 */
export const WEBSITE_NEED_CAP: Record<WebsiteState, number> = { confirmed_website: 25, probable_website: 15, no_website_found: 18, unknown: 8 };
export const CONVERSION_GAP_CAP: Record<WebsiteState, number> = { confirmed_website: 15, probable_website: 9, no_website_found: 8, unknown: 0 };

const CAP_REASON: Record<WebsiteState, string> = {
  confirmed_website: "",
  probable_website: "A website that probably belongs to the business was analysed, so this score is held at a moderate level.",
  no_website_found: "OSM does not list a website and no matching official website was found during the checks; absence is not proof, so this score is limited.",
  unknown: "OSM does not list a website. Website availability remains unconfirmed, so this signal is kept small.",
};

/** Returns a copy of the breakdown with the two website-dependent categories held to the cap for the state. */
export function applyWebsiteCaps(breakdown: ScoreBreakdown, state: WebsiteState): ScoreBreakdown {
  const out = structuredClone(breakdown);
  for (const [category, caps] of [["website_need", WEBSITE_NEED_CAP], ["conversion_gap", CONVERSION_GAP_CAP]] as const) {
    const cat = out[category];
    const cap = Math.min(caps[state], cat.max);
    if (cat.score > cap) {
      cat.score = cap;
      if (category === "website_need") cat.reason = CAP_REASON[state] || cat.reason;
      else if (state === "unknown") cat.reason = "No website pages were read, so no gap in the enquiry flow could be observed.";
    }
  }
  return out;
}

/** The state when nothing was checked: a listing that carries a website is taken at its word, one without is unconfirmed. */
export const defaultWebsiteState = (business: Pick<RawBusiness, "websiteUrl">): WebsiteState => (business.websiteUrl ? "confirmed_website" : "unknown");

export function websiteStateLabel(state: WebsiteState | null | undefined): string {
  switch (state) {
    case "confirmed_website":
      return "Confirmed";
    case "probable_website":
      return "Probable (a matching site was found)";
    case "no_website_found":
      return "No official website found";
    default:
      return "Not listed / unconfirmed";
  }
}

/** The evidence sentence for each state. Precise on purpose: it never says the business "has no website". */
export function websiteStateFact(state: WebsiteState, host?: string | null): string {
  switch (state) {
    case "confirmed_website":
      return host ? `A website belonging to this business was confirmed at ${host}.` : "The business listing includes its website.";
    case "probable_website":
      return `A website that probably belongs to this business was found at ${host ?? "a matching address"} (name and location match, not definitive).`;
    case "no_website_found":
      return "No website URL is present in the OSM listing, and no matching official website was found during the deterministic checks.";
    default:
      return "OSM does not list a website. Website availability remains unconfirmed.";
  }
}

/* ---------------------------------- Name handling ---------------------------------- */

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const LEGAL = new Set(["bv", "bvba", "nv", "sa", "sprl", "srl", "vzw", "cv", "cvba", "comm", "vof", "gcv", "ltd", "gmbh", "asbl", "sc"]);
const STOP = new Set(["de", "het", "een", "van", "der", "den", "la", "le", "les", "the", "and", "en", "et", "t", "d", "l", "of", "te"]);
/** Words so common that a domain made of them alone would be a different business. */
const GENERIC = new Set(["garage", "taxi", "bakkerij", "frituur", "cafe", "hotel", "restaurant", "kapper", "kapsalon", "apotheek", "shop", "bar", "snack", "center", "centre", "service", "services", "auto", "autos", "cars", "car", "bike", "bikes", "fiets", "fietsen", "studio", "salon", "slagerij", "bouw", "dakwerken", "bureau", "new", "nieuw"]);

/** The words of a business name that identify it: lower-case, no accents, no legal forms ("bvba") or filler words. */
export function nameTokens(name: string): string[] {
  return norm(name).replace(/&/g, " ").split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !LEGAL.has(t) && !STOP.has(t));
}

/** Mailbox providers: an address there says nothing about the business's own domain. */
const FREEMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|gmx|proton|protonmail|mail|skynet|telenet|proximus|scarlet|belgacom|pandora|edpnet|tvcablenet|versatel|ziggo|kpnmail|planet|hetnet|tiscali|voo|orange|wanadoo|free|sfr|laposte|outlook)\./i;
export const isFreemailDomain = (domain: string) => FREEMAIL.test(`${domain.toLowerCase().trim()}.`);

/** The registrable domain of an email address when it is the business's own (not a mailbox provider's), else null. */
export function ownDomainOfEmail(email: string | null | undefined): string | null {
  const domain = (email ?? "").split("@")[1]?.toLowerCase().trim();
  if (!domain || !domain.includes(".") || isFreemailDomain(domain)) return null;
  return domain.split(".").slice(-2).join(".");
}

/**
 * Addresses worth ONE homepage request each. They are probes only: a page that loads is not yet this business (see `corroborate`).
 * The listing's own email domain comes first; then the name joined (cloetens.be), hyphenated (new-cars.be) and, for a one-word name, with a
 * legal suffix (cloetensbv.be). At most 6, none shorter than 5 characters or made only of generic words.
 */
export function domainCandidates(business: Pick<RawBusiness, "companyName" | "email"> & { sourceUrls?: readonly string[] }): string[] {
  const out: string[] = [];
  const add = (d: string) => {
    if (!out.includes(d) && out.length < 8) out.push(d);
  };
  const own = ownDomainOfEmail(business.email);
  if (own) add(own);
  const tokens = nameTokens(business.companyName);
  const joined = tokens.join("");
  if (tokens.length > 0 && tokens.length <= 4 && joined.length >= 5 && !tokens.every((t) => GENERIC.has(t))) {
    add(`${joined}.be`);
    add(`${joined}.com`);
    if (tokens.length > 1) add(`${tokens.join("-")}.be`);
    if (tokens.length === 1) {
      add(`${joined}bv.be`);
      add(`${joined}bvba.be`);
    }
  }
  // The business's own social page often carries the name it actually uses (facebook.com/WanToStay -> wantostay.be).
  for (const handle of socialHandles(business.sourceUrls ?? [])) {
    add(`${handle}.be`);
    add(`${handle}.com`);
  }
  return out;
}

const SOCIAL_SKIP = new Set(["pages", "people", "groups", "profile", "profile.php", "share", "sharer", "sharer.php", "p", "pg", "public", "watch", "events", "photo", "photos", "posts", "reel", "reels", "explore", "accounts", "stories", "tr"]);
/** Handles of the listing's Facebook / Instagram pages, reduced to letters and digits (no trailing numeric id), 5-30 characters. */
function socialHandles(urls: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (!/(^|\.)(facebook|instagram)\.com$/i.test(u.hostname)) continue;
    const first = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    if (!first || SOCIAL_SKIP.has(first)) continue;
    const handle = norm(first).replace(/-?\d{6,}$/, "").replace(/[^a-z0-9]/g, "");
    if (handle.length >= 5 && handle.length <= 30 && !/^\d+$/.test(handle) && !out.includes(handle)) out.push(handle);
  }
  return out;
}

/* ------------------------------- Corroboration of a probe ------------------------------- */

export type Corroboration = { name: boolean; phone: boolean; email: boolean; locality: boolean };

const digits = (s: string) => s.replace(/\D/g, "");

/** What a probed page says about the listing's business. All matching is exact (whole words, digit strings, the domain itself), never fuzzy. */
export function corroborate(business: Pick<RawBusiness, "companyName" | "phone" | "email" | "city">, host: string, page: { title: string | null; text: string; postcode?: string | null }): Corroboration {
  const hay = ` ${norm(`${page.title ?? ""} ${page.text}`).replace(/[^a-z0-9]+/g, " ")} `;
  const tokens = nameTokens(business.companyName);
  const name = tokens.length > 0 && tokens.every((t) => hay.includes(` ${t} `)) && tokens.join("").length >= 4;
  const phoneDigits = digits(business.phone ?? "").replace(/^(0032|32|0)/, "");
  const phone = phoneDigits.length >= 8 && digits(page.text).includes(phoneDigits);
  const own = ownDomainOfEmail(business.email);
  const registrable = host.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");
  const email = own !== null && own === registrable;
  const city = norm(business.city ?? "").replace(/[^a-z0-9]+/g, " ").trim();
  const locality = (city.length >= 3 && hay.includes(` ${city} `)) || Boolean(page.postcode && hay.includes(` ${page.postcode} `));
  return { name, phone, email, locality };
}

export type WebsiteVerdict = "confirmed_website" | "probable_website" | null;

/**
 * confirmed: the business name AND a second, independent detail (its phone number, or the domain of its own email address).
 * probable:  the business name AND its locality, nothing stronger.
 * Anything less is not a match: a resolving domain is never enough.
 */
export function verdictOf(c: Corroboration): WebsiteVerdict {
  if (c.name && (c.phone || c.email)) return "confirmed_website";
  if (c.name && c.locality) return "probable_website";
  return null;
}

/* ------------------------------------ Identity ------------------------------------ */

export type IdentityConfidence = "high" | "medium" | "low";

/** Words in a name that say what kind of business it is, and the OSM categories that are consistent with that. */
const NAME_FAMILIES: Array<{ re: RegExp; cats: ReadonlySet<string>; label: string }> = [
  { re: /\b(car|cars|auto|autos|autohandel|garage|garages|motors?|carrosserie|banden|tyres?)\b/, label: "cars", cats: new Set(["shop=car", "shop=car_repair", "shop=car_parts", "shop=tyres", "amenity=car_rental", "amenity=car_wash", "craft=car_painter", "shop=motorcycle", "shop=motorcycle_repair", "shop=truck", "shop=trailer", "shop=caravan"]) },
  { re: /\b(fiets|fietsen|bike|bikes|bicycle|bicycles|velo|cycle|cycles)\b/, label: "bicycles", cats: new Set(["shop=bicycle", "amenity=bicycle_rental", "shop=rental"]) },
  { re: /\b(restaurant|brasserie|bistro|pizza|pizzeria|trattoria|taverne|frituur|friture|snackbar|kebab|sushi|grill|steakhouse)\b/, label: "food", cats: new Set(["amenity=restaurant", "amenity=fast_food", "amenity=cafe", "amenity=bar", "amenity=pub", "amenity=ice_cream", "tourism=hotel"]) },
  { re: /\b(kapper|kapsalon|coiffure|hairstudio|hair)\b/, label: "hair", cats: new Set(["shop=hairdresser", "shop=beauty"]) },
  { re: /\b(bakkerij|bakery|boulangerie|patisserie)\b/, label: "bakery", cats: new Set(["shop=bakery", "shop=pastry", "shop=confectionery", "craft=confectionery", "shop=chocolate"]) },
  { re: /\b(hotel|hostel|logies|guesthouse|b b)\b/, label: "lodging", cats: new Set(["tourism=hotel", "tourism=guest_house", "tourism=hostel", "tourism=motel", "tourism=apartment", "tourism=chalet", "tourism=camp_site", "amenity=restaurant"]) },
  { re: /\b(apotheek|pharmacy)\b/, label: "pharmacy", cats: new Set(["amenity=pharmacy"]) },
  { re: /\b(tandarts|tandartsenpraktijk|dentist)\b/, label: "dentist", cats: new Set(["amenity=dentist", "healthcare=dentist"]) },
  { re: /\b(dakwerken|dakwerker|roofing)\b/, label: "roofing", cats: new Set(["craft=roofer", "craft=tinsmith"]) },
  { re: /\b(schilderwerken|schilder|painting)\b/, label: "painting", cats: new Set(["craft=painter", "craft=plasterer"]) },
  { re: /\b(loodgieter|loodgieterij|sanitair|plumbing)\b/, label: "plumbing", cats: new Set(["craft=plumber", "craft=hvac", "shop=bathroom_furnishing"]) },
  { re: /\b(elektro|elektriciteit|electric|electrician)\b/, label: "electrical", cats: new Set(["craft=electrician", "shop=electronics"]) },
  { re: /\b(tattoo)\b/, label: "tattoo", cats: new Set(["shop=tattoo"]) },
  { re: /\b(bloemen|florist|fleuriste)\b/, label: "florist", cats: new Set(["shop=florist"]) },
];

/** A description when the NAME clearly names a kind of business and the CATEGORY is not consistent with it ("New-Cars" tagged as a bicycle rental). */
export function nameCategoryConflict(name: string, category: string | undefined): string | null {
  if (!category) return null;
  const n = norm(name).replace(/[^a-z0-9]+/g, " ").trim();
  const families = NAME_FAMILIES.filter((f) => f.re.test(n));
  if (families.length === 0) return null;
  return families.some((f) => f.cats.has(category)) ? null : `the name suggests ${families.map((f) => f.label).join("/")} but the listing category is ${category}`;
}

/**
 * How well the listing's identity holds together, from the data only:
 *   low     name and category contradict each other (and no website confirms who the business is)
 *   high    a website confirmed it, or its own email domain matches its name and a phone number is listed
 *   medium  everything else
 */
export function identityConfidence(business: Pick<RawBusiness, "companyName" | "email" | "phone" | "category">, state: WebsiteState): { confidence: IdentityConfidence; reasons: string[] } {
  const conflict = nameCategoryConflict(business.companyName, business.category);
  if (conflict && state !== "confirmed_website") return { confidence: "low", reasons: [`Name and category do not agree: ${conflict}.`] };
  if (state === "confirmed_website") return { confidence: conflict ? "medium" : "high", reasons: conflict ? [`Name and category disagree (${conflict}), but a website confirms the business.`] : ["A website confirms the business."] };
  const own = ownDomainOfEmail(business.email);
  const label = own?.split(".")[0] ?? "";
  const tokens = nameTokens(business.companyName);
  if (own && business.phone && label.length >= 4 && tokens.some((t) => t.length >= 4 && (label.includes(t) || t.includes(label)))) return { confidence: "high", reasons: ["The business's own email domain matches its name and a phone number is listed."] };
  return { confidence: "medium", reasons: [] };
}
