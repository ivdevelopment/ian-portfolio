import { fetchPublicPage, validatePublicUrl, type FetchResult } from "./public-fetch";
import { isAllowedByRobots } from "./robots";
import type { Observation, RawBusiness, SiteAnalysis, SiteSignals } from "./types";

/**
 * Deterministic website analysis: only what a visitor can see, measured with plain parsing before any AI is involved. Each finding is a small
 * dated observation (URL, title, a short fact); the pages themselves are never stored. Absence is always phrased as "not found on the pages
 * checked", never as "does not exist".
 */

const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "youtube.com", "pinterest.com", "x.com", "twitter.com"];
const CONTACT_RE = /contact|kontakt|bereik|neem[- ]contact|get[- ]in[- ]touch/i;
const SERVICES_RE = /diensten|services|aanbod|werkwijze|wat[- ]we[- ]doen|producten|products/i;
const ABOUT_RE = /over[- ]ons|over[- ]mij|about|wie[- ]zijn[- ]we|bedrijf|team/i;
const QUOTE_RE = /offerte|prijsofferte|prijsaanvraag|prijs aanvragen|gratis (advies|prijs)|vraag .{0,20}(aan|prijs)|request a quote|get a quote|\bquote\b|estimate/i;
const BOOKING_RE = /reserv|boek(en| nu| een)?\b|afspraak|book(ing| now| online)?\b|calendly|simplybook|planning|timify|setmore|appointment|schedule/i;
const CTA_RE = new RegExp(`${QUOTE_RE.source}|${BOOKING_RE.source}|bel (ons|nu)|call (us|now)|contact(eer)? (ons|me)|neem contact|get in touch|stuur .{0,15}bericht|whatsapp`, "i");
const PORTFOLIO_RE = /realisaties|projecten|portfolio|galerij|gallery|referenties|ons werk|our work|before[- ]after|voor[- ]en[- ]na/i;
const CMS: Array<[RegExp, string]> = [[/wp-content|wp-includes/i, "WordPress"], [/wixstatic|wix\.com/i, "Wix"], [/squarespace/i, "Squarespace"], [/jimdo/i, "Jimdo"], [/webnode/i, "Webnode"], [/cdn\.shopify|shopify/i, "Shopify"], [/joomla/i, "Joomla"]];
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const NOT_A_MAILBOX = /\.(png|jpe?g|gif|svg|webp|css|js)$|sentry|wixpress|example\.|@2x|u00/i;

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&amp;/g, " ").replace(/\s+/g, " ").trim();

export type PageFindings = {
  title: string | null;
  metaDescription: boolean;
  viewport: boolean;
  anchors: Array<{ href: string; label: string }>;
  hasForm: boolean;
  cta: boolean;
  booking: boolean;
  quote: boolean;
  portfolio: boolean;
  social: string[];
  copyrightYear: number | null;
  legacyMarkup: boolean;
  cms: string | null;
  emails: string[];
  phones: string[];
};

/** Pure: one HTML document in, plain findings out. */
export function analyzeHtml(html: string): PageFindings {
  const title = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)?.[1];
  const anchors: PageFindings["anchors"] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) anchors.push({ href: m[1].trim(), label: text(m[2]).slice(0, 120) });
  const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]{0,200}?)<\/button>/gi)].map((m) => text(m[1]));
  const visible = [...anchors.map((a) => `${a.label} ${a.href}`), ...buttons].join(" \n ");
  const social = [...new Set(anchors.map((a) => SOCIAL_HOSTS.find((h) => hostOf(a.href.startsWith("http") ? a.href : "") === h || hostOf(a.href.startsWith("http") ? a.href : "").endsWith(`.${h}`))).filter((h): h is string => Boolean(h)))];
  const years = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1])).filter((y) => y >= 1995 && y <= 2100);
  const emails = [...new Set([...(html.match(EMAIL_RE) ?? []), ...anchors.filter((a) => /^mailto:/i.test(a.href)).map((a) => a.href.replace(/^mailto:/i, "").split("?")[0]).filter(Boolean)].map((e) => e.toLowerCase()))].filter((e) => !NOT_A_MAILBOX.test(e));
  const phones = [...new Set(anchors.filter((a) => /^tel:/i.test(a.href)).map((a) => a.href.replace(/^tel:/i, "").replace(/[^\d+]/g, "")).filter((p) => p.length >= 8))];
  const generator = /<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1];
  return {
    title: title ? text(title).slice(0, 160) : null,
    metaDescription: /<meta[^>]+name=["']description["'][^>]*content=["'][^"']{10,}/i.test(html),
    viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    anchors,
    hasForm: /<form\b/i.test(html),
    cta: CTA_RE.test(visible),
    booking: BOOKING_RE.test(visible) || /calendly|simplybook|timify|setmore/i.test(html),
    quote: QUOTE_RE.test(visible),
    portfolio: PORTFOLIO_RE.test(visible),
    social,
    copyrightYear: years.length ? Math.max(...years) : null,
    legacyMarkup: /<(marquee|blink|frameset|font)\b/i.test(html) || /swfobject|\.swf\b/i.test(html),
    cms: generator ? text(generator).slice(0, 60) : (CMS.find(([re]) => re.test(html))?.[1] ?? null),
    emails,
    phones,
  };
}

