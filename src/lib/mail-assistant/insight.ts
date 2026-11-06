import type { InsightInput } from "./types";

/**
 * Which of the Prospect Finder's findings may reach a mail draft. Only what a person looking at the business could have noticed: observations about
 * the website's enquiry or booking flow, plus the suggested service. Listing facts (OpenStreetMap, distance), the AI's own interpretation, technical
 * page details and anything that reads like analysis are left out, so the draft can sound like Ian looked at the business himself.
 */
const NOT_FOR_A_MAIL = /openstreetmap|\bosm\b|search cent(re|er)|km from|robots\.txt|could not be (checked|reached)|not allowed to be contacted|no clear weaknesses|meta description|copyright year|markup|mobile viewport|plain http|\bhttp\b|\bscore\b|\bAI\b|listing|interpretation:/i;

export type EvidenceInput = { fact: string; origin?: string | null };

/**
 * Candidates stored by earlier versions carry no `origin`: it is then inferred from the fact itself. "Listed in OpenStreetMap ..." is the
 * business listing, "Interpretation: ..." is the model's own line, everything else is an observation about the website.
 */
export function originOf(e: EvidenceInput): "listing" | "website" | "ai" {
  if (e.origin === "listing" || e.origin === "website" || e.origin === "ai") return e.origin;
  if (/^interpretation:/i.test(e.fact)) return "ai";
  if (/^listed in openstreetmap|search cent(re|er)|km from the search/i.test(e.fact)) return "listing";
  return "website";
}

/** "... on the pages checked (3 pages checked)." is analysis bookkeeping, not something to say to a business. */
const tidy = (fact: string) => fact.replace(/\s*\(\d+ pages? checked\)/gi, "").replace(/\s+/g, " ").trim();

export function insightFromCandidate(c: { summary: string | null; opportunity: string | null; evidence: readonly EvidenceInput[]; synthetic: boolean } | null): InsightInput | null {
  if (!c || c.synthetic) return null;
  const clean = (t: string | null) => (t && !NOT_FOR_A_MAIL.test(t) ? t : null);
  const observations = c.evidence.filter((e) => originOf(e) === "website" && !NOT_FOR_A_MAIL.test(e.fact)).map((e) => tidy(e.fact)).slice(0, 4);
  return { summary: clean(c.summary), opportunity: clean(c.opportunity), observations };
}
