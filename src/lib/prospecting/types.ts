/**
 * Prospect Finder (P10), shared types. The pipeline is deliberately split into stages that only talk through these types:
 *
 *   discovery (RawBusiness) -> dedupe -> website analysis (SiteAnalysis) -> qualification (QualifiedCandidate) -> review -> Prospect
 *
 * Nothing in here knows how an AI provider authenticates; see providers/types.ts.
 */

export const SEARCH_MODES = ["quick", "deep", "no_website", "redesign", "web_app", "industry"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const MODE_INFO: Record<SearchMode, { label: string; hint: string; defaultCount: number; maxCount: number }> = {
  quick: { label: "Quick Find", hint: "About 5 strong candidates, light research.", defaultCount: 5, maxCount: 8 },
  deep: { label: "Deep Find", hint: "10–20 candidates, each analysed more thoroughly.", defaultCount: 15, maxCount: 20 },
  no_website: { label: "No Website", hint: "Active businesses without a proper standalone website.", defaultCount: 10, maxCount: 20 },
  redesign: { label: "Website Redesign", hint: "Businesses whose current website has clear weaknesses.", defaultCount: 10, maxCount: 20 },
  web_app: { label: "Web App Opportunity", hint: "Where a booking, quote flow, automation or internal tool could add value.", defaultCount: 10, maxCount: 20 },
  industry: { label: "Industry Hunt", hint: "One industry in one region, for example car detailers in West-Vlaanderen.", defaultCount: 10, maxCount: 20 },
};

export const DEFAULT_THRESHOLD = 70;
export const DEFAULT_LOCATION = "Brugge";
export const DEFAULT_AREA = "Brugge + 30 km";

export type DiscoveryRequest = {
  mode: SearchMode;
  location: string;
  area: string | null;
  industry: string | null;
  threshold: number;
  count: number;
  excludeResearched: boolean;
};

/** A business as found by a discovery source, before anything has been checked. Only public, business-relevant facts. */
export type RawBusiness = {
  companyName: string;
  websiteUrl: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  industry: string | null;
  /** Public pages the business was found on (listing, directory, social page, its own site). */
  sourceUrls: string[];
  /** Development mock only: pages served from memory instead of the network. Never set by a real source. */
  fixturePages?: Record<string, string>;
  synthetic?: boolean;
};

/** A small, dated, extracted fact. The only thing kept from a third-party page. */
export type Observation = {
  id: string;
  url: string;
  title: string | null;
  fact: string;
  /** ISO timestamp of when it was observed. */
  at: string;
};

export type SiteSignals = {
  reachable: boolean;
  https: boolean | null;
  httpStatus: number | null;
  hasMobileViewport: boolean | null;
  contactPageFound: boolean | null;
  ctaFound: boolean | null;
  bookingFlowFound: boolean | null;
  quoteFlowFound: boolean | null;
  portfolioFound: boolean | null;
  formFound: boolean | null;
  socialOnly: boolean;
  socialLinks: string[];
  /** Copyright year in the footer or "last updated", when visible. */
  copyrightYear: number | null;
  legacyMarkup: boolean | null;
  cms: string | null;
  pagesChecked: number;
};

export type SiteAnalysis = {
  signals: SiteSignals;
  observations: Observation[];
  /** Contact details found on the business's own pages (public, professional). */
  contact: { email: string | null; phone: string | null };
  /** Why the analysis was skipped or partial, if it was ("website unreachable", "blocked by robots.txt"). */
  note: string | null;
};

export type AnalyzedBusiness = { business: RawBusiness; analysis: SiteAnalysis };

export const SCORE_CATEGORIES = ["business_fit", "website_need", "conversion_gap", "service_opportunity", "local_relevance", "contactability"] as const;
export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

export const SCORE_MAX: Record<ScoreCategory, number> = { business_fit: 25, website_need: 25, conversion_gap: 15, service_opportunity: 15, local_relevance: 10, contactability: 10 };

export const SCORE_LABELS: Record<ScoreCategory, string> = {
  business_fit: "Business fit",
  website_need: "Website need",
  conversion_gap: "Conversion gap",
  service_opportunity: "Service opportunity",
  local_relevance: "Local relevance",
  contactability: "Contactability",
};

/** One category of the score. `observations` are ids from the evidence list that support the reason. */
export type CategoryScore = { score: number; max: number; reason: string; observations: string[] };
export type ScoreBreakdown = Record<ScoreCategory, CategoryScore>;

/** What a provider returns for one business: its own judgement, to be validated before it is trusted. */
export type ProviderAssessment = {
  /** Index/identity of the business in the batch that was sent. */
  companyName: string;
  websiteUrl: string | null;
  scores: Partial<Record<ScoreCategory, { score: number; reason: string; observations?: string[] }>>;
  summary: string;
  opportunity: string;
};

export type QualifiedCandidate = {
  business: RawBusiness;
  score: number;
  breakdown: ScoreBreakdown;
  summary: string;
  opportunity: string;
  evidence: Observation[];
};
