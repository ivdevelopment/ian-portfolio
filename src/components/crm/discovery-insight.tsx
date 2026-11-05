import { Badge, Panel } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth";
import { formatBrusselsDateTime } from "@/lib/preview/access-activity";
import { getInsightForProspect } from "@/lib/prospecting/service";
import { SCORE_CATEGORIES, SCORE_LABELS } from "@/lib/prospecting/types";

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/**
 * The research behind a prospect that came from the Prospect Finder. It reads the candidate record as it was when the prospect was added:
 * later searches never rewrite it. Renders nothing for prospects that were added any other way.
 */
export async function DiscoveryInsightPanel({ prospectId }: { prospectId: string }) {
  const { supabase } = await requireAdmin();
  const insight = await getInsightForProspect(supabase, prospectId);
  if (!insight) return null;
  return (
    <Panel
      title="Discovery insight"
      description={`Found by the Prospect Finder on ${formatBrusselsDateTime(insight.created_at)}. A prioritisation aid, not a measurement.`}
      actions={insight.synthetic ? <Badge tone="warn">Sample data</Badge> : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div>
          <p className="text-xs text-muted">Fit score</p>
          <p className="text-2xl font-medium tabular-nums">
            {insight.score} <span className="text-sm text-muted">/ 100</span>
          </p>
        </div>
        <div className="min-w-0 space-y-2 text-sm">
          {insight.opportunity && (
            <p>
              <span className="text-muted">Suggested service: </span>
              {insight.opportunity}
            </p>
          )}
          {insight.summary && <p className="text-muted">{insight.summary}</p>}
        </div>
      </div>
      <details className="mt-3 rounded-md border border-line bg-glass px-3 py-2 text-sm">
        <summary className="cursor-pointer select-none text-muted hover:text-ink">Score breakdown and evidence</summary>
        <ul className="mt-3 space-y-1.5 text-xs text-muted">
          {SCORE_CATEGORIES.map((c) => {
            const s = insight.breakdown[c];
            return s ? (
              <li key={c}>
                <span className="text-ink">{SCORE_LABELS[c]}</span> {s.score}/{s.max}: {s.reason}
              </li>
            ) : null;
          })}
        </ul>
        {insight.evidence.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-muted">
            {insight.evidence.map((e) => (
              <li key={e.id}>
                {e.fact} <span className="text-subtle">{host(e.url)} · {formatBrusselsDateTime(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </Panel>
  );
}