export type AnalyzeDeps = {
  fetchPage?: (url: string, kind?: "html" | "text") => Promise<FetchResult>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Pages to read per website: the homepage plus up to this many more. Kept small on purpose. */
  extraPages?: number;
};

const emptySignals = (over: Partial<SiteSignals> = {}): SiteSignals => ({ reachable: false, https: null, httpStatus: null, hasMobileViewport: null, contactPageFound: null, ctaFound: null, bookingFlowFound: null, quoteFlowFound: null, portfolioFound: null, formFound: null, socialOnly: false, socialLinks: [], copyrightYear: null, legacyMarkup: null, cms: null, pagesChecked: 0, ...over });

/** Same-origin links worth one more request: the first contact, services and about page that are easy to find. */
export function pickExtraPages(home: PageFindings, baseUrl: string, limit: number): string[] {
  const base = new URL(baseUrl);
  const found: string[] = [];
  for (const re of [CONTACT_RE, SERVICES_RE, ABOUT_RE]) {
    for (const a of home.anchors) {
      if (!re.test(`${a.label} ${a.href}`) || /^(mailto|tel|javascript):/i.test(a.href)) continue;
      let target: URL;
      try {
        target = new URL(a.href, base);
      } catch {
        continue;
      }
      if (hostOf(target.toString()) !== hostOf(baseUrl) || !/^https?:$/.test(target.protocol) || /\.(pdf|jpe?g|png|zip)$/i.test(target.pathname)) continue;
      target.hash = "";
      const key = target.toString();
      if (key !== base.toString() && !found.includes(key)) {
        found.push(key);
        break;
      }
    }
  }
  return found.slice(0, limit);
}

