import { normalizeAddress, type MailRecord } from "./normalize";

export type ProspectEmail = { id: string; email: string | null };

/** Exact lookup by normalised email address. No fuzzy matching, no domains, no names. */
export function buildProspectIndex(prospects: readonly ProspectEmail[]): Map<string, string> {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const p of prospects) {
    const email = normalizeAddress(p.email);
    if (!email) continue;
    if (index.has(email) && index.get(email) !== p.id) ambiguous.add(email);
    else index.set(email, p.id);
  }
  // Two prospects sharing an address: never guess which one a message belongs to.
  for (const email of ambiguous) index.delete(email);
  return index;
}

/**
 * The prospect a message belongs to, or null. The other party decides: an incoming message belongs to its sender, an
 * outgoing one to the first matching recipient. The user's own mailbox never matches (a prospect cannot be you).
 */
export function matchProspect(message: Pick<MailRecord, "direction" | "from_address" | "to_addresses" | "cc_addresses">, index: ReadonlyMap<string, string>, mailbox: string): string | null {
  const own = normalizeAddress(mailbox);
  const pick = (addresses: readonly string[]) => {
    for (const a of addresses) {
      if (a === own) continue;
      const id = index.get(a);
      if (id) return id;
    }
    return null;
  };
  return message.direction === "incoming" ? pick([message.from_address]) : pick([...message.to_addresses, ...message.cc_addresses]);
}

/** Addresses that belong to more than one prospect. A message touching one of these is reported, never linked. */
export function findAmbiguousAddresses(prospects: readonly ProspectEmail[]): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const p of prospects) {
    const email = normalizeAddress(p.email);
    if (!email) continue;
    owners.set(email, (owners.get(email) ?? new Set()).add(p.id));
  }
  return new Set([...owners].filter(([, ids]) => ids.size > 1).map(([email]) => email));
}

/** The other party's addresses (never your own mailbox). */
export function counterpartAddresses(message: Pick<MailRecord, "direction" | "from_address" | "to_addresses" | "cc_addresses">, mailbox: string): string[] {
  const own = normalizeAddress(mailbox);
  return (message.direction === "incoming" ? [message.from_address] : [...message.to_addresses, ...message.cc_addresses]).filter((a) => a !== own);
}
