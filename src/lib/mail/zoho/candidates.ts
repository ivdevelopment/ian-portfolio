import { normalizeCompany, websiteHost } from "@/lib/prospects/duplicates";
import { normalizeAddress } from "./normalize";

/** Mail providers where the domain says nothing about the company. */
export const SHARED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "live.be", "hotmail.be", "yahoo.com", "icloud.com", "me.com",
  "telenet.be", "skynet.be", "proximus.be", "pandora.be", "belgacom.net", "msn.com", "outlook.be", "gmx.com", "protonmail.com", "proton.me",
]);

export type CandidateProspect = { id: string; company_name: string; email: string | null; website_url: string | null };

export type Candidate = { prospect_id: string; company: string; reason: "website host matches" | "domain equals company name"; hasEmail: boolean };

/** "info@garage-heyrick.be" -> "garageheyrick" (the registrable label without the TLD). */
export function domainLabel(address: string): string {
  const domain = normalizeAddress(address).split("@")[1] ?? "";
  const parts = domain.split(".");
  // Handle two-part TLDs such as co.uk / com.au conservatively: use the label before the public suffix.
  const label = parts.length >= 3 && ["co", "com", "org", "net"].includes(parts[parts.length - 2]) ? parts[parts.length - 3] : (parts[parts.length - 2] ?? "");
  return label.replace(/[^a-z0-9]/g, "");
}

/**
 * The prospect an unmatched address obviously belongs to, or null. Deterministic and strict:
 *   1. the address's domain IS the prospect's website host, or
 *   2. the domain's name equals the company's normalised name (garage-heyrick.be = "Garage Heyrick").
 * Shared mail providers never match, and when two prospects would qualify nothing is suggested. It only ever PROPOSES:
 * nothing is written.
 */
export function suggestProspect(address: string, prospects: readonly CandidateProspect[]): Candidate | null {
  const normalized = normalizeAddress(address);
  const domain = normalized.split("@")[1] ?? "";
  if (!domain || SHARED_DOMAINS.has(domain)) return null;

  const hits: Candidate[] = [];
  for (const p of prospects) {
    if (websiteHost(p.website_url) && websiteHost(p.website_url) === domain.replace(/^www\./, "")) {
      hits.push({ prospect_id: p.id, company: p.company_name, reason: "website host matches", hasEmail: Boolean(p.email) });
    } else {
      const label = domainLabel(normalized);
      const name = normalizeCompany(p.company_name);
      if (label.length >= 4 && label === name) hits.push({ prospect_id: p.id, company: p.company_name, reason: "domain equals company name", hasEmail: Boolean(p.email) });
    }
  }
  return hits.length === 1 ? hits[0] : null;
}
