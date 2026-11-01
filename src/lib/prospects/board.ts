import { PROSPECT_STATUSES, PRIORITY_LABELS, type ProspectPriority, type ProspectStatus } from "./constants";
import { classifyFollowUp, type FollowUpState } from "./dates";
import { summarizeAccess } from "@/lib/preview/access-activity";

/** The columns shown by default: the daily sales pipeline. */
export const BOARD_DEFAULT_COLUMNS: readonly ProspectStatus[] = [
  "new",
  "ready_to_contact",
  "contacted",
  "replied",
  "interested",
  "concept_sent",
  "quote_sent",
  "won",
];

/** Every other status. Available through "More columns" and always reachable through "Move to…". */
export const BOARD_SECONDARY_COLUMNS: readonly ProspectStatus[] = PROSPECT_STATUSES.filter((s) => !BOARD_DEFAULT_COLUMNS.includes(s));

/** A card carries only what the board shows. Preview facts are read from the linked preview, never copied. */
export type BoardCard = {
  id: string;
  company_name: string;
  sector: string | null;
  city: string | null;
  email: string | null;
  website_url: string | null;
  status: ProspectStatus;
  priority: ProspectPriority;
  next_follow_up_on: string | null;
  estimated_value_eur: number | null;
  last_activity_on: string | null;
  preview: null | { subdomain: string; viewed: boolean };
};

const PRIORITY_RANK: Record<ProspectPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/**
 * Order inside a column: overdue follow-ups first (the oldest first), then the nearest follow-up, then priority,
 * then the most recent activity; no follow-up sorts after dated ones. Deterministic (company, id as tie-breaks).
 */
export function compareBoardCards(a: BoardCard, b: BoardCard, today: string): number {
  const rank = (c: BoardCard) => {
    const s = classifyFollowUp(c.next_follow_up_on, today);
    return s.kind === "overdue" ? 0 : s.kind === "none" ? 2 : 1;
  };
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.next_follow_up_on !== b.next_follow_up_on && a.next_follow_up_on && b.next_follow_up_on) {
    return a.next_follow_up_on < b.next_follow_up_on ? -1 : 1;
  }
  if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  const la = a.last_activity_on ?? "";
  const lb = b.last_activity_on ?? "";
  if (la !== lb) return la > lb ? -1 : 1;
  return a.company_name.localeCompare(b.company_name) || a.id.localeCompare(b.id);
}

export type BoardColumn = {
  status: ProspectStatus;
  cards: BoardCard[];
  count: number;
  /** Sum of the estimates that exist. Null when no card here has one (a blank is never a zero-value deal). */
  value: number | null;
  withValue: number;
};

/** Every status gets a column (possibly empty), cards sorted by `compareBoardCards`. */
export function groupBoard(cards: readonly BoardCard[], today: string): Record<ProspectStatus, BoardColumn> {
  const columns = Object.fromEntries(
    PROSPECT_STATUSES.map((status) => [status, { status, cards: [], count: 0, value: null, withValue: 0 } as BoardColumn]),
  ) as Record<ProspectStatus, BoardColumn>;
  for (const card of cards) columns[card.status].cards.push(card);
  for (const column of Object.values(columns)) {
    column.cards.sort((a, b) => compareBoardCards(a, b, today));
    column.count = column.cards.length;
    const valued = column.cards.filter((c) => c.estimated_value_eur !== null);
    column.withValue = valued.length;
    column.value = valued.length > 0 ? valued.reduce((t, c) => t + (c.estimated_value_eur ?? 0), 0) : null;
  }
  return columns;
}

/**
 * Optimistic state: cards whose move is in flight are shown in their target column. Removing an override (a failed
 * save) puts the card back exactly where the server has it.
 */
export function applyOverrides(cards: readonly BoardCard[], overrides: Readonly<Record<string, ProspectStatus>>): BoardCard[] {
  return cards.map((c) => (overrides[c.id] && overrides[c.id] !== c.status ? { ...c, status: overrides[c.id] } : c));
}

/** "6 Nov" for a calendar day (no time zone shift). */
export function formatShortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** What the card's follow-up line says: "Overdue 2 days", "Today", "Tomorrow", "6 Nov". */
export function cardFollowUp(day: string | null, today: string): { text: string; state: FollowUpState } | null {
  if (!day) return null;
  const state = classifyFollowUp(day, today);
  const text =
    state.kind === "overdue"
      ? `Overdue ${state.days} ${state.days === 1 ? "day" : "days"}`
      : state.kind === "today"
        ? "Today"
        : state.kind === "tomorrow"
          ? "Tomorrow"
          : formatShortDay(day);
  return { text, state };
}

type PreviewEmbed = { subdomain: string; first_accessed_at: string | null; last_accessed_at: string | null; successful_access_count: number } | null;

/** Row from the board query (prospect + embedded preview) -> card. */
export function toBoardCard(row: Omit<BoardCard, "preview"> & { linked_preview: PreviewEmbed }): BoardCard {
  const { linked_preview, ...rest } = row;
  return {
    ...rest,
    preview: linked_preview ? { subdomain: linked_preview.subdomain, viewed: summarizeAccess(linked_preview).viewed } : null,
  };
}

export const priorityLabel = (p: ProspectPriority) => PRIORITY_LABELS[p];
