const TIME_ZONE = "Europe/Brussels";

export type ExpiryInput =
  | { kind: "keep" }
  | { kind: "never" }
  | { kind: "days"; days: 7 | 14 | 30 }
  | { kind: "date"; date: string };

/** 23:59:59 on `date` (YYYY-MM-DD) in Brussels time, as an ISO instant; null when the date is invalid. */
export function endOfDayBrussels(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  // Brussels is UTC+1 or UTC+2 depending on DST: take whichever offset renders as 23:59 that day.
  for (const offset of [2, 1]) {
    const candidate = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59) - offset * 3600_000);
    if (Number.isNaN(candidate.getTime())) return null;
    const parts = Object.fromEntries(fmt.formatToParts(candidate).map((p) => [p.type, p.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` === date && parts.hour === "23" && parts.minute === "59") {
      return candidate.toISOString();
    }
  }
  return null;
}

/** undefined = leave unchanged; null = never expires; string = ISO instant. */
export function resolveExpiry(input: ExpiryInput, now: Date): string | null | undefined {
  switch (input.kind) {
    case "keep":
      return undefined;
    case "never":
      return null;
    case "days":
      return new Date(now.getTime() + input.days * 86400_000).toISOString();
    case "date":
      return endOfDayBrussels(input.date);
  }
}

export type PreviewState = "active" | "disabled" | "expired";

export function previewState(p: { active: boolean; expires_at: string | null }, now: Date): PreviewState {
  if (!p.active) return "disabled";
  if (p.expires_at && new Date(p.expires_at).getTime() <= now.getTime()) return "expired";
  return "active";
}
