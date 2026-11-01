/**
 * What the admin shows about a preview's access history. Always read from the preview row (never copied
 * elsewhere), and never shows a date that doesn't exist.
 */
export type PreviewAccess = {
  first_accessed_at: string | null;
  last_accessed_at: string | null;
  successful_access_count: number;
};

export type AccessSummary =
  | { viewed: false; label: "Never viewed"; count: 0 }
  | { viewed: true; label: "Viewed"; first: string; last: string; count: number };

export function summarizeAccess(p: PreviewAccess): AccessSummary {
  // The count is the authority; a missing timestamp can never be invented.
  if (p.successful_access_count <= 0 || !p.last_accessed_at) return { viewed: false, label: "Never viewed", count: 0 };
  return {
    viewed: true,
    label: "Viewed",
    first: p.first_accessed_at ?? p.last_accessed_at,
    last: p.last_accessed_at,
    count: Number(p.successful_access_count),
  };
}

/** "1 Nov 2026, 14:32" in Europe/Brussels. */
export function formatBrusselsDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** "Viewed 1 Nov 2026 at 14:32" / "Not viewed yet" (prospect page). */
export function describeAccess(p: PreviewAccess): string {
  const s = summarizeAccess(p);
  if (!s.viewed) return "Not viewed yet";
  return `Viewed ${formatBrusselsDateTime(s.last).replace(", ", " at ")}`;
}
