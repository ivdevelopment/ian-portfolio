import type { ZohoMailClient } from "./client";
import { buildProspectIndex, matchProspect, type ProspectEmail } from "./match";
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
  skippedUnusable: number;
  matched: number;
  alreadyStored: number;
  stored: number;
  errors: string[];
  /** A small sample of matches (dry run), for review before anything is stored. */
  preview: Array<{ prospect_id: string; direction: "incoming" | "outgoing"; subject: string | null; sent_at: string }>;
};

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
  const report: SyncReport = { mode: dryRun ? "dry_run" : "sync", windowFrom: from, checked: 0, skippedUnusable: 0, matched: 0, alreadyStored: 0, stored: 0, errors: [], preview: [] };
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
        await sleep(error.retryAfterMs ?? 5000 * retries);
        // The generator is finished after a throw, so resume from a fresh search that skips what was already seen.
        return mergeReports(report, await runSync({ ...options, maxRateLimitRetries: maxRetries - retries }));
      }
      report.errors.push(error instanceof ZohoError ? error.message : "Unexpected error while reading the mailbox.");
      break;
    }
    if (next.done) break;

    const records: Array<MailRecord & { prospect_id: string }> = [];
    for (const raw of next.value) {
      report.checked++;
      const record = toMailRecord(raw, mailbox);
      if (!record) {
        report.skippedUnusable++;
        continue;
      }
      if (seen.has(record.provider_message_id)) continue;
      seen.add(record.provider_message_id);
      const prospectId = matchProspect(record, index, mailbox);
      if (!prospectId) continue;
      report.matched++;
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
  return report;
}

/** After a rate-limit pause the run restarts: counts from the retry replace the partial ones; ids already stored are skipped by the store. */
function mergeReports(partial: SyncReport, retry: SyncReport): SyncReport {
  return { ...retry, stored: retry.stored + partial.stored, errors: [...partial.errors, ...retry.errors] };
}
