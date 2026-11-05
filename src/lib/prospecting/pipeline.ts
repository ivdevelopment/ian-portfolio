import { analyzeWebsite, type AnalyzeDeps } from "./analyze";
import { businessKey, checkDuplicate, dropBatchDuplicates, type DedupeContext } from "./dedupe";
import { ProviderUnavailableError, type BusinessSource, type ProspectAIProvider } from "./providers/types";
import { meetsThreshold, qualify } from "./scoring";
import type { AnalyzedBusiness, DiscoveryRequest, QualifiedCandidate, RawBusiness } from "./types";

/**
 * The discovery pipeline, one stage after the other, each feeding the next through plain data:
 *
 *   discover -> dedupe (CRM, ignored, cooldown) -> analyse websites (deterministic) -> qualify (provider) -> threshold -> candidates
 *
 * It only ever PROPOSES: it writes candidate rows for a person to review and never creates or changes a prospect. One business that fails
 * (unreachable site, analysis skipped) is recorded and the run carries on; if the provider stops, what was already found is kept (partial).
 */

export const RAW_CAP = 60;
export const QUALIFY_BATCH = 5;
export const ANALYZE_CONCURRENCY = 3;

export type SeenOutcome = "candidate" | "below_threshold" | "duplicate" | "unreachable" | "skipped";

export type CandidateInsert = {
  kind: "candidate";
  candidate: QualifiedCandidate;
} | {
  kind: "duplicate";
  business: RawBusiness;
  duplicateOf: string;
  reason: string;
};

export type RunCounters = { raw_found: number; analyzed: number; qualified: number; duplicates_removed: number; skipped_cooldown: number };

export type PipelineStore = {
  /** Everything the dedupe rules compare against, read once at the start of the run. */
  context(): Promise<Omit<DedupeContext, "excludeResearched" | "now">>;
  /** Progress that the page shows while the run is going. */
  progress(patch: Partial<RunCounters> & { stage?: string; errors?: string[] }): Promise<void>;
  saveCandidates(rows: CandidateInsert[]): Promise<void>;
  markSeen(entries: Array<{ domain: string; outcome: SeenOutcome; score: number | null }>): Promise<void>;
};

export type PipelineDeps = {
  provider: ProspectAIProvider;
  /** Used when the provider cannot search the web itself. */
  source: BusinessSource | null;
  store: PipelineStore;
  analyze?: (business: RawBusiness) => Promise<AnalyzedBusiness["analysis"]>;
  analyzeDeps?: AnalyzeDeps;
  now?: () => Date;
  /** Checked between steps (never in the middle of one): true when the person cancelled the run or its time budget is used up. */
  shouldCancel?: () => "cancelled" | "deadline" | null;
};

export type RunOutcome = { status: "completed" | "partial" | "failed" | "cancelled"; stage: string; counters: RunCounters; errors: string[]; candidates: number };

