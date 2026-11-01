import { describe, expect, it } from "vitest";
import {
  BOARD_DEFAULT_COLUMNS,
  BOARD_SECONDARY_COLUMNS,
  applyOverrides,
  cardFollowUp,
  compareBoardCards,
  formatShortDay,
  groupBoard,
  toBoardCard,
  type BoardCard,
} from "@/lib/prospects/board";
import { PROSPECT_STATUSES } from "@/lib/prospects/constants";
import { DEFAULT_FILTERS, applyProspectFilters, filtersToParams, parseFilters, type FilterBuilder } from "@/lib/prospects/filters";

const TODAY = "2026-11-02";
const card = (over: Partial<BoardCard> = {}): BoardCard => ({
  id: over.id ?? crypto.randomUUID(),
  company_name: "Co",
  sector: null,
  city: null,
  email: null,
  website_url: null,
  status: "contacted",
  priority: "normal",
  next_follow_up_on: null,
  estimated_value_eur: null,
  last_activity_on: null,
  preview: null,
  ...over,
});

describe("board columns", () => {
  it("shows the daily pipeline by default and keeps every other status reachable", () => {
    expect(BOARD_DEFAULT_COLUMNS).toEqual(["new", "ready_to_contact", "contacted", "replied", "interested", "concept_sent", "quote_sent", "won"]);
    expect([...BOARD_DEFAULT_COLUMNS, ...BOARD_SECONDARY_COLUMNS].sort()).toEqual([...PROSPECT_STATUSES].sort());
    expect(BOARD_SECONDARY_COLUMNS).toEqual(["researching", "follow_up_due", "meeting_planned", "lost", "not_interested", "no_response"]);
  });

  it("groups cards by their existing status and gives every status a column", () => {
    const cols = groupBoard([card({ status: "replied" }), card({ status: "replied" }), card({ status: "won" })], TODAY);
    expect(Object.keys(cols).sort()).toEqual([...PROSPECT_STATUSES].sort());
    expect(cols.replied.count).toBe(2);
    expect(cols.won.count).toBe(1);
    expect(cols.new.count).toBe(0);
  });

  it("totals only the estimates that exist: a blank is never a zero-value deal", () => {
    const cols = groupBoard(
      [card({ status: "quote_sent", estimated_value_eur: 1500 }), card({ status: "quote_sent", estimated_value_eur: 3000 }), card({ status: "quote_sent" }), card({ status: "contacted" })],
      TODAY,
    );
    expect(cols.quote_sent).toMatchObject({ count: 3, value: 4500, withValue: 2 });
    expect(cols.contacted).toMatchObject({ count: 1, value: null, withValue: 0 });
    expect(cols.won.value).toBeNull();
    // A genuine zero estimate is still a value.
    expect(groupBoard([card({ estimated_value_eur: 0 })], TODAY).contacted).toMatchObject({ value: 0, withValue: 1 });
  });
});

describe("card ordering", () => {
  const names = (cards: BoardCard[]) => groupBoard(cards, TODAY).contacted.cards.map((c) => c.company_name);

  it("puts overdue first (oldest first), then nearest follow-up, then no follow-up", () => {
    expect(
      names([
        card({ company_name: "none" }),
        card({ company_name: "later", next_follow_up_on: "2026-11-20" }),
        card({ company_name: "tomorrow", next_follow_up_on: "2026-11-03" }),
        card({ company_name: "overdue-2d", next_follow_up_on: "2026-10-31" }),
        card({ company_name: "overdue-5d", next_follow_up_on: "2026-10-28" }),
        card({ company_name: "today", next_follow_up_on: TODAY }),
      ]),
    ).toEqual(["overdue-5d", "overdue-2d", "today", "tomorrow", "later", "none"]);
  });

  it("breaks ties by priority, then the most recent activity, then name", () => {
    expect(
      names([
        card({ company_name: "low", priority: "low", next_follow_up_on: TODAY }),
        card({ company_name: "urgent", priority: "urgent", next_follow_up_on: TODAY }),
        card({ company_name: "normal-old", last_activity_on: "2026-10-01", next_follow_up_on: TODAY }),
        card({ company_name: "normal-new", last_activity_on: "2026-10-30", next_follow_up_on: TODAY }),
      ]),
    ).toEqual(["urgent", "normal-new", "normal-old", "low"]);
    expect(compareBoardCards(card({ id: "a", company_name: "A" }), card({ id: "b", company_name: "A" }), TODAY)).toBeLessThan(0);
  });
});

