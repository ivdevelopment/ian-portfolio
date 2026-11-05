/**
 * The summary of the agent's local business data that the CRM shows ("Business data: Local Belgium index · updated 2 days ago"). It is a few
 * fields reported by the agent with each heartbeat: no filesystem paths and no business records ever leave the PC this way.
 */
export type BusinessDataSummary = {
  state: "ready" | "missing";
  /** Dataset name, for example "Geofabrik Belgium". */
  source?: string | null;
  /** ISO date the OpenStreetMap data was current. */
  data_date?: string | null;
  businesses?: number | null;
  freshness?: "fresh" | "aging" | "stale" | "unknown";
};

/** What the agent sends: camelCase, validated by the API before it reaches the database function. */
export type HeartbeatBusinessData = { state: "ready" | "missing"; source: string | null; dataDate: string | null; businesses: number | null; freshness: "fresh" | "aging" | "stale" | "unknown" };

export const FRESH_DAYS = 7;

function days(dataDate: string | null | undefined, now: number): number | null {
  if (!dataDate) return null;
  const t = Date.parse(dataDate);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
}

/** "Local Belgium index · updated 2 days ago" or "Not installed (run update-business-data on the agent PC)". */
export function businessDataLabel(data: BusinessDataSummary | null | undefined, now = Date.now()): string {
  if (!data) return "Not reported yet";
  if (data.state !== "ready") return "Not installed on the agent PC yet";
  const age = days(data.data_date, now);
  const when = age === null ? "date unknown" : age <= 0 ? "updated today" : age === 1 ? "updated 1 day ago" : `updated ${age} days ago`;
  return `Local Belgium index · ${when}`;
}

/** True when the data is older than a week: the CRM adds a quiet "refresh" hint. */
export const businessDataIsOld = (data: BusinessDataSummary | null | undefined, now = Date.now()): boolean => {
  if (!data || data.state !== "ready") return false;
  const age = days(data.data_date, now);
  return age !== null && age > FRESH_DAYS;
};
