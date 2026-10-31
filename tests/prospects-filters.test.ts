import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  applyProspectFilters,
  defaultDir,
  filtersToParams,
  hasActiveFilters,
  parseFilters,
  searchFilter,
  searchPattern,
  type FilterBuilder,
} from "@/lib/prospects/filters";
import { SORT_COLUMNS } from "@/lib/prospects/constants";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- self-referential builder type
interface Builder extends FilterBuilder<Builder> {}

/** Records the calls a filter makes, so the query it would send can be asserted without a database. */
function recorder() {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Builder = {
    or: (f) => (calls.push(["or", f]), builder),
    eq: (c, v) => (calls.push(["eq", c, v]), builder),
    in: (c, v) => (calls.push(["in", c, v]), builder),
    not: (c, o, v) => (calls.push(["not", c, o, v]), builder),
    is: (c, v) => (calls.push(["is", c, v]), builder),
    lt: (c, v) => (calls.push(["lt", c, v]), builder),
    lte: (c, v) => (calls.push(["lte", c, v]), builder),
    gt: (c, v) => (calls.push(["gt", c, v]), builder),
    gte: (c, v) => (calls.push(["gte", c, v]), builder),
  };
  return { builder, calls };
}
const TODAY = "2026-11-02"; // a Monday

describe("URL state", () => {
  it("round-trips filters through the query string, writing only non-defaults", () => {
    const filters = parseFilters(new URLSearchParams("status=contacted&followup=overdue&q=garage&replied=1&sort=follow_up&dir=asc&page=3&per=50"));
    expect(filters).toMatchObject({ status: "contacted", followup: "overdue", q: "garage", replied: true, sort: "follow_up", dir: "asc", page: 3, per: 50 });
    const params = filtersToParams(filters);
    expect(params.get("status")).toBe("contacted");
    expect(parseFilters(params)).toEqual(filters);
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("falls back to defaults for malformed values instead of throwing", () => {
    const f = parseFilters({ status: "bogus", priority: "x", followup: "never", sort: "drop table", dir: "up", page: "-4", per: "7" });
    expect(f).toMatchObject({ status: null, priority: null, followup: null, sort: "created", page: 1, per: 25 });
    expect(parseFilters({ page: "2.7" }).page).toBe(2);
    expect(parseFilters({ q: ["a", "b"] }).q).toBe("a");
  });

  it("knows when filters are active", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, preview: true })).toBe(true);
  });
});

describe("search", () => {
  it("searches company, email, contact, sector, city and website", () => {
    const filter = searchFilter("garage")!;
    for (const column of ["company_name", "email", "contact_name", "sector", "city", "website_url"]) expect(filter).toContain(`${column}.ilike."%garage%"`);
    expect(searchFilter("   ")).toBeNull();
  });

  it("cannot break out of the filter with commas, quotes, parentheses or wildcards", () => {
    // A quote is escaped for PostgREST; % and _ are escaped for LIKE and that backslash is itself doubled for PostgREST.
    expect(searchPattern('a,b)"c')).toBe('"%a,b)\\"c%"');
    expect(searchPattern("100%_done")).toBe('"%100\\\\%\\\\_done%"');
    expect(searchPattern("back\\slash")).toBe('"%back\\\\\\\\slash%"');
    const filter = searchFilter('x"),company_name.eq.secret')!;
    // The quote is escaped, so the whole input stays one ILIKE value.
    expect(filter).toContain('\\"');
  });
});

describe("applying filters", () => {
  it("applies exact filters and the has-replied / has-preview / has-project switches", () => {
    const { builder, calls } = recorder();
    applyProspectFilters(builder, { ...DEFAULT_FILTERS, status: "replied", sector: "Bouw", priority: "high", replied: true, preview: true, project: true }, TODAY);
    expect(calls).toContainEqual(["eq", "status", "replied"]);
    expect(calls).toContainEqual(["eq", "sector", "Bouw"]);
    expect(calls).toContainEqual(["eq", "priority", "high"]);
    expect(calls.find((c) => c[0] === "in")?.[1]).toBe("status");
    expect(calls).toContainEqual(["not", "linked_preview_id", "is", null]);
    expect(calls).toContainEqual(["not", "linked_project_id", "is", null]);
  });

  it("classifies follow-ups against Brussels today, ignoring closed prospects", () => {
    const run = (followup: "overdue" | "today" | "tomorrow" | "week" | "none") => {
      const { builder, calls } = recorder();
      applyProspectFilters(builder, { ...DEFAULT_FILTERS, followup }, TODAY);
      return calls;
    };
    expect(run("overdue")).toContainEqual(["lt", "next_follow_up_on", TODAY]);
    expect(run("today")).toContainEqual(["eq", "next_follow_up_on", TODAY]);
    expect(run("tomorrow")).toContainEqual(["eq", "next_follow_up_on", "2026-11-03"]);
    const week = run("week");
    expect(week).toContainEqual(["gte", "next_follow_up_on", TODAY]);
    expect(week).toContainEqual(["lte", "next_follow_up_on", "2026-11-08"]);
    expect(run("none")).toEqual([["is", "next_follow_up_on", null]]);
    expect(run("overdue")).toContainEqual(["not", "status", "in", "(won,lost,not_interested,no_response)"]);
  });
});

describe("sorting", () => {
  it("covers every sort the brief asks for, mapped to real columns", () => {
    expect(Object.keys(SORT_COLUMNS).sort()).toEqual(["company", "created", "estimated", "first_contact", "follow_up", "last_contact", "priority", "quote", "status"]);
    // Status and priority sort in pipeline order, not alphabetically.
    expect(SORT_COLUMNS.status).toBe("status_order");
    expect(SORT_COLUMNS.priority).toBe("priority_order");
  });
  it("starts text sorts ascending and chronological/amount sorts descending", () => {
    expect(defaultDir("company")).toBe("asc");
    expect(defaultDir("follow_up")).toBe("asc");
    expect(defaultDir("created")).toBe("desc");
    expect(defaultDir("estimated")).toBe("desc");
  });
});
