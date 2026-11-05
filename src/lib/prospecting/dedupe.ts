import { createHash } from "node:crypto";
import { SHARED_DOMAINS } from "@/lib/mail/zoho/candidates";
import { normalizeCompany, normalizeEmail, websiteHost } from "@/lib/prospects/duplicates";
import type { RawBusiness } from "./types";

/**
 * Deterministic duplicate and cooldown rules, in this order. Nothing here is fuzzy and nothing is ever merged: a match only decides that a
 * business is not shown as new.
 *
 *   1. exact email                    (case-insensitive)
 *   2. website domain                 (normalised host, no "www"; also a prospect whose own email is at that domain, unless a shared provider)
 *   3. company name + locality        (both normalised, both present and equal)
 *   4. already ignored                (same domain or email as an ignored candidate: never rediscovered)
 *   5. cooldown                       (the domain was analysed in the last COOLDOWN_DAYS, whatever the outcome)
 */

/** A domain analysed within this many days is not analysed again (a below-threshold business is not a candidate, so this is what remembers it). */
export const COOLDOWN_DAYS = 60;

export type ProspectKey = { id: string; company_name: string; email: string | null; website_url: string | null; city: string | null };

/** SHA-256 of a normalised email. The local agent compares hashes, so it never receives a prospect's email address. */
export const emailHash = (email: string | null | undefined): string => createHash("sha256").update(normalizeEmail(email), "utf8").digest("hex");
export type KnownDomain = { domain: string; last_analyzed_at: string };

export type DedupeContext = {
  prospects: readonly ProspectKey[];
  /** Keys (domain or name+locality, see businessKey) and emails of candidates a person ignored. */
  ignored: { domains: ReadonlySet<string>; emails: ReadonlySet<string> };
  /** Keys of candidates that are already waiting for review: never proposed a second time. */
  pending?: ReadonlySet<string>;
  /** Email hashes (see emailHash) of CRM prospects, by prospect id: used instead of raw emails when the caller must not hold them. */
  emailHashes?: ReadonlyMap<string, { id: string; company_name: string }>;
  /** Email hashes of ignored candidates. */
  ignoredEmailHashes?: ReadonlySet<string>;
  seen: readonly KnownDomain[];
  excludeResearched: boolean;
  now?: Date;
};

export type DedupeVerdict =
  | { kind: "new" }
  | { kind: "duplicate"; prospectId: string; rule: "email" | "domain" | "company_locality"; reason: string }
  | { kind: "ignored"; reason: string }
  | { kind: "cooldown"; reason: string };

export const normalizeLocality = (city: string | null | undefined) => (city ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export const domainOfBusiness = (b: Pick<RawBusiness, "websiteUrl">): string => websiteHost(b.websiteUrl);

/**
 * The key a business is remembered by (cooldown, ignored, already waiting): its website domain, or, for a business without a website,
 * its normalised name and locality ("name:garageheyrick|brugge"). Without either there is nothing safe to remember it by.
 */
export function businessKey(b: Pick<RawBusiness, "websiteUrl" | "companyName" | "city">): string {
  const domain = domainOfBusiness(b);
  if (domain) return domain;
  const name = normalizeCompany(b.companyName);
  const locality = normalizeLocality(b.city);
  return name && locality ? `name:${name}|${locality}` : "";
}

const emailDomain = (email: string | null) => normalizeEmail(email).split("@")[1] ?? "";

export function checkDuplicate(business: Pick<RawBusiness, "companyName" | "websiteUrl" | "email" | "city">, ctx: DedupeContext): DedupeVerdict {
  const email = normalizeEmail(business.email);
  const domain = domainOfBusiness(business);
  const name = normalizeCompany(business.companyName);
  const locality = normalizeLocality(business.city);

  for (const p of ctx.prospects) {
    if (email && normalizeEmail(p.email) === email) return { kind: "duplicate", prospectId: p.id, rule: "email", reason: `Already in the CRM (same email as ${p.company_name})` };
  }
  const byHash = email ? ctx.emailHashes?.get(emailHash(email)) : undefined;
  if (byHash) return { kind: "duplicate", prospectId: byHash.id, rule: "email", reason: `Already in the CRM (same email as ${byHash.company_name})` };
  if (domain) {
    for (const p of ctx.prospects) {
      const prospectDomain = websiteHost(p.website_url);
      const prospectMailDomain = emailDomain(p.email);
      if (prospectDomain === domain || (prospectMailDomain === domain && !SHARED_DOMAINS.has(domain))) {
        return { kind: "duplicate", prospectId: p.id, rule: "domain", reason: `Already in the CRM (same website as ${p.company_name})` };
      }
    }
  }
  if (name && locality) {
    for (const p of ctx.prospects) {
      if (normalizeCompany(p.company_name) === name && normalizeLocality(p.city) === locality) {
        return { kind: "duplicate", prospectId: p.id, rule: "company_locality", reason: `Already in the CRM (${p.company_name}, same locality)` };
      }
    }
  }
  const key = businessKey(business);
  if ((key && ctx.ignored.domains.has(key)) || (email && (ctx.ignored.emails.has(email) || ctx.ignoredEmailHashes?.has(emailHash(email))))) return { kind: "ignored", reason: "Ignored earlier" };
  if (key && ctx.pending?.has(key)) return { kind: "cooldown", reason: "Already waiting for review" };
  if (ctx.excludeResearched && key) {
    const now = (ctx.now ?? new Date()).getTime();
    const hit = ctx.seen.find((s) => s.domain === key);
    if (hit && now - Date.parse(hit.last_analyzed_at) < COOLDOWN_DAYS * 86_400_000) return { kind: "cooldown", reason: `Researched in the last ${COOLDOWN_DAYS} days` };
  }
  return { kind: "new" };
}

/** Within one batch: the first business with a given domain or email wins, later ones are dropped. */
export function dropBatchDuplicates<T extends Pick<RawBusiness, "websiteUrl" | "email" | "companyName" | "city">>(items: readonly T[]): { kept: T[]; dropped: number } {
  const domains = new Set<string>();
  const emails = new Set<string>();
  const names = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const domain = domainOfBusiness(item);
    const email = normalizeEmail(item.email);
    const nameKey = normalizeCompany(item.companyName) && normalizeLocality(item.city) ? `${normalizeCompany(item.companyName)}|${normalizeLocality(item.city)}` : "";
    if ((domain && domains.has(domain)) || (email && emails.has(email)) || (nameKey && names.has(nameKey))) continue;
    if (domain) domains.add(domain);
    if (email) emails.add(email);
    if (nameKey) names.add(nameKey);
    kept.push(item);
  }
  return { kept, dropped: items.length - kept.length };
}
