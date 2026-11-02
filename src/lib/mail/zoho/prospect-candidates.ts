import { websiteHost } from "@/lib/prospects/duplicates";
import { SHARED_DOMAINS } from "./candidates";
import { normalizeAddress, type MailRecord } from "./normalize";

/**
 * Prospect CANDIDATES: outgoing mail to an address no prospect has. Nothing here writes anything; it only decides what
 * is worth showing to a person. Conservative on purpose: a wrong candidate costs a click ("Ignore"), a wrong
 * automatic prospect would pollute the pipeline (which is why none is ever created without that click).
 */

export const MAX_CANDIDATE_MESSAGES = 20;
/** More recipients than this is a mailing, not outreach to one business. */
export const MAX_TO_RECIPIENTS = 5;

export type CandidateStatus = "pending" | "ignored" | "added";

const SYSTEM_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?)([-_.+].*)?$/;
const TEST_LOCAL = /^test([-_.+]?\d*|[-_.+].*)$/;
const TEST_DOMAIN = /(^|\.)(example\.(com|org|net)|test|invalid|localhost|example)$/;
const TEST_SUBJECT = /^\s*((re|fw|fwd)\s*:\s*)*(test|testmail|test mail|testbericht|proef)\b/i;

const domainOf = (address: string) => address.split("@")[1] ?? "";

/** Your own mailbox, or any address at your own domain (a colleague, an alias, a system sender): never a prospect. */
export function isInternalAddress(address: string, mailbox: string): boolean {
  const a = normalizeAddress(address);
  const own = normalizeAddress(mailbox);
  if (!a || a === own) return true;
  const ownDomain = domainOf(own);
  return Boolean(ownDomain) && !SHARED_DOMAINS.has(ownDomain) && domainOf(a) === ownDomain;
}

/** Addresses that are obviously not a business to pitch: no-reply and bounce senders, reserved test domains, "test@…". */
export function isSystemOrTestAddress(address: string): boolean {
  const a = normalizeAddress(address);
  const local = a.split("@")[0] ?? "";
  return SYSTEM_LOCAL.test(local) || TEST_LOCAL.test(local) || TEST_DOMAIN.test(domainOf(a));
}

export type CandidateRecipient = { address: string; displayName: string | null };

/**
 * The recipients of an UNMATCHED message that deserve a review, or [] with the reason. Only the message's To line counts
 * (a Cc is a bystander, never the person who was pitched).
 */
export function candidateRecipients(
  record: Pick<MailRecord, "direction" | "from_address" | "to_addresses" | "subject">,
  mailbox: string,
  names: ReadonlyMap<string, string> = new Map(),
): { recipients: CandidateRecipient[]; reason: string | null } {
  if (record.direction !== "outgoing") return { recipients: [], reason: "incoming mail never creates candidates" };
  if (record.subject && TEST_SUBJECT.test(record.subject)) return { recipients: [], reason: "test message" };
  const to = [...new Set(record.to_addresses.map(normalizeAddress))].filter(Boolean);
  if (to.length > MAX_TO_RECIPIENTS) return { recipients: [], reason: "sent to many recipients" };
  const external = to.filter((a) => !isInternalAddress(a, mailbox) && !isSystemOrTestAddress(a));
  if (external.length === 0) return { recipients: [], reason: "no external recipient" };
  return { recipients: external.map((address) => ({ address, displayName: names.get(address) ?? null })), reason: null };
}

/** One address's candidate as the sync found it: the messages seen (newest first) and the name from the header. */
export type CandidateDraft = { address: string; displayName: string | null; messages: MailRecord[] };

export type CandidateRow = {
  address: string;
  display_name: string | null;
  status: CandidateStatus;
  subject: string | null;
  first_message_at: string;
  last_message_at: string;
  message_count: number;
  messages: MailRecord[];
};

/**
 * What to store for a draft, given the row that already exists for the address (if any). Null means "leave it alone":
 * an ignored address stays ignored and an added one is a prospect now. A repeated sync adds only provider ids not seen
 * before, so it can never duplicate a message or inflate the count.
 */
export function mergeCandidate(existing: CandidateRow | null, draft: CandidateDraft): { row: CandidateRow; created: boolean } | null {
  if (existing && existing.status !== "pending") return null;
  const known = new Set((existing?.messages ?? []).map((m) => m.provider_message_id));
  const fresh = draft.messages.filter((m) => !known.has(m.provider_message_id));
  if (existing && fresh.length === 0) return null;
  const all = [...(existing?.messages ?? []), ...fresh].sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  const newest = all[0];
  const oldest = all[all.length - 1];
  return {
    created: !existing,
    row: {
      address: draft.address,
      display_name: existing?.display_name ?? draft.displayName,
      status: "pending",
      subject: newest?.subject ?? null,
      first_message_at: existing ? (existing.first_message_at < oldest.sent_at ? existing.first_message_at : oldest.sent_at) : oldest.sent_at,
      last_message_at: newest.sent_at,
      message_count: (existing?.message_count ?? 0) + fresh.length,
      messages: all.slice(0, MAX_CANDIDATE_MESSAGES),
    },
  };
}

/* ------------------------------- presentation ------------------------------- */

export type NameBasis = "header" | "domain" | "address";

/** A company name only where the evidence supports one: the recipient's display name, else a distinctive domain; otherwise the address itself. */
export function suggestName(address: string, displayName: string | null): { value: string; basis: NameBasis } {
  const name = (displayName ?? "").replace(/\s+/g, " ").trim();
  if (name && !name.includes("@")) return { value: name.slice(0, 200), basis: "header" };
  const domain = domainOf(normalizeAddress(address));
  if (domain && !SHARED_DOMAINS.has(domain)) {
    const parts = domain.split(".");
    const twoPartTld = parts.length >= 3 && ["co", "com", "org", "net"].includes(parts[parts.length - 2]);
    const label = twoPartTld ? parts[parts.length - 3] : parts[parts.length - 2];
    const words = (label ?? "").split(/[-_]+/).filter(Boolean);
    if (words.join("").length >= 3) return { value: words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").slice(0, 200), basis: "domain" };
  }
  return { value: address, basis: "address" };
}

export type RelatedProspect = { id: string; company: string; reason: "same email address" | "same email domain" | "website matches" };
type ProspectLike = { id: string; company_name: string; email: string | null; website_url: string | null };

/** Existing prospects that already use this address or its domain: shown as context, never as a reason to hide the candidate. */
export function relatedProspects(address: string, prospects: readonly ProspectLike[], limit = 3): RelatedProspect[] {
  const a = normalizeAddress(address);
  const domain = domainOf(a);
  const out: RelatedProspect[] = [];
  for (const p of prospects) {
    const email = normalizeAddress(p.email);
    if (email && email === a) out.push({ id: p.id, company: p.company_name, reason: "same email address" });
    else if (domain && !SHARED_DOMAINS.has(domain)) {
      if (email && domainOf(email) === domain) out.push({ id: p.id, company: p.company_name, reason: "same email domain" });
      else if (websiteHost(p.website_url) === domain.replace(/^www\./, "")) out.push({ id: p.id, company: p.company_name, reason: "website matches" });
    }
    if (out.length >= limit) break;
  }
  return out;
}
