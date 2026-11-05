import type { AnalyzedBusiness, DiscoveryRequest, ProviderAssessment, RawBusiness, ScoreCategory } from "../types";
import type { BusinessSource, ProspectAIProvider, ProviderCapabilities, QualifyInput } from "./types";

/**
 * Deterministic development provider and source. Everything it returns is INVENTED: every name ends in "(sample data)", every website is on the
 * reserved `.invalid` domain, and every candidate is stored with `synthetic = true`. It can only be switched on against a local database
 * (see config.ts), so it can never put made-up businesses into production.
 */

const page = (o: { viewport?: boolean; cta?: string; footer?: string; legacy?: boolean; links?: string; form?: boolean; gallery?: boolean; email?: string }) =>
  `<html><head><title>Sample</title>${o.viewport ? '<meta name="viewport" content="width=device-width">' : ""}<meta name="description" content="A sample page used for development only."></head><body>${o.legacy ? "<font size=2>Welcome</font><marquee>Open</marquee>" : "<h1>Welcome</h1>"}<nav>${o.links ?? ""}</nav>${o.cta ? `<a href="/x">${o.cta}</a>` : ""}${o.form ? "<form action='/send'></form>" : ""}${o.gallery ? '<a href="/projecten">Projecten</a>' : ""}${o.email ? `<a href="mailto:${o.email}">mail</a>` : ""}<footer>${o.footer ?? ""}</footer></body></html>`;

const SAMPLES: RawBusiness[] = [
  {
    companyName: "Sample Bike Repair (sample data)", websiteUrl: "http://sample-bike-repair.invalid/", email: "info@sample-bike-repair.invalid", phone: null, city: "Brugge", region: "West-Vlaanderen", industry: "Bike repair",
    sourceUrls: ["sample://directory/bike-repair"], synthetic: true,
    fixturePages: { "http://sample-bike-repair.invalid/": page({ legacy: true, footer: "© 2016 Sample Bike Repair", links: '<a href="/contact">Contact</a>', email: "info@sample-bike-repair.invalid" }), "http://sample-bike-repair.invalid/contact": page({ legacy: true }) },
  },
  {
    companyName: "Sample Car Detailing (sample data)", websiteUrl: "https://sample-car-detailing.invalid/", email: "hello@sample-car-detailing.invalid", phone: "+3250000000", city: "Brugge", region: "West-Vlaanderen", industry: "Car detailing",
    sourceUrls: ["sample://directory/car-detailing"], synthetic: true,
    fixturePages: { "https://sample-car-detailing.invalid/": page({ viewport: true, footer: "© 2025", links: '<a href="/contact">Contact</a><a href="/projecten">Realisaties</a>', gallery: true }) , "https://sample-car-detailing.invalid/contact": page({ viewport: true }) },
  },
  {
    companyName: "Sample Bakery (sample data)", websiteUrl: null, email: null, phone: "+3250111111", city: "Damme", region: "West-Vlaanderen", industry: "Bakery",
    sourceUrls: ["https://www.facebook.com/sample-bakery-sample-data"], synthetic: true,
  },
  {
    companyName: "Sample Roofing (sample data)", websiteUrl: "https://sample-roofing.invalid/", email: "info@sample-roofing.invalid", phone: "+3250222222", city: "Oostkamp", region: "West-Vlaanderen", industry: "Roofing",
    sourceUrls: ["sample://directory/roofing"], synthetic: true,
    fixturePages: { "https://sample-roofing.invalid/": page({ viewport: true, cta: "Vraag een offerte aan", footer: "© 2026", links: '<a href="/contact">Contact</a><a href="/projecten">Projecten</a>', form: true, gallery: true }), "https://sample-roofing.invalid/contact": page({ viewport: true, form: true }) },
  },
  {
    companyName: "Sample Physio Studio (sample data)", websiteUrl: "https://sample-physio.invalid/", email: "info@sample-physio.invalid", phone: null, city: "Brugge", region: "West-Vlaanderen", industry: "Physiotherapy",
    sourceUrls: ["sample://directory/physio"], synthetic: true,
    fixturePages: { "https://sample-physio.invalid/": page({ viewport: true, footer: "© 2022", links: '<a href="/contact">Contact</a>' }), "https://sample-physio.invalid/contact": page({ viewport: true }) },
  },
  {
    companyName: "Sample Plumbing (sample data)", websiteUrl: "https://sample-plumbing.invalid/", email: null, phone: null, city: "Jabbeke", region: "West-Vlaanderen", industry: "Plumbing",
    sourceUrls: ["sample://directory/plumbing"], synthetic: true,
    fixturePages: {},
  },
  {
    companyName: "Sample Garden Design (sample data)", websiteUrl: "https://sample-garden.invalid/", email: "info@sample-garden.invalid", phone: "+3250333333", city: "Knokke-Heist", region: "West-Vlaanderen", industry: "Garden design",
    sourceUrls: ["sample://directory/garden"], synthetic: true,
    fixturePages: { "https://sample-garden.invalid/": page({ viewport: true, cta: "Boek een afspraak", footer: "© 2026", links: '<a href="/contact">Contact</a>', gallery: true, form: true }), "https://sample-garden.invalid/contact": page({ viewport: true, form: true }) },
  },
];

