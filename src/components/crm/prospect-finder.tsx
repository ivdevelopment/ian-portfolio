"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cancelDiscoveryRunAction, getRunStatusAction, startDiscoveryAction, type RunStatus } from "@/crm/actions/prospecting";
import { NETWORK_ERROR } from "@/components/admin/use-action-runner";
import { adminInput } from "@/components/admin/ui";
import { DiscoveryCandidateCard, type CardOutcome } from "@/components/crm/discovery-candidate-card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { useAppPaths } from "@/lib/crm/paths-context";
import { failureMessage } from "@/lib/prospecting/agent/messages";
import { isActiveStatus, type CandidateView, type RunRow } from "@/lib/prospecting/service";
import { DEFAULT_AREA, DEFAULT_LOCATION, DEFAULT_THRESHOLD, MODE_INFO, SEARCH_MODES, type SearchMode } from "@/lib/prospecting/types";
import { usePendingAction } from "@/lib/use-pending-action";
import { cn } from "@/lib/utils";

type Sort = "score" | "newest" | "industry" | "location";
const POLL_MS = 2000;

const AREAS = ["Brugge + 30 km", "Brugge + 15 km", "West-Vlaanderen", "Oost-Vlaanderen", "Vlaanderen", "Heel België"];

/**
 * The search form, the live progress of a run and the candidates waiting for review. Progress comes from the run itself (the stage it is in
 * and its real counters), never from a made-up percentage.
 */
