/**
 * Turning Zoho's message list entries into CRM-safe records: normalised addresses, plain-text snippets, a direction.
 * Only metadata and a short plain-text snippet are ever kept; HTML is reduced to text and never rendered.
 */

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
const decodeEntities = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);

export function normalizeAddress(address: string | null | undefined): string {
  return (address ?? "").trim().toLowerCase();
}

const EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Every address in a header-ish string: `"A" <a@x.be>, b@y.be`, HTML-escaped forms, "Not Provided". Deduplicated, lower case. */
export function parseAddressList(value: string | null | undefined): string[] {
  if (!value || /^not provided$/i.test(value.trim())) return [];
  const found = decodeEntities(value).match(EMAIL) ?? [];
  return [...new Set(found.map(normalizeAddress))];
}

/** Plain text from possibly-HTML content: scripts/styles/comments and every tag removed (so tracking pixels and links vanish), entities decoded. */
const stripMarkup = (s: string) =>
  s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, " ")
    .replace(/<[^>]*>/g, " ");

export function htmlToSafeText(input: string | null | undefined, max = 300): string {
  if (!input) return "";
  // Stripped, decoded, then stripped AGAIN: escaped markup (&lt;script&gt;) must not come back as markup.
  const text = stripMarkup(decodeEntities(stripMarkup(input)))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The slice of a Zoho message-list entry used here. Every field is optional: the provider is never trusted to be complete. */
export type ZohoMessage = {
  messageId?: string | number;
  threadId?: string | number;
  folderId?: string | number;
  sender?: string;
  fromAddress?: string;
  toAddress?: string;
  ccAddress?: string;
  subject?: string;
  summary?: string;
  receivedTime?: string | number;
  sentDateInGMT?: string | number;
};

export type MailRecord = {
  provider_message_id: string;
  provider_thread_id: string | null;
  folder_id: string | null;
  direction: "incoming" | "outgoing";
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  snippet: string | null;
  sent_at: string;
};

const msToIso = (v: string | number | undefined): string | null => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Null when the entry can't be used (no id, no sender or no usable time): it is skipped and counted, never guessed. */
export function toMailRecord(msg: ZohoMessage, mailbox: string): MailRecord | null {
  const id = msg.messageId === undefined || msg.messageId === null ? "" : String(msg.messageId).trim();
  const from = parseAddressList(msg.fromAddress)[0] ?? parseAddressList(msg.sender)[0] ?? "";
  const sentAt = msToIso(msg.sentDateInGMT) ?? msToIso(msg.receivedTime);
  if (!id || !from || !sentAt) return null;
  const subject = (msg.subject ?? "").replace(/\s+/g, " ").trim();
  const snippet = htmlToSafeText(msg.summary);
  return {
    provider_message_id: id.slice(0, 100),
    provider_thread_id: msg.threadId !== undefined && msg.threadId !== null && String(msg.threadId) !== "" ? String(msg.threadId).slice(0, 100) : null,
    folder_id: msg.folderId !== undefined && msg.folderId !== null ? String(msg.folderId).slice(0, 100) : null,
    direction: from === normalizeAddress(mailbox) ? "outgoing" : "incoming",
    from_address: from,
    to_addresses: parseAddressList(msg.toAddress),
    cc_addresses: parseAddressList(msg.ccAddress),
    subject: subject ? subject.slice(0, 998) : null,
    snippet: snippet || null,
    sent_at: sentAt,
  };
}