export class MockBusinessSource implements BusinessSource {
  readonly id = "mock";
  async discover(request: DiscoveryRequest): Promise<RawBusiness[]> {
    const industry = (request.industry ?? "").trim().toLowerCase();
    const pool = industry ? SAMPLES.filter((s) => (s.industry ?? "").toLowerCase().includes(industry) || industry.includes((s.industry ?? "").toLowerCase())) : SAMPLES;
    const wanted = request.mode === "no_website" ? [...pool].sort((a, b) => Number(Boolean(a.websiteUrl)) - Number(Boolean(b.websiteUrl))) : pool;
    return wanted.slice(0, Math.max(1, request.count * 3));
  }
}

const ids = (item: AnalyzedBusiness, re: RegExp) => item.analysis.observations.filter((o) => re.test(o.fact)).map((o) => o.id);

export class MockProvider implements ProspectAIProvider {
  readonly id = "mock" as const;

  async capabilities(): Promise<ProviderCapabilities> {
    return { id: this.id, available: true, supportsWebSearch: false, synthetic: true, reason: null };
  }

  async qualifyBusinesses({ request, items }: QualifyInput): Promise<ProviderAssessment[]> {
    return items.map((item) => assess(request, item));
  }
}

function assess(request: DiscoveryRequest, item: AnalyzedBusiness): ProviderAssessment {
  const { business: b, analysis: a } = item;
  const s = a.signals;
  const noSite = !b.websiteUrl;
  const scores: ProviderAssessment["scores"] = {};
  const put = (c: ScoreCategory, score: number, reason: string, observations: string[] = []) => {
    scores[c] = { score, reason, observations };
  };

  put("business_fit", 14 + (request.industry && (b.industry ?? "").toLowerCase().includes(request.industry.toLowerCase()) ? 6 : 3) + (b.industry ? 3 : 0), `${b.industry ?? "A local service business"} with clear local activity in ${b.city ?? "the region"}.`);

  if (noSite) {
    put("website_need", 22, "No website URL is present in the listing; the business appears to rely on a social media page.", ids(item, /No website URL/));
    put("conversion_gap", 12, "No website is listed where customers can send an enquiry or request a quote.", ids(item, /No website URL/));
  } else if (!s.reachable) {
    put("website_need", 0, "The website could not be analysed.");
    put("conversion_gap", 0, "The enquiry flow could not be assessed.");
  } else {
    const need = (!s.hasMobileViewport ? 8 : 0) + (!s.https ? 4 : 0) + (s.legacyMarkup ? 6 : 0) + (s.copyrightYear && s.copyrightYear <= new Date().getUTCFullYear() - 3 ? 5 : 0);
    put("website_need", Math.min(25, need), need > 0 ? "The site shows signs of older web practice: no mobile viewport, plain http or dated markup." : "No clear website weakness was observed.", ids(item, /mobile viewport|plain http|older web practice|copyright year/));
    const gap = (!s.ctaFound ? 6 : 0) + (!s.quoteFlowFound && !s.formFound ? 5 : 0) + (!s.bookingFlowFound ? 4 : 0);
    put("conversion_gap", Math.min(15, gap), gap > 0 ? "The pages checked offer no clear call-to-action, quote request or booking route." : "The enquiry flow looks complete.", ids(item, /call-to-action|quote request|booking or reservation/));
  }
  const opp = request.mode === "web_app" ? (s.bookingFlowFound ? 6 : 12) : noSite ? 12 : (s.bookingFlowFound && s.quoteFlowFound ? 3 : 9);
  put("service_opportunity", opp, noSite ? "A first website with an enquiry flow would be a natural fit." : "A booking or quote request flow could add value for this kind of business.", ids(item, /booking or reservation|quote request/));
  put("local_relevance", (b.city ?? "").toLowerCase() === request.location.toLowerCase() ? 10 : b.region === "West-Vlaanderen" ? 7 : 3, `Located in ${b.city ?? "the region"}${b.region ? `, ${b.region}` : ""}.`);
  put("contactability", 0, "");

  return {
    companyName: b.companyName,
    websiteUrl: b.websiteUrl,
    scores,
    summary: `${b.companyName.replace(" (sample data)", "")}: ${noSite ? "no standalone website found" : s.reachable ? "modernisation opportunity on the site and its enquiry flow" : "website could not be analysed"}. Sample data for development.`,
    opportunity: noSite ? "New website + enquiry flow" : (scores.conversion_gap?.score ?? 0) >= 9 ? "Website redesign + quote request flow" : "Booking / reservation flow",
  };
}