describe("follow-up on the card (Europe/Brussels days)", () => {
  it("says Overdue, Today, Tomorrow or the date, and nothing without a follow-up", () => {
    expect(cardFollowUp("2026-10-31", TODAY)?.text).toBe("Overdue 2 days");
    expect(cardFollowUp("2026-11-01", TODAY)?.text).toBe("Overdue 1 day");
    expect(cardFollowUp(TODAY, TODAY)?.text).toBe("Today");
    expect(cardFollowUp("2026-11-03", TODAY)?.text).toBe("Tomorrow");
    expect(cardFollowUp("2026-11-06", TODAY)?.text).toBe("6 Nov");
    expect(cardFollowUp(null, TODAY)).toBeNull();
    expect(formatShortDay("2026-12-31")).toBe("31 Dec");
  });
  it("never moves a card because a date passed", () => {
    const overdue = card({ status: "contacted", next_follow_up_on: "2026-10-01" });
    expect(groupBoard([overdue], TODAY).contacted.count).toBe(1);
    expect(groupBoard([overdue], TODAY).follow_up_due.count).toBe(0);
  });
});

describe("optimistic moves", () => {
  const a = card({ id: "a", status: "replied" });
  const b = card({ id: "b", status: "contacted" });

  it("shows a dragged card in its target column straight away", () => {
    const cols = groupBoard(applyOverrides([a, b], { a: "concept_sent" }), TODAY);
    expect(cols.concept_sent.cards.map((c) => c.id)).toEqual(["a"]);
    expect(cols.replied.count).toBe(0);
    expect(cols.contacted.count).toBe(1);
  });

  it("rolls back: dropping the override puts the card back where the server has it", () => {
    const overrides: Record<string, "concept_sent"> = { a: "concept_sent" };
    delete overrides.a;
    const cols = groupBoard(applyOverrides([a, b], overrides), TODAY);
    expect(cols.replied.cards.map((c) => c.id)).toEqual(["a"]);
    expect(cols.concept_sent.count).toBe(0);
  });

  it("does not touch cards that are not overridden, or overridden to where they already are", () => {
    const same = applyOverrides([a, b], { a: "replied" });
    expect(same[0]).toBe(a);
    expect(same[1]).toBe(b);
  });
});

describe("preview state on the card (read from the linked preview)", () => {
  const base = { ...card(), linked_preview: null };
  it("shows viewed, not viewed, or nothing", () => {
    expect(toBoardCard(base).preview).toBeNull();
    expect(toBoardCard({ ...base, linked_preview: { subdomain: "geertkips", first_accessed_at: null, last_accessed_at: null, successful_access_count: 0 } }).preview).toEqual({ subdomain: "geertkips", viewed: false });
    expect(
      toBoardCard({ ...base, linked_preview: { subdomain: "geertkips", first_accessed_at: "2026-11-01T05:46:00Z", last_accessed_at: "2026-11-01T05:49:00Z", successful_access_count: 2 } }).preview,
    ).toEqual({ subdomain: "geertkips", viewed: true });
  });
  it("is not copied into the prospect fields", () => {
    expect(Object.keys(toBoardCard(base))).not.toContain("linked_preview");
  });
});

describe("shared filters", () => {
  interface Recorder extends FilterBuilder<Recorder> {
    calls: Array<[string, ...unknown[]]>;
  }
  const recorder = (): Recorder => {
    const r = { calls: [] as Array<[string, ...unknown[]]> } as Recorder;
    for (const m of ["or", "eq", "in", "not", "is", "lt", "lte", "gt", "gte"] as const) {
      (r as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => (r.calls.push([m, ...args]), r);
    }
    return r;
  };

  it("filters on the preview's viewed state through the linked preview", () => {
    const yes = recorder();
    applyProspectFilters(yes, { ...DEFAULT_FILTERS, viewed: "yes" }, TODAY);
    expect(yes.calls).toContainEqual(["gt", "linked_preview.successful_access_count", 0]);
    const no = recorder();
    applyProspectFilters(no, { ...DEFAULT_FILTERS, viewed: "no" }, TODAY);
    expect(no.calls).toContainEqual(["eq", "linked_preview.successful_access_count", 0]);
  });

  it("keeps the board and the list on the same URL parameters", () => {
    const f = parseFilters(new URLSearchParams("viewed=0&sector=Bouw&priority=high&followup=overdue&q=geert"));
    expect(f).toMatchObject({ viewed: "no", sector: "Bouw", priority: "high", followup: "overdue", q: "geert" });
    expect(parseFilters(filtersToParams(f))).toEqual(f);
    expect(parseFilters({ viewed: "maybe" }).viewed).toBeNull();
  });
});
