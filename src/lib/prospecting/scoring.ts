import { verifiedEmail, verifiedPhone } from "./contact";
import { applyWebsiteCaps, defaultWebsiteState } from "./website-state";
import { SCORE_CATEGORIES, SCORE_LABELS, SCORE_MAX, type AnalyzedBusiness, type Observation, type ProviderAssessment, type QualifiedCandidate, type ScoreBreakdown, type ScoreCategory } from "./types";

/**
 * The score is a PRIORITISATION AID, not a measurement: six capped categories, each with a written reason and the evidence it rests on,
 * added up to 100. Nothing here pretends the number is scientific; it exists so the list can be sorted and so every point can be explained.
 */

/** Words that are opinions about a business rather than neutral observations. A reason using them is replaced, never shown. */
const DEROGATORY = /\b(terrible|awful|horrible|ugly|hideous|garbage|trash|bad business|incompeten\w*|amateur(ish)?|pathetic|sloppy|lazy|stupid|disaster|worthless)\b/i;

export function isDerogatory(text: string): boolean {
  return DEROGATORY.test(text);
}

const clampInt = (n: unknown, max: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.min(max, Math.max(0, v));
};

/** The deterministic, neutral reason used when a provider's wording is unusable or unsupported by evidence. */
const FALLBACK_REASON: Record<ScoreCategory, string> = {
  business_fit: "Fit with the services offered could not be supported by the observations.",
  website_need: "No clear website weakness was observed.",
  conversion_gap: "No clear gap in the enquiry flow was observed.",
  service_opportunity: "No specific service opportunity was supported by the observations.",
  local_relevance: "Local relevance was not established.",
  contactability: "No professional contact details were found.",
};

/**
 * Turns whatever a provider returned into a score that can be trusted structurally: every category present and capped at its maximum,
 * evidence ids that do not exist dropped, and a reason that is derogatory or has no supporting observation worth points removed
 * (points without evidence are not given, so a claim can never raise the score on its own).
 */
