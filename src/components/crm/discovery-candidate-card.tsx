"use client";

import { useState } from "react";
import { addDiscoveryCandidateAction, ignoreDiscoveryCandidateAction } from "@/crm/actions/prospecting";
import { NETWORK_ERROR } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import type { CandidateView } from "@/lib/prospecting/service";
import { SCORE_CATEGORIES, SCORE_LABELS } from "@/lib/prospecting/types";
import { websiteStateLabel } from "@/lib/prospecting/website-state";
import { formatBrusselsDateTime } from "@/lib/preview/access-activity";
import { usePendingAction } from "@/lib/use-pending-action";

export type CardOutcome = { id: string; text: string; prospectId?: string };

const isHttp = (u: string | null) => Boolean(u && /^https?:\/\//i.test(u));
const hostLabel = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/**
 * One qualified business, with the reasons it was proposed and the evidence behind them. Nothing here is a prospect yet: "Add prospect"
 * is the only way it becomes one, and it starts at Researching (a discovered business has not been contacted).
 */
export function DiscoveryCandidateCard({ item, onDone }: { item: CandidateView; onDone: (o: CardOutcome) => void }) {
  const { pending, run } = usePendingAction();
  const [active, setActive] = useState<"add" | "ignore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const place = [item.city, item.industry].filter(Boolean).join(" · ");
  // What is known about the business's website: confirmed, probable, no official website found, or just not listed (unconfirmed).
  const websiteState = item.evidence.find((e) => e.websiteState)?.websiteState ?? (item.website_url ? "confirmed_website" : "unknown");

  const decide = (kind: "add" | "ignore") =>
    run(async () => {
      setActive(kind);
      setError(null);
      try {
        if (kind === "add") {
          const result = await addDiscoveryCandidateAction(item.id);
          if (!result.ok) return setError(result.error);
          onDone({ id: item.id, text: `Added as prospect (Researching): ${result.company}.`, prospectId: result.prospectId });
        } else {
          const result = await ignoreDiscoveryCandidateAction(item.id);
          if (!result.ok) return setError(result.error);
          onDone({ id: item.id, text: `Ignored ${item.company_name}. It will not be suggested again.` });
        }
      } catch {
        setError(NETWORK_ERROR);
      } finally {
        setActive(null);
      }
    });

  return (
    <li className="rounded-card border border-line bg-surface p-4" aria-busy={pending}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-medium">{item.company_name}</h3>
          {place && <p className="mt-0.5 text-sm text-muted">{place}</p>}
          {item.synthetic && (
            <p className="mt-1">
              <Badge tone="warn">Sample data</Badge>
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">Fit score</p>
          <p className="text-xl font-medium tabular-nums">
            {item.score} <span className="text-sm text-muted">/ 100</span>
          </p>
        </div>
      </div>

      {item.reasons.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-muted">Why this is interesting</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {item.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {item.opportunity && (
        <p className="mt-3 text-sm">
          <span className="text-muted">Potential service: </span>
          {item.opportunity}
        </p>
      )}

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">Website</dt>
        <dd className="break-all">
          {item.website_url && (isHttp(item.website_url) && !item.synthetic ? <a href={item.website_url} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">{hostLabel(item.website_url)}</a> : hostLabel(item.website_url))}
          {item.website_url && <span className="text-muted"> · </span>}
          <span className={websiteState === "confirmed_website" ? "" : "text-muted"}>{websiteStateLabel(websiteState)}</span>
        </dd>
        {(item.email || item.phone) && (
          <>
            <dt className="text-muted">Contact</dt>
            <dd className="break-all">{[item.email, item.phone].filter(Boolean).join(" · ")}</dd>
          </>
        )}
      </dl>

      <details className="mt-3 rounded-md border border-line bg-glass px-3 py-2 text-sm">
        <summary className="cursor-pointer select-none text-muted hover:text-ink">Score breakdown and evidence</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-subtle">The score is a prioritisation aid, not a measurement. Each line below is a neutral observation with its source.</p>
          <ul className="space-y-2">
            {SCORE_CATEGORIES.map((c) => {
              const s = item.breakdown[c];
              if (!s) return null;
              return (
                <li key={c}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{SCORE_LABELS[c]}</span>
                    <span className="tabular-nums text-muted">
                      {s.score} / {s.max}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((s.score / s.max) * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted">{s.reason}</p>
                </li>
              );
            })}
          </ul>
          {item.evidence.length > 0 && (
            <div>
              <p className="text-xs font-medium text-ink">Evidence</p>
              <ul className="mt-1 space-y-1.5 text-xs text-muted">
                {item.evidence.map((e) => (
                  <li key={e.id}>
                    {e.origin && <span className="mr-1 rounded border px-1 py-px text-[10px] uppercase tracking-wide text-subtle">{e.origin === "listing" ? "Listing" : e.origin === "ai" ? "AI" : "Website"}</span>}
                    {e.fact}{" "}
                    <span className="text-subtle">
                      {isHttp(e.url) && !item.synthetic ? (
                        <a href={e.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                          {hostLabel(e.url)}
                        </a>
                      ) : (
                        e.url
                      )}{" "}
                      · {formatBrusselsDateTime(e.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {item.source_urls.length > 0 && <p className="text-xs text-subtle">Found via: {item.source_urls.map((u) => (isHttp(u) && !item.synthetic ? hostLabel(u) : u)).join(", ")}</p>}
        </div>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" icon="none" pending={active === "add"} pendingLabel="Adding…" disabled={pending} onClick={() => void decide("add")}>
          Add prospect
        </Button>
        <Button size="sm" variant="secondary" icon="none" pending={active === "ignore"} pendingLabel="Ignoring…" disabled={pending} onClick={() => void decide("ignore")}>
          Ignore
        </Button>
        {isHttp(item.website_url) && !item.synthetic && (
          <a href={item.website_url!} target="_blank" rel="noopener noreferrer" className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
            Open website ↗
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