const word = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function runPipeline(request: DiscoveryRequest, deps: PipelineDeps): Promise<RunOutcome> {
  const counters: RunCounters = { raw_found: 0, analyzed: 0, qualified: 0, duplicates_removed: 0, skipped_cooldown: 0 };
  const errors: string[] = [];
  const note = (message: string) => {
    if (errors.length < 25) errors.push(message.slice(0, 200));
  };
  const finish = async (status: RunOutcome["status"], stage: string): Promise<RunOutcome> => {
    await deps.store.progress({ ...counters, stage, errors }).catch(() => undefined);
    return { status, stage, counters, errors, candidates: counters.qualified };
  };
  const seen: Array<{ domain: string; outcome: SeenOutcome; score: number | null }> = [];
  const markSeen = (domain: string, outcome: SeenOutcome, score: number | null) => {
    if (domain) seen.push({ domain, outcome, score });
  };

  // 0. The provider must be able to run. If not, the pipeline stops here: no discovery, no fallback to anything else.
  const capabilities = await deps.provider.capabilities();
  if (!capabilities.available) {
    note(capabilities.reason ?? "The AI provider is not available.");
    return finish("failed", "AI provider not available");
  }

  try {
    // 1. Discovery
    await deps.store.progress({ stage: "Finding businesses…" });
    let found: RawBusiness[] = [];
    if (capabilities.supportsWebSearch && deps.provider.discoverBusinesses) found = await deps.provider.discoverBusinesses(request);
    else if (deps.source) found = await deps.source.discover(request);
    else note("No discovery source is available for this provider.");
    const batch = dropBatchDuplicates(found.slice(0, RAW_CAP));
    counters.raw_found = found.length;
    counters.duplicates_removed += batch.dropped;
    await deps.store.progress({ raw_found: counters.raw_found, duplicates_removed: counters.duplicates_removed });

    // 2. Duplicates, ignored businesses and the cooldown
    await deps.store.progress({ stage: "Checking duplicates…" });
    const context = { ...(await deps.store.context()), excludeResearched: request.excludeResearched, now: deps.now?.() };
    const fresh: RawBusiness[] = [];
    const duplicates: CandidateInsert[] = [];
    for (const business of batch.kept) {
      const verdict = checkDuplicate(business, context);
      if (verdict.kind === "new") fresh.push(business);
      else if (verdict.kind === "duplicate") {
        counters.duplicates_removed++;
        markSeen(businessKey(business), "duplicate", null);
        if (duplicates.length < 20) duplicates.push({ kind: "duplicate", business, duplicateOf: verdict.prospectId, reason: verdict.reason });
      } else if (verdict.kind === "cooldown") counters.skipped_cooldown++;
      else counters.duplicates_removed++;
    }
    if (duplicates.length > 0) await deps.store.saveCandidates(duplicates);
    await deps.store.progress({ duplicates_removed: counters.duplicates_removed, skipped_cooldown: counters.skipped_cooldown });

    // 3-5. Analyse, qualify and keep, in small batches so strong candidates appear while the run is still going.
    const analyzeOne = deps.analyze ?? ((b: RawBusiness) => analyzeWebsite(b, deps.analyzeDeps));
    let providerStopped = false;
    let stoppedBy: "cancelled" | "deadline" | null = null;
    for (let start = 0; start < fresh.length && counters.qualified < request.count && !providerStopped; start += QUALIFY_BATCH) {
      stoppedBy = deps.shouldCancel?.() ?? null;
      if (stoppedBy) break;
      const slice = fresh.slice(start, start + QUALIFY_BATCH);
      await deps.store.progress({ stage: `Analyzing ${word(fresh.length - start > QUALIFY_BATCH ? QUALIFY_BATCH : fresh.length - start, "website", "websites")}…` });
      const analyzed = await mapPool(slice, ANALYZE_CONCURRENCY, async (business): Promise<AnalyzedBusiness | null> => {
        try {
          const analysis = await analyzeOne(business);
          if (analysis.note) note(`${business.companyName}: ${analysis.note}`);
          return { business, analysis };
        } catch {
          note(`${business.companyName}: analysis skipped`);
          markSeen(businessKey(business), "skipped", null);
          return null;
        }
      });
      const usable = analyzed.filter((x): x is AnalyzedBusiness => x !== null);
      counters.analyzed += usable.length;
      for (const item of usable) if (!item.analysis.signals.reachable && item.business.websiteUrl) markSeen(businessKey(item.business), "unreachable", null);
      await deps.store.progress({ analyzed: counters.analyzed, errors });

      await deps.store.progress({ stage: "Qualifying candidates…" });
      let assessments;
      try {
        assessments = await deps.provider.qualifyBusinesses({ request, items: usable.filter((u) => u.analysis.signals.reachable || !u.business.websiteUrl) });
      } catch (error) {
        providerStopped = true;
        note(error instanceof ProviderUnavailableError ? error.message : "The AI provider stopped responding.");
        break;
      }
      const kept: CandidateInsert[] = [];
      for (const item of usable) {
        const assessment = assessments.find((a) => a.companyName === item.business.companyName && (a.websiteUrl ?? null) === (item.business.websiteUrl ?? null));
        if (!assessment) continue;
        const candidate = qualify(item, assessment);
        const domain = businessKey(item.business);
        if (meetsThreshold(candidate.score, request.threshold) && counters.qualified < request.count) {
          counters.qualified++;
          kept.push({ kind: "candidate", candidate });
          markSeen(domain, "candidate", candidate.score);
        } else markSeen(domain, "below_threshold", candidate.score);
      }
      if (kept.length > 0) await deps.store.saveCandidates(kept);
      await deps.store.progress({ qualified: counters.qualified });
    }

    await deps.store.markSeen(seen).catch(() => note("The research history could not be updated."));
    const stage = counters.qualified > 0 ? `${word(counters.qualified, "strong prospect", "strong prospects")} found` : "No candidates above the minimum score";
    if (stoppedBy === "cancelled") return finish("cancelled", counters.qualified > 0 ? `Cancelled: ${word(counters.qualified, "candidate", "candidates")} kept` : "Cancelled");
    if (stoppedBy === "deadline") {
      note("The time limit for this search was reached.");
      return finish("partial", stage);
    }
    return finish(providerStopped ? "partial" : "completed", stage);
  } catch (error) {
    note(error instanceof ProviderUnavailableError || (error instanceof Error && error.name === "SourceError") ? error.message : "The run stopped unexpectedly.");
    await deps.store.markSeen(seen).catch(() => undefined);
    return finish(counters.qualified > 0 ? "partial" : "failed", "Run stopped");
  }
}

/** Runs `fn` over `items` with at most `limit` at a time, keeping the input order. */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