export function buildBreakdown(assessment: Pick<ProviderAssessment, "scores">, evidence: readonly Observation[], contactabilityScore: number): ScoreBreakdown {
  const known = new Set(evidence.map((o) => o.id));
  const out = {} as ScoreBreakdown;
  for (const category of SCORE_CATEGORIES) {
    const max = SCORE_MAX[category];
    const given = assessment.scores[category];
    const observations = (given?.observations ?? []).filter((id) => known.has(id));
    let score = clampInt(given?.score, max);
    let reason = (given?.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    // Points need evidence, except where the category is about the business itself rather than the site.
    const needsEvidence = category === "website_need" || category === "conversion_gap";
    if (!reason || isDerogatory(reason) || (needsEvidence && score > 0 && observations.length === 0)) {
      if (needsEvidence && score > 0 && observations.length === 0) score = 0;
      reason = FALLBACK_REASON[category];
      if (isDerogatory(given?.reason ?? "")) score = Math.min(score, Math.floor(max / 2));
    }
    out[category] = { score, max, reason, observations };
  }
  // Contactability is a fact about what was found, so it is computed from the facts and not taken from the provider.
  const contact = out.contactability;
  contact.score = clampInt(contactabilityScore, contact.max);
  contact.reason = contactabilityReason(contact.score);
  contact.observations = [];
  return out;
}

export const totalScore = (breakdown: ScoreBreakdown): number => SCORE_CATEGORIES.reduce((sum, c) => sum + breakdown[c].score, 0);

export function meetsThreshold(score: number, threshold: number): boolean {
  return score >= threshold;
}

/** Email 6, phone 2, a contact page 2: what a person could actually use to reach the business professionally. */
/** `trusted` is for the development sample data only (its `.invalid` addresses are placeholders by design); real businesses are always verified. */
export function contactabilityPoints(contact: { email: string | null; phone: string | null }, contactPageFound: boolean | null, trusted = false): number {
  const email = trusted ? contact.email : verifiedEmail(contact.email);
  const phone = trusted ? contact.phone : verifiedPhone(contact.phone);
  return (email ? 6 : 0) + (phone ? 2 : 0) + (contactPageFound ? 2 : 0);
}

function contactabilityReason(score: number): string {
  if (score >= 8) return "A professional email or phone number and a contact route were found.";
  if (score > 0) return "Some professional contact details were found.";
  return FALLBACK_REASON.contactability;
}

/** A neutral one-line version of a reason, for the short "Why this is interesting" list. */
export function reasonLines(breakdown: ScoreBreakdown, limit = 4): string[] {
  return SCORE_CATEGORIES.map((c) => ({ c, s: breakdown[c] }))
    .filter(({ s }) => s.score > 0 && !Object.values(FALLBACK_REASON).includes(s.reason))
    .sort((a, b) => b.s.score / b.s.max - a.s.score / a.s.max)
    .slice(0, limit)
    .map(({ s }) => s.reason);
}

/** Assembles a candidate from a provider's assessment, after validation. The evidence kept is only what a reason points at (plus nothing else). */
export function qualify(item: AnalyzedBusiness, assessment: ProviderAssessment): QualifiedCandidate {
  const { business, analysis } = item;
  // What is known about the business's website limits the website-dependent categories; the AI cannot exceed these caps.
  const websiteState = analysis.websiteState ?? defaultWebsiteState(business);
  const breakdown = applyWebsiteCaps(buildBreakdown(assessment, analysis.observations, contactabilityPoints(mergeContact(business, analysis), analysis.signals.contactPageFound, Boolean(business.synthetic))), websiteState);
  const cited = new Set(SCORE_CATEGORIES.flatMap((c) => breakdown[c].observations));
  const summary = isDerogatory(assessment.summary) ? "" : assessment.summary.replace(/\s+/g, " ").trim().slice(0, 600);
  const opportunity = isDerogatory(assessment.opportunity) ? "" : assessment.opportunity.replace(/\s+/g, " ").trim().slice(0, 280);
  // The statement about the website is always kept (it explains the caps), whether or not a reason cites it.
  const evidence = analysis.observations.filter((o) => cited.has(o.id) || o.websiteState !== undefined);
  // The AI's interpretation is kept as its own evidence line, labelled "ai", so an observation (listing, website) is never mistaken for it.
  const interpretationUrl = [business.websiteUrl, ...business.sourceUrls].find((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u));
  if (opportunity && interpretationUrl) {
    evidence.push({ id: "ai1", url: interpretationUrl.slice(0, 500), title: "Codex interpretation", fact: `Interpretation: ${opportunity}`.slice(0, 400), at: analysis.observations[0]?.at ?? new Date().toISOString(), origin: "ai" });
  }
  return {
    business: { ...business, ...mergeContact(business, analysis), websiteUrl: business.websiteUrl ?? analysis.discoveredUrl ?? null },
    score: totalScore(breakdown),
    breakdown,
    summary: summary || reasonLines(breakdown, 2).join(" "),
    opportunity: opportunity || "Not specified",
    evidence,
  };
}

/**
 * Contact details already known for the business win; the ones found on its own pages fill the gaps. Only VERIFIED details count: a placeholder
 * email ("gebruiker@domein.com") or an obviously fake phone number is treated as no email / no phone, never as a positive signal.
 */
export function mergeContact(business: Pick<AnalyzedBusiness["business"], "email" | "phone" | "synthetic">, analysis: AnalyzedBusiness["analysis"]) {
  if (business.synthetic) return { email: business.email ?? analysis.contact.email, phone: business.phone ?? analysis.contact.phone };
  return {
    email: verifiedEmail(business.email) ?? verifiedEmail(analysis.contact.email),
    phone: verifiedPhone(business.phone) ?? verifiedPhone(analysis.contact.phone),
  };
}

export { SCORE_LABELS };
