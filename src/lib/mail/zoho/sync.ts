import type { ZohoMailClient } from "./client";
import { buildProspectIndex, counterpartAddresses, findAmbiguousAddresses, matchProspect, type ProspectEmail } from "./match";
import { toMailRecord, type MailRecord } from "./normalize";
import { ZohoError } from "./oauth";

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
  /** Usable messages that matched no prospect (not stored). */
  unmatched: number;
  /** Messages whose other party's address belongs to two or more prospects: reported, never linked. */
  ambiguous: number;
  rateLimitRetries: number;
  /** Sizes of the result pages Zoho returned (proves pagination behaviour). */
  pages: number[];
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
  watched: Array<{ prospect_id: string; company?: string; outgoing: number; incoming: number; folders: string[] }>;
  /** A small sample of matches (dry run), for review before anything is stored. */
  preview: Array<{ prospect_id: string; direction: "incoming" | "outgoing"; subject: string | null; sent_at: string }>;
};

export function emptyReport(mode: SyncReport["mode"], windowFrom: string): SyncReport {
  return { mode, windowFrom, checked: 0, unique: 0, duplicateIds: 0, incoming: 0, outgoing: 0, unmatched: 0, ambiguous: 0, rateLimitRetries: 0, pages: [], sample: null, skippedUnusable: 0, matched: 0, alreadyStored: 0, stored: 0, errors: [], outgoingByFolder: {}, watched: [], preview: [] };
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
  const watchedMap = new Map<string, { prospect_id: string; outgoing: number; incoming: number; folders: Set<string> }>();
  const seen = new Set<string>();

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
        if (counterpartAddresses(record, mailbox).some((a) => ambiguousAddresses.has(a))) report.ambiguous++;
        else report.unmatched++;
        continue;
      }
      report.matched++;
      if (!report.sample && record.folder_id) report.sample = { messageId: record.provider_message_id, folderId: record.folder_id };
      if (record.direction === "outgoing") {
        const folder = (record.folder_id && options.folderNames?.get(record.folder_id)) || record.folder_id || "unknown";
        report.outgoingByFolder[folder] = (report.outgoingByFolder[folder] ?? 0) + 1;
      }
      if (options.watch?.has(prospectId)) {
        const w = watchedMap.get(prospectId) ?? { prospect_id: prospectId, outgoing: 0, incoming: 0, folders: new Set<string>() };
        w[record.direction]++;
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
  report.watched = [...watchedMap.values()].map((w) => ({ ...w, folders: [...w.folders].sort() }));
  return report;
}

/** After a rate-limit pause the run restarts: counts from the retry replace the partial ones; ids already stored are skipped by the store. */
function mergeReports(partial: SyncReport, retry: SyncReport): SyncReport {
  return { ...retry, stored: retry.stored + partial.stored, rateLimitRetries: partial.rateLimitRetries + retry.rateLimitRetries, errors: [...partial.errors, ...retry.errors] };
}
