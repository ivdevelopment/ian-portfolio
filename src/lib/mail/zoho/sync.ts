import type { ZohoMailClient } from "./client";
import { buildProspectIndex, counterpartAddresses, findAmbiguousAddresses, matchProspect, type ProspectEmail } from "./match";
import { parseRecipientNames, toMailRecord, type MailRecord } from "./normalize";
import { ZohoError } from "./oauth";
import { candidateRecipients, mergeCandidate, type CandidateDraft, type CandidateRow } from "./prospect-candidates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Zoho's search syntax takes `fromDate:DD-MMM-YYYY` (https://www.zoho.com/mail/help/search-syntax.html). */
export function zohoSearchDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
}

/** One day of overlap on every incremental run so mail that arrived around the last sync is never missed (dedupe makes it free). */
export function incrementalStart(lastSyncDay: string | null, fallback: string): string {
  if (!lastSyncDay) return fallback;
  const [y, m, d] = lastSyncDay.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export interface MailStore {
  /** Provider ids that are already stored (so a re-run never duplicates). */
  existingIds(ids: readonly string[]): Promise<Set<string>>;
  save(records: ReadonlyArray<MailRecord & { prospect_id: string }>): Promise<void>;
  /** The candidate rows that already exist for these addresses (pending, ignored or added). Optional: without it nothing is proposed. */
  candidateRows?(addresses: readonly string[]): Promise<Map<string, CandidateRow>>;
  saveCandidates?(rows: readonly CandidateRow[]): Promise<void>;
}

export type SyncReport = {
  mode: "dry_run" | "sync";
  windowFrom: string;
  checked: number;
  /** Distinct provider message ids among the usable entries. */
  unique: number;
  /** The same provider id seen more than once in the scan. */
  duplicateIds: number;
  incoming: number;
  outgoing: number;
  /** Usable messages that matched no prospect (not stored). Includes mail that is not outreach (incoming, internal, test...). */
  unmatched: number;
  /** How many different prospects the matched messages belong to. */
  matchedProspects: number;
  /** Outgoing recipients that matched no prospect and are worth a review: NEW this run (a dry run: that would be new). Never a created prospect. */
  candidates: number;
  /** Recipients seen again that were already waiting for review (or decided): nothing new for them. */
  candidatesKnown: number;
  /** Total candidates waiting for review after this run (filled in by the service). */
  candidatesPending?: number;
  /** A small sample of the new candidates. */
  candidatePreview: Array<{ address: string; subject: string | null; sent_at: string }>;
  /** Messages whose other party's address belongs to two or more prospects: reported, never linked. */
  ambiguous: number;
  rateLimitRetries: number;
  /** Sizes of the result pages Zoho returned (proves pagination behaviour). */
  pages: number[];
  /** Dry run only, never stored: who the unmatched messages were with, so unmatched addresses can be reviewed. */
  unmatchedDetail?: Array<{ direction: "incoming" | "outgoing"; sent_at: string; from: string; to: string[]; cc: string[]; subject: string | null; ambiguous: boolean; candidate?: { prospect_id: string; company: string; reason: string; hasEmail: boolean } | null }>;
  /** Read-only capability evidence gathered by a dry run. */
  capabilities?: {
    folders: { ok: boolean; error: string | null; names: Record<string, string> };
    messageRead: { ok: boolean; error: string | null; fields: string[]; folderName: string | null };
    pagination: { ok: boolean; note: string };
  };
  /** The first matched message, used by the dry run to prove a single-message read works. */
  sample: { messageId: string; folderId: string } | null;
  skippedUnusable: number;
  matched: number;
  alreadyStored: number;
  stored: number;
  errors: string[];
  /** Matched OUTGOING messages per provider folder (names when the folder list could be read). */
  outgoingByFolder: Record<string, number>;
  /** For the prospects given in `watch`: how many outgoing messages to them exist, and in which folders. */
  watched: Array<{ prospect_id: string; company?: string; outgoing: number; incoming: number; folders: string[]; outgoingSample?: { messageId: string; folderId: string }; delivery?: string | null }>;
  /** A small sample of matches (dry run), for review before anything is stored. */
  preview: Array<{ prospect_id: string; direction: "incoming" | "outgoing"; subject: string | null; sent_at: string }>;
};

export function emptyReport(mode: SyncReport["mode"], windowFrom: string): SyncReport {
  return { mode, windowFrom, checked: 0, unique: 0, duplicateIds: 0, incoming: 0, outgoing: 0, unmatched: 0, matchedProspects: 0, candidates: 0, candidatesKnown: 0, candidatePreview: [], ambiguous: 0, rateLimitRetries: 0, pages: [], sample: null, skippedUnusable: 0, matched: 0, alreadyStored: 0, stored: 0, errors: [], outgoingByFolder: {}, watched: [], preview: [] };
}

export type SyncOptions = {
  client: ZohoMailClient;
  accountId: string;
  mailbox: string;
  prospects: readonly ProspectEmail[];
  store: MailStore;
  /** First day to search from (YYYY-MM-DD). */
  from: string;
  dryRun: boolean;
  maxMessages?: number;
  maxRateLimitRetries?: number;
  /** Prospects whose history should be reported individually (e.g. notes saying a message was only seen in Drafts). */
  watch?: ReadonlySet<string>;
  /** Folder id -> display name, when readable. */
  folderNames?: ReadonlyMap<string, string>;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Read-only mailbox window sync. Searches mail since `from`, keeps ONLY messages whose participants match a
 * prospect's known email, and stores their metadata. A dry run does everything except the write. Never throws for
 * provider trouble: problems end up in `errors` with whatever progress was made.
 */
export async function runSync(options: SyncOptions): Promise<SyncReport> {
  const { client, accountId, mailbox, prospects, store, from, dryRun } = options;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRateLimitRetries ?? 3;
  const index = buildProspectIndex(prospects);
  const ambiguousAddresses = findAmbiguousAddresses(prospects);
  const report = emptyReport(dryRun ? "dry_run" : "sync", from);
  const watchedMap = new Map<string, { prospect_id: string; outgoing: number; incoming: number; folders: Set<string>; outgoingSample?: { messageId: string; folderId: string } }>();
  const seen = new Set<string>();
  const matchedProspectIds = new Set<string>();
  const drafts = new Map<string, CandidateDraft>();

  const pages = client.searchAll(accountId, `fromDate:${zohoSearchDate(from)}`, { maxMessages: options.maxMessages });
  let retries = 0;
  for (;;) {
    let next: IteratorResult<Awaited<ReturnType<typeof client.searchMessages>>>;
    try {
      next = await pages.next();
    } catch (error) {
      if (error instanceof ZohoError && error.kind === "rate_limit" && retries < maxRetries) {
        retries++;
        report.rateLimitRetries++;
        await sleep(error.retryAfterMs ?? 5000 * retries);
        // The generator is finished after a throw, so resume from a fresh search that skips what was already seen.
        return mergeReports(report, await runSync({ ...options, maxRateLimitRetries: maxRetries - retries }));
      }
      report.errors.push(error instanceof ZohoError ? error.message : "Unexpected error while reading the mailbox.");
      break;
    }
    if (next.done) break;
    report.pages.push(next.value.length);

    const records: Array<MailRecord & { prospect_id: string }> = [];
    for (const raw of next.value) {
      report.checked++;
      const record = toMailRecord(raw, mailbox);
      if (!record) {
        report.skippedUnusable++;
        continue;
      }
      if (seen.has(record.provider_message_id)) {
        report.duplicateIds++;
        continue;
      }
      seen.add(record.provider_message_id);
      report.unique++;
      if (record.direction === "incoming") report.incoming++;
      else report.outgoing++;
      const prospectId = matchProspect(record, index, mailbox);
      if (!prospectId) {
        const isAmbiguous = counterpartAddresses(record, mailbox).some((a) => ambiguousAddresses.has(a));
        if (isAmbiguous) report.ambiguous++;
        else report.unmatched++;
        if (!isAmbiguous) {
          // Outgoing mail to someone no prospect has: remembered as a candidate for review, never as a prospect.
          const { recipients } = candidateRecipients(record, mailbox, parseRecipientNames(raw.toAddress));
          for (const r of recipients) {
            const draft = drafts.get(r.address) ?? { address: r.address, displayName: r.displayName, messages: [] };
            draft.displayName ??= r.displayName;
            draft.messages.push(record);
            drafts.set(r.address, draft);
          }
        }
        if (dryRun && (report.unmatchedDetail ??= []).length < 100) report.unmatchedDetail.push({ direction: record.direction, sent_at: record.sent_at, from: record.from_address, to: record.to_addresses, cc: record.cc_addresses, subject: record.subject, ambiguous: isAmbiguous });
        continue;
      }
      report.matched++;
      matchedProspectIds.add(prospectId);
      if (!report.sample && record.folder_id) report.sample = { messageId: record.provider_message_id, folderId: record.folder_id };
      if (record.direction === "outgoing") {
        const folder = (record.folder_id && options.folderNames?.get(record.folder_id)) || record.folder_id || "unknown";
        report.outgoingByFolder[folder] = (report.outgoingByFolder[folder] ?? 0) + 1;
      }
      if (options.watch?.has(prospectId)) {
        const w = watchedMap.get(prospectId) ?? { prospect_id: prospectId, outgoing: 0, incoming: 0, folders: new Set<string>() };
        w[record.direction]++;
        if (record.direction === "outgoing" && !w.outgoingSample && record.folder_id) w.outgoingSample = { messageId: record.provider_message_id, folderId: record.folder_id };
        w.folders.add((record.folder_id && options.folderNames?.get(record.folder_id)) || record.folder_id || "unknown");
        watchedMap.set(prospectId, w);
      }
      records.push({ ...record, prospect_id: prospectId });
      if (report.preview.length < 25) report.preview.push({ prospect_id: prospectId, direction: record.direction, subject: record.subject, sent_at: record.sent_at });
    }

    if (records.length === 0) continue;
    const existing = await store.existingIds(records.map((r) => r.provider_message_id));
    const fresh = records.filter((r) => !existing.has(r.provider_message_id));
    report.alreadyStored += records.length - fresh.length;
    if (!dryRun && fresh.length > 0) {
      try {
        await store.save(fresh);
        report.stored += fresh.length;
      } catch {
        report.errors.push("Some messages could not be saved.");
      }
    }
  }
  report.matchedProspects = matchedProspectIds.size;
  await proposeCandidates(report, drafts, options);
  report.watched = [...watchedMap.values()].map((w) => ({ ...w, folders: [...w.folders].sort() }));
  report.watched.sort((a, b) => a.prospect_id.localeCompare(b.prospect_id));
  return report;
}

/** Turns what the run saw into candidate rows. A dry run only counts them; nothing is ever turned into a prospect here. */
async function proposeCandidates(report: SyncReport, drafts: ReadonlyMap<string, CandidateDraft>, options: SyncOptions): Promise<void> {
  if (drafts.size === 0 || !options.store.candidateRows) return;
  try {
    const existing = await options.store.candidateRows([...drafts.keys()]);
    const toSave: CandidateRow[] = [];
    for (const draft of drafts.values()) {
      const merged = mergeCandidate(existing.get(draft.address) ?? null, draft);
      if (!merged?.created) {
        report.candidatesKnown++;
        if (merged) toSave.push(merged.row);
        continue;
      }
      report.candidates++;
      if (report.candidatePreview.length < 25) report.candidatePreview.push({ address: merged.row.address, subject: merged.row.subject, sent_at: merged.row.last_message_at });
      toSave.push(merged.row);
    }
    if (!options.dryRun && toSave.length > 0 && options.store.saveCandidates) await options.store.saveCandidates(toSave);
  } catch {
    report.errors.push("Prospect candidates could not be saved.");
  }
}

/** After a rate-limit pause the run restarts: counts from the retry replace the partial ones; ids already stored are skipped by the store. */
function mergeReports(partial: SyncReport, retry: SyncReport): SyncReport {
  return { ...retry, stored: retry.stored + partial.stored, rateLimitRetries: partial.rateLimitRetries + retry.rateLimitRetries, errors: [...partial.errors, ...retry.errors] };
}
