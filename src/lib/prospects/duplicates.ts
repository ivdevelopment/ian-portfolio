/** Likely-duplicate detection for imports and manual entry. Matching only: nothing is ever merged automatically. */

const LEGAL_SUFFIX = /\b(bv|bvba|sprl|srl|nv|sa|vzw|asbl|comm\s?v|cv|vof|gcv|ltd|llc|gmbh|inc)\b/g;

export function normalizeCompany(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " en ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** "https://www.Example.be/path" -> "example.be". Empty when it isn't an address. */
export function websiteHost(url: string | null | undefined): string {
  const text = (url ?? "").trim();
  if (!text) return "";
  try {
    const host = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export type DuplicateReason = "company" | "email" | "website";
export type Comparable = { company_name: string; email: string | null; website_url: string | null };
export type DuplicateMatch<T> = { match: T; reasons: DuplicateReason[] };

export function keysOf(p: Comparable) {
  return { company: normalizeCompany(p.company_name), email: normalizeEmail(p.email), host: websiteHost(p.website_url) };
}

/** Existing records that look like `candidate`, with the reasons why. */
export function findDuplicates<T extends Comparable>(candidate: Comparable, existing: readonly T[]): Array<DuplicateMatch<T>> {
  const c = keysOf(candidate);
  const out: Array<DuplicateMatch<T>> = [];
  for (const record of existing) {
    const k = keysOf(record);
    const reasons: DuplicateReason[] = [];
    if (c.company && c.company === k.company) reasons.push("company");
    if (c.email && c.email === k.email) reasons.push("email");
    if (c.host && c.host === k.host) reasons.push("website");
    if (reasons.length > 0) out.push({ match: record, reasons });
  }
  return out;
}

/** Row numbers (same order as the input) whose key matches an EARLIER row in the same batch. */
export function findBatchDuplicates(rows: readonly Comparable[]): Map<number, { of: number; reasons: DuplicateReason[] }> {
  const seen = { company: new Map<string, number>(), email: new Map<string, number>(), host: new Map<string, number>() };
  const out = new Map<number, { of: number; reasons: DuplicateReason[] }>();
  rows.forEach((row, i) => {
    const k = keysOf(row);
    const reasons: DuplicateReason[] = [];
    let first = -1;
    const check = (map: Map<string, number>, key: string, reason: DuplicateReason) => {
      if (!key) return;
      const earlier = map.get(key);
      if (earlier !== undefined) {
        reasons.push(reason);
        if (first === -1) first = earlier;
      } else map.set(key, i);
    };
    check(seen.company, k.company, "company");
    check(seen.email, k.email, "email");
    check(seen.host, k.host, "website");
    if (reasons.length > 0) out.set(i, { of: first, reasons });
  });
  return out;
}
