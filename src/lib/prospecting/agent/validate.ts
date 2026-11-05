import { z } from "zod";
import { websiteHost } from "@/lib/prospects/duplicates";
import { isPlaceholderEmail, verifiedPhone } from "../contact";
import { validatePublicUrl } from "../public-fetch";
import { isDerogatory } from "../scoring";
import { FAILURE_KINDS } from "./messages";
import { SCORE_CATEGORIES, SCORE_MAX } from "../types";
import { CONVERSION_GAP_CAP, WEBSITE_NEED_CAP, type WebsiteState } from "../website-state";

/**
 * The server never trusts a result because it came from the agent. Everything a worker submits is re-validated here with the same rules the
 * in-process pipeline enforces (score caps, evidence for need/gap points, neutral wording, a public website address, the run's threshold), and
 * a candidate that fails any rule is dropped and counted, never stored. The database function adds the duplicate checks on top.
 */

const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullish().transform((v) => (v ? v : null));

const evidenceSchema = z.object({
  id: text(20).min(1),
  url: text(500).min(1),
  title: nullableText(200),
  fact: text(400).min(1),
  at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid time"),
  /** Where the fact comes from: the business listing (OpenStreetMap) or the business's own website. Older results have none. */
  origin: z.enum(["listing", "website", "ai"]).optional(),
  /** The one line that states what is known about the business's website (see website-state.ts). */
  websiteState: z.enum(["confirmed_website", "probable_website", "no_website_found", "unknown"]).optional(),
});

const categorySchema = z.object({ score: z.number().int().min(0), max: z.number().int().min(1), reason: text(300).min(1), observations: z.array(text(20)).max(10) });
const breakdownSchema = z.object(Object.fromEntries(SCORE_CATEGORIES.map((c) => [c, categorySchema])) as Record<(typeof SCORE_CATEGORIES)[number], typeof categorySchema>);

export const candidateSchema = z.object({
  company_name: text(200).min(1),
  website_url: nullableText(500),
  email: nullableText(320),
  phone: nullableText(60),
  city: nullableText(120),
  region: nullableText(120),
  industry: nullableText(120),
  score: z.number().int().min(0).max(100),
  score_breakdown: breakdownSchema,
  summary: text(1000),
  opportunity: text(300),
  evidence: z.array(evidenceSchema).max(30),
  source_urls: z.array(text(500)).max(10),
});
export type SubmittedCandidate = z.infer<typeof candidateSchema>;

export const duplicateSchema = z.object({ company_name: text(200).min(1), website_url: nullableText(500), email: nullableText(320), city: nullableText(120), duplicate_of: z.uuid().nullish(), duplicate_reason: text(200).nullish() });
export const seenSchema = z.object({ domain: text(253).min(1), outcome: z.enum(["candidate", "below_threshold", "duplicate", "unreachable", "skipped"]), score: z.number().int().min(0).max(100).nullish() });

const httpUrl = (value: string) => {
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password;
  } catch {
    return false;
  }
};

export type CandidateVerdict = { ok: true; row: Record<string, unknown> } | { ok: false; reason: string };

/** Semantic checks on top of the shape. Returns the row to store (with the domain computed here, not taken from the worker). */
export function checkCandidate(input: unknown, opts: { threshold: number }): CandidateVerdict {
  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "malformed candidate" };
  const c = parsed.data;
  if (/\(sample data\)/i.test(c.company_name)) return { ok: false, reason: "sample data is never accepted" };
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return { ok: false, reason: "invalid email" };
  // A placeholder address ("gebruiker@domein.com") is not a contact: the candidate is kept, without an email.
  if (c.email && isPlaceholderEmail(c.email)) c.email = null;
  if (c.phone && !verifiedPhone(c.phone)) c.phone = null;

  let sum = 0;
  for (const cat of SCORE_CATEGORIES) {
    const s = c.score_breakdown[cat];
    if (s.max !== SCORE_MAX[cat] || s.score > s.max) return { ok: false, reason: `score out of range (${cat})` };
    sum += s.score;
  }
  if (sum !== c.score) return { ok: false, reason: "score does not equal its breakdown" };
  if (c.score < opts.threshold) return { ok: false, reason: "below the run's minimum score" };

  const ids = c.evidence.map((e) => e.id);
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "duplicate evidence ids" };
  const known = new Set(ids);
  for (const cat of SCORE_CATEGORIES) if (c.score_breakdown[cat].observations.some((o) => !known.has(o))) return { ok: false, reason: "reason cites unknown evidence" };
  for (const cat of ["website_need", "conversion_gap"] as const) {
    const s = c.score_breakdown[cat];
    if (s.score > 0 && s.observations.length === 0) return { ok: false, reason: `${cat} points without evidence` };
  }
  // The missing-website signal is capped by how well the website question was settled; no assessment can exceed it.
  const state: WebsiteState = c.evidence.find((e) => e.websiteState)?.websiteState ?? (c.website_url ? "confirmed_website" : "unknown");
  if (c.score_breakdown.website_need.score > WEBSITE_NEED_CAP[state]) return { ok: false, reason: "website need exceeds the cap for what is known about the website" };
  if (c.score_breakdown.conversion_gap.score > CONVERSION_GAP_CAP[state]) return { ok: false, reason: "conversion gap exceeds the cap for what is known about the website" };
  const cap = (c.email ? 6 : 0) + (c.phone ? 2 : 0) + 2;
  if (c.score_breakdown.contactability.score > cap) return { ok: false, reason: "contactability exceeds the contact details found" };

  const words = [c.summary, c.opportunity, ...SCORE_CATEGORIES.map((cat) => c.score_breakdown[cat].reason)].join(" ");
  if (isDerogatory(words)) return { ok: false, reason: "opinionated wording" };

  for (const e of c.evidence) if (!httpUrl(e.url)) return { ok: false, reason: "evidence url is not http(s)" };
  for (const u of c.source_urls) if (!httpUrl(u)) return { ok: false, reason: "source url is not http(s)" };
  if (c.website_url && !validatePublicUrl(c.website_url).ok) return { ok: false, reason: "website is not a public address" };

  const domain = websiteHost(c.website_url) || null;
  return { ok: true, row: { ...c, domain, synthetic: false } };
}

/** The whole submission: shape first (a malformed envelope is a 400), then each candidate on its own. */
export const resultSchema = z.object({
  runId: z.uuid(),
  candidates: z.array(z.unknown()).max(50),
  duplicates: z.array(duplicateSchema).max(20).default([]),
  seen: z.array(seenSchema).max(100).default([]),
  final: z.object({
    status: z.enum(["completed", "partial", "cancelled"]),
    stage: text(80).min(1),
    counters: z.object({ raw_found: z.number().int().min(0), analyzed: z.number().int().min(0), qualified: z.number().int().min(0), duplicates_removed: z.number().int().min(0), skipped_cooldown: z.number().int().min(0) }),
    errors: z.array(text(200)).max(25).default([]),
    codexMs: z.number().int().min(0).default(0),
    codexCalls: z.number().int().min(0).default(0),
    failureKind: z.enum(FAILURE_KINDS).nullish(),
  }),
});