export async function analyzeWebsite(business: RawBusiness, deps: AnalyzeDeps = {}): Promise<SiteAnalysis> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const at = now().toISOString();
  const observations: Observation[] = [];
  const observe = (url: string, title: string | null, fact: string) => {
    observations.push({ id: `o${observations.length + 1}`, url, title, fact, at });
  };
  const socialSources = business.sourceUrls.filter((u) => SOCIAL_HOSTS.some((h) => hostOf(u) === h || hostOf(u).endsWith(`.${h}`)));
  const sourceUrl = business.sourceUrls[0] ?? "";

  if (!business.websiteUrl) {
    observe(sourceUrl, null, socialSources.length > 0 ? "No standalone website was found; the business is present on social media only." : "No standalone website was found for this business in the sources checked.");
    return { signals: emptySignals({ socialOnly: socialSources.length > 0, socialLinks: socialSources }), observations, contact: { email: null, phone: null }, note: "no website" };
  }

  const homeUrl = business.websiteUrl;
  const fixture = business.fixturePages;
  const getPage = async (url: string): Promise<FetchResult> => {
    if (fixture) {
      const body = fixture[url] ?? fixture[new URL(url).pathname] ?? null;
      return body === null ? { ok: false, reason: "status", status: 404 } : { ok: true, finalUrl: url, status: 200, body, truncated: false };
    }
    return (deps.fetchPage ?? ((u, k) => fetchPublicPage(u, { kind: k })))(url, "html");
  };

  const checked = validatePublicUrl(homeUrl);
  if (!checked.ok && !fixture) {
    observe(homeUrl, null, "The website address could not be checked (it is not a public web address).");
    return { signals: emptySignals(), observations, contact: { email: null, phone: null }, note: "analysis skipped: invalid website address" };
  }

  // robots.txt is respected: a site that asks automated visitors to stay out is not analysed.
  let robots: string | null = null;
  if (!fixture) {
    const origin = new URL(homeUrl).origin;
    const r = await (deps.fetchPage ?? ((u, k) => fetchPublicPage(u, { kind: k === "text" ? "text" : "html" })))(`${origin}/robots.txt`, "text");
    robots = r.ok ? r.body : null;
    if (robots !== null && !isAllowedByRobots(robots, new URL(homeUrl).pathname || "/")) {
      observe(homeUrl, null, "The website's robots.txt asks automated visitors not to read the homepage, so it was not analysed.");
      return { signals: emptySignals({ https: new URL(homeUrl).protocol === "https:" }), observations, contact: { email: null, phone: null }, note: "analysis skipped: blocked by robots.txt" };
    }
  }

  const home = await getPage(homeUrl);
  if (!home.ok) {
    const why = home.reason === "status" ? `answered with HTTP ${home.status}` : home.reason === "timeout" ? "did not respond in time" : home.reason === "blocked" ? "was not allowed to be contacted" : "could not be reached";
    observe(homeUrl, null, `The website ${why} when it was checked.`);
    return { signals: emptySignals({ httpStatus: home.status ?? null }), observations, contact: { email: null, phone: null }, note: `website unreachable (${home.reason})` };
  }

  const pages: Array<{ url: string; f: PageFindings }> = [{ url: home.finalUrl, f: analyzeHtml(home.body) }];
  const extras = pickExtraPages(pages[0].f, home.finalUrl, deps.extraPages ?? 3);
  for (const url of extras) {
    if (robots !== null && !isAllowedByRobots(robots, new URL(url).pathname)) continue;
    await sleep(250);
    const page = await getPage(url);
    if (page.ok) pages.push({ url: page.finalUrl, f: analyzeHtml(page.body) });
  }

  const any = (k: "cta" | "booking" | "quote" | "portfolio" | "hasForm") => pages.some((p) => p.f[k]);
  const f0 = pages[0].f;
  const contactLink = pages[0].f.anchors.some((a) => CONTACT_RE.test(`${a.label} ${a.href}`));
  const emails = [...new Set(pages.flatMap((p) => p.f.emails))];
  const phones = [...new Set(pages.flatMap((p) => p.f.phones))];
  const year = Math.max(0, ...pages.map((p) => p.f.copyrightYear ?? 0)) || null;
  const https = new URL(home.finalUrl).protocol === "https:";
  const signals: SiteSignals = {
    reachable: true,
    https,
    httpStatus: home.status,
    hasMobileViewport: f0.viewport,
    contactPageFound: contactLink,
    ctaFound: any("cta"),
    bookingFlowFound: any("booking"),
    quoteFlowFound: any("quote"),
    portfolioFound: any("portfolio"),
    formFound: any("hasForm"),
    socialOnly: false,
    socialLinks: [...new Set(pages.flatMap((p) => p.f.social))],
    copyrightYear: year,
    legacyMarkup: pages.some((p) => p.f.legacyMarkup),
    cms: pages.map((p) => p.f.cms).find(Boolean) ?? null,
    pagesChecked: pages.length,
  };

  const where = `${pages.length} page${pages.length === 1 ? "" : "s"} checked`;
  const title = f0.title;
  if (!https) observe(home.finalUrl, title, "The website is served over plain http (no https).");
  if (!f0.viewport) observe(home.finalUrl, title, "The homepage has no mobile viewport tag, which usually means it is not adapted to phones.");
  if (!signals.ctaFound) observe(home.finalUrl, title, `No call-to-action for a quote, booking or enquiry was found on the pages checked (${where}).`);
  if (!signals.quoteFlowFound && !signals.formFound) observe(home.finalUrl, title, `No quote request or enquiry form was found on the pages checked (${where}).`);
  if (!signals.bookingFlowFound) observe(home.finalUrl, title, `No booking or reservation link was found on the pages checked (${where}).`);
  if (!contactLink) observe(home.finalUrl, title, "No contact page link was found in the homepage navigation.");
  if (!signals.portfolioFound) observe(home.finalUrl, title, `No projects, gallery or references section was found on the pages checked (${where}).`);
  if (year !== null && year <= now().getUTCFullYear() - 3) observe(home.finalUrl, title, `The footer shows a copyright year of ${year}.`);
  if (signals.legacyMarkup) observe(home.finalUrl, title, "The pages use markup from older web practice (such as font tags, marquee or Flash).");
  if (!f0.metaDescription) observe(home.finalUrl, title, "The homepage has no meta description for search results.");
  if (home.truncated) observe(home.finalUrl, title, "The homepage was larger than the analysis limit, so only the first part was read.");
  if (signals.ctaFound && f0.viewport && https && observations.length === 0) observe(home.finalUrl, title, "No clear weaknesses were observed on the pages checked.");

  return { signals, observations, contact: { email: emails[0] ?? null, phone: phones[0] ?? null }, note: null };
}