export function ProspectFinder({ ready, runs, candidates, duplicates, activeRunId = null }: { ready: boolean; runs: RunRow[]; candidates: CandidateView[]; duplicates: CandidateView[]; activeRunId?: string | null }) {
  const router = useRouter();
  const P = useAppPaths();
  const ids = { location: useId(), area: useId(), industry: useId(), count: useId(), threshold: useId(), sort: useId() };
  const { pending, run } = usePendingAction();

  const [mode, setMode] = useState<SearchMode>("redesign");
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [area, setArea] = useState(DEFAULT_AREA);
  const [industry, setIndustry] = useState("");
  const [count, setCount] = useState(MODE_INFO.redesign.defaultCount);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [exclude, setExclude] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A search that is still going when the page opens (a reload, another tab) is picked up again, not forgotten.
  const [runId, setRunId] = useState<string | null>(activeRunId);
  const [cancelling, setCancelling] = useState(false);
  const [live, setLive] = useState<NonNullable<RunStatus> | null>(null);
  const [finished, setFinished] = useState<string | null>(null);
  const [extra, setExtra] = useState<CandidateView[]>([]);
  const [outcomes, setOutcomes] = useState<CardOutcome[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>("score");
  const polling = useRef(false);

  const chooseMode = (m: SearchMode) => {
    setMode(m);
    setCount(MODE_INFO[m].defaultCount);
  };

  // While a run is going, ask for its progress every couple of seconds. The run keeps going on the server whether or not this page is open.
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    const tick = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const status = await getRunStatusAction(runId);
        if (stopped || !status) return;
        setLive(status);
        setExtra(status.candidates);
        if (!isActiveStatus(status.run.status)) {
          setFinished(status.run.stage ?? "Finished");
          setRunId(null);
          setCancelling(false);
          router.refresh();
        }
      } catch {
        /* a missed poll is fine: the next one will do */
      } finally {
        polling.current = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [runId, router]);

  const start = () =>
    run(async () => {
      setError(null);
      setFinished(null);
      setLive(null);
      try {
        const result = await startDiscoveryAction({ mode, location, area: area || null, industry: industry || null, count, threshold, excludeResearched: exclude });
        if (!result.ok) return setError(result.error);
        setRunId(result.runId);
      } catch {
        setError(NETWORK_ERROR);
      }
    });

  const running = runId !== null;
  const cancel = () =>
    run(async () => {
      if (!runId) return;
      setCancelling(true);
      try {
        const result = await cancelDiscoveryRunAction(runId);
        if (!result.ok) setError(result.error);
      } catch {
        setError(NETWORK_ERROR);
      }
    });
  const all = useMemo(() => {
    const byId = new Map<string, CandidateView>();
    for (const c of [...candidates, ...extra]) byId.set(c.id, c);
    const list = [...byId.values()].filter((c) => !removed.has(c.id));
    const cmp: Record<Sort, (a: CandidateView, b: CandidateView) => number> = {
      score: (a, b) => b.score - a.score,
      newest: (a, b) => b.created_at.localeCompare(a.created_at),
      industry: (a, b) => (a.industry ?? "~").localeCompare(b.industry ?? "~") || b.score - a.score,
      location: (a, b) => (a.city ?? "~").localeCompare(b.city ?? "~") || b.score - a.score,
    };
    return list.sort(cmp[sort]);
  }, [candidates, extra, removed, sort]);

  const done = (o: CardOutcome) => {
    setOutcomes((all) => [o, ...all.filter((x) => x.id !== o.id)]);
    setRemoved((r) => new Set(r).add(o.id));
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {ready && (
        <form
          className="rounded-card border border-line bg-surface p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!running) void start();
          }}
        >
          <h2 className="text-lg font-medium">Find new prospects</h2>
          <fieldset className="mt-3" disabled={running || pending}>
            <legend className="text-xs text-muted">Mode</legend>
            <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Search mode">
              {SEARCH_MODES.map((m) => (
                <label key={m} className={cn("cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors", mode === m ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:text-ink")}>
                  <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => chooseMode(m)} className="sr-only" />
                  {MODE_INFO[m].label}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-subtle">{MODE_INFO[mode].hint}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field id={ids.location} label="Location">
                <input id={ids.location} className={adminInput} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={160} required />
              </Field>
              <Field id={ids.area} label="Radius / area">
                <input id={ids.area} className={adminInput} value={area} onChange={(e) => setArea(e.target.value)} list={`${ids.area}-list`} maxLength={160} />
                <datalist id={`${ids.area}-list`}>
                  {AREAS.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </Field>
              <Field id={ids.industry} label={mode === "industry" ? "Industry" : "Industry (optional)"}>
                <input id={ids.industry} className={adminInput} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Any" maxLength={160} required={mode === "industry"} />
              </Field>
              <Field id={ids.count} label="Maximum results">
                <input id={ids.count} type="number" className={adminInput} min={1} max={MODE_INFO[mode].maxCount} value={count} onChange={(e) => setCount(Math.max(1, Math.min(MODE_INFO[mode].maxCount, Number(e.target.value) || 1)))} />
              </Field>
              <Field id={ids.threshold} label="Minimum score (0–100)">
                <input id={ids.threshold} type="number" className={adminInput} min={0} max={100} value={threshold} onChange={(e) => setThreshold(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                Skip businesses already researched
              </label>
            </div>
          </fieldset>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" icon="none" pending={pending || running} pendingLabel="Searching…" disabled={pending || running}>
              Find prospects
            </Button>
            <p className="text-xs text-subtle">Research only reads public pages. Nothing is contacted and nothing is added to the CRM until you choose.</p>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      )}

      {(running || live || finished) && (
        <div role="status" aria-live="polite" className="rounded-card border border-line bg-surface p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-medium">
              {running && <Spinner className="size-4" />}
              {live?.run.stage ?? (running ? "Starting…" : finished)}
            </p>
            {running && (
              <Button size="sm" variant="secondary" icon="none" pending={cancelling} pendingLabel="Cancelling…" disabled={cancelling || pending} onClick={() => void cancel()}>
                Cancel run
              </Button>
            )}
          </div>
          {!running && live && failureMessage(live.run.failure_kind) && (
            <p role="alert" className="mt-1 text-xs text-warn">
              {failureMessage(live.run.failure_kind)}
            </p>
          )}
          {live && (
            <p className="mt-1 text-xs text-muted">
              {live.run.raw_found} found · {live.run.duplicates_removed} already known · {live.run.analyzed} analysed · {live.candidates.length} {live.candidates.length === 1 ? "candidate" : "candidates"} so far
            </p>
          )}
          {live && live.run.errors.length > 0 && (
            <details className="mt-2 text-xs text-muted">
              <summary className="cursor-pointer">{live.run.errors.length} {live.run.errors.length === 1 ? "note" : "notes"} (skipped websites and similar)</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {live.run.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <section aria-labelledby="cand-h">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="cand-h" className="text-lg font-medium">
              Waiting for review {all.length > 0 && <span className="text-muted">({all.length})</span>}
            </h2>
            <p className="text-sm text-muted">Candidates are not prospects. Add the ones you want; ignored businesses are not suggested again.</p>
          </div>
          {all.length > 1 && (
            <div className="flex items-center gap-2">
              <label htmlFor={ids.sort} className="text-xs text-muted">
                Sort by
              </label>
              <select id={ids.sort} className={cn(adminInput, "h-9 w-auto")} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="score">Highest score</option>
                <option value="newest">Newest</option>
                <option value="industry">Industry</option>
                <option value="location">Location</option>
              </select>
            </div>
          )}
        </div>
        <div aria-live="polite" className="mt-2 space-y-1">
          {outcomes.map((o) => (
            <p key={o.id} className="text-sm text-muted">
              {o.text}{" "}
              {o.prospectId && (
                <Link href={P.prospect(o.prospectId)} className="text-accent underline-offset-4 hover:underline">
                  Open prospect
                </Link>
              )}
            </p>
          ))}
        </div>
        {all.length === 0 ? (
          <p className="mt-3 rounded-card border border-line p-4 text-sm text-subtle">{ready ? "No candidates waiting. Run a search to find some." : "No candidates waiting."}</p>
        ) : (
          <ul className="mt-3 space-y-3" aria-label="Prospect candidates">
            {all.map((c) => (
              <DiscoveryCandidateCard key={c.id} item={c} onDone={done} />
            ))}
          </ul>
        )}
      </section>

      {duplicates.length > 0 && (
        <details className="rounded-card border border-line p-4 text-sm">
          <summary className="cursor-pointer font-medium">Already in the CRM ({duplicates.length})</summary>
          <p className="mt-1 text-xs text-muted">Found again in the latest search but already known, so not proposed.</p>
          <ul className="mt-2 space-y-1">
            {duplicates.map((d) => (
              <li key={d.id} className="text-muted">
                <span className="text-ink">{d.company_name}</span>
                {d.city ? ` · ${d.city}` : ""} · {d.duplicate_reason}{" "}
                {d.duplicate_of && (
                  <Link href={P.prospect(d.duplicate_of)} className="text-accent underline-offset-4 hover:underline">
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <section aria-labelledby="hist-h">
        <h2 id="hist-h" className="text-lg font-medium">
          Recent searches
        </h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-subtle">No searches yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-card border border-line">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    {new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", day: "numeric", month: "short" }).format(new Date(r.started_at))}
                    <span className="font-normal text-muted"> · {r.location} · {MODE_INFO[r.mode].label}{r.industry ? ` · ${r.industry}` : ""}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {r.analyzed} analysed · {r.qualified} {r.qualified === 1 ? "candidate" : "candidates"} · min. score {r.threshold}
                    {r.provider === "mock" ? " · sample data" : ""}
                  </p>
                  {(r.status === "failed" || r.status === "partial") && failureMessage(r.failure_kind) && <p className="text-xs text-warn">{failureMessage(r.failure_kind)}</p>}
                </div>
                <span className={cn("text-xs", r.status === "failed" ? "text-danger" : r.status === "partial" ? "text-warn" : "text-subtle")}>{RUN_LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const RUN_LABEL: Record<RunRow["status"], string> = { queued: "Queued", claimed: "Picked up", discovering: "Running…", analyzing: "Running…", qualifying: "Running…", running: "Running…", completed: "Completed", partial: "Partial", failed: "Failed", cancelled: "Cancelled" };

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
