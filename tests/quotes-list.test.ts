import { describe, expect, it } from "vitest";
import { brusselsDayEndIso, brusselsDayStartIso, likePattern, parseQuoteFilters, quoteFiltersToParams, quoteSearchFilter } from "@/lib/quotes/filters";
import { DEFAULT_SETTINGS, formFromQuote, itemFromTemplate, newQuoteForm } from "@/lib/quotes/form";
import { mergeTimeline } from "@/lib/mail/timeline";
import { latestActiveQuote, summarizeQuotes } from "@/lib/quotes/metrics";
import { calculateForm, emptyItem, emptyQuoteForm } from "@/lib/quotes/schema";
import { quoteTotals, storedTotalsMatch } from "@/lib/quotes/summary";
import { toQuoteRecord, type QuoteItemRow, type QuoteRow } from "@/lib/quotes/types";

describe("list filters", () => {
  it("falls back to defaults for anything malformed", () => {
    const f = parseQuoteFilters({ status: "bogus", sort: "drop table", page: "-4", from: "2026-13-40", prospect: "not-a-uuid", dir: "sideways" });
    expect(f).toMatchObject({ status: "", sort: "created", dir: "desc", page: 1, from: "", prospect: "" });
  });

  it("round-trips through the URL and keeps it short", () => {
    const id = "43dfaeac-817d-43e1-a5a1-f240db8fa0a7";
    const f = parseQuoteFilters({ q: " geert ", status: "sent", prospect: id, from: "2026-11-01", to: "2026-11-30", sort: "total", dir: "asc", page: "3" });
    expect(f).toMatchObject({ q: "geert", status: "sent", prospect: id, sort: "total", dir: "asc", page: 3 });
    expect(parseQuoteFilters(Object.fromEntries(quoteFiltersToParams(f)))).toEqual(f);
    expect(quoteFiltersToParams(parseQuoteFilters({})).toString()).toBe("");
  });

  it("takes the first value of a repeated parameter and caps the search length", () => {
    expect(parseQuoteFilters({ status: ["sent", "draft"] }).status).toBe("sent");
    expect(parseQuoteFilters({ q: "x".repeat(500) }).q).toHaveLength(100);
  });

  it("searches number, client, company and title, and matching prospects", () => {
    const filter = quoteSearchFilter("kips", ["p1", "p2"])!;
    for (const column of ["quote_number", "client_name", "client_company", "title"]) expect(filter).toContain(`${column}.ilike."%kips%"`);
    expect(filter).toContain("prospect_id.in.(p1,p2)");
    expect(quoteSearchFilter("   ")).toBeNull();
  });

  it("treats % and _ as literal text", () => {
    expect(quoteSearchFilter("50%")).toContain(String.raw`"%50\\%%"`);
    expect(likePattern(String.raw`a_b%c\d`)).toBe(String.raw`%a\_b\%c\\d%`);
  });

  it("finds exact Brussels day boundaries in winter and summer", () => {
    expect(brusselsDayStartIso("2026-11-01")).toBe("2026-10-31T23:00:00.000Z"); // CET (+1)
    expect(brusselsDayStartIso("2026-07-15")).toBe("2026-07-14T22:00:00.000Z"); // CEST (+2)
    expect(brusselsDayEndIso("2026-11-01")).toBe("2026-11-01T23:00:00.000Z");
    // The night the clocks change: the day has 25 hours.
    expect(brusselsDayStartIso("2026-10-25")).toBe("2026-10-24T22:00:00.000Z");
    expect(brusselsDayEndIso("2026-10-25")).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("dashboard metrics", () => {
  const row = (status: Parameters<typeof summarizeQuotes>[0][number]["status"], net: number, validUntil: string | null = "2026-12-31") => ({ status, validUntil, netCents: net, totalCents: Math.round(net * 1.21) });

  it("buckets by status and counts only ready + sent as open", () => {
    const m = summarizeQuotes([row("draft", 1000), row("ready", 2000), row("sent", 4000), row("accepted", 8000), row("rejected", 16000), row("cancelled", 32000)], "2026-11-01");
    expect(m.draft).toEqual({ count: 1, netCents: 1000 });
    expect(m.ready).toEqual({ count: 1, netCents: 2000 });
    expect(m.sent).toEqual({ count: 1, netCents: 4000 });
    expect(m.accepted).toEqual({ count: 1, netCents: 8000 });
    expect(m.open).toEqual({ count: 2, netCents: 6000 });
  });

  it("rejected and cancelled never enter any bucket", () => {
    const m = summarizeQuotes([row("rejected", 999), row("cancelled", 999)], "2026-11-01");
    expect(Object.values(m).every((b) => b.count === 0 && b.netCents === 0)).toBe(true);
  });

  it("a sent quote past its validity is expired, not open", () => {
    const m = summarizeQuotes([row("sent", 5000, "2026-10-31"), row("sent", 3000, "2026-11-01")], "2026-11-01");
    expect(m.expired).toEqual({ count: 1, netCents: 5000 });
    expect(m.sent).toEqual({ count: 1, netCents: 3000 });
    expect(m.open).toEqual({ count: 1, netCents: 3000 });
  });
});

const now = "2026-11-01T10:00:00+00:00";
const quoteRow = (over: Partial<QuoteRow> = {}): QuoteRow =>
  ({
    id: "q1", quote_number: "Q-2026-0001", prospect_id: null, project_id: null, status: "draft", status_note: null, language: "nl",
    client_name: "Geert Kips", client_company: null, client_email: null, client_address: null, title: "Website", intro: null, notes: null, terms: null,
    currency: "EUR", discount_type: "none", discount_value: 0, subtotal: 249.5, discount_total: 0, tax_total: 44.97, total: 294.47, valid_until: "2026-11-15",
    created_at: now, updated_at: now, sent_at: null, accepted_at: null, rejected_at: null, ...over,
  }) as QuoteRow;
const itemRow = (position: number, over: Partial<QuoteItemRow>): QuoteItemRow =>
  ({ id: `i${position}`, quote_id: "q1", position, template_id: null, title: "Line", description: null, quantity: 1, unit: null, unit_price: 100, discount_percent: 0, tax_rate: 21, line_subtotal: 100, quote_discount_share: 0, line_tax: 21, line_total: 121, created_at: now, ...over }) as QuoteItemRow;

describe("saved quotes", () => {
  const items = [
    itemRow(1, { title: "Hosting", unit_price: 49.5, tax_rate: 6, line_subtotal: 49.5, line_tax: 2.97, line_total: 52.47 }),
    itemRow(0, { title: "Design", quantity: 2, unit_price: 100, line_subtotal: 200, line_tax: 42, line_total: 242 }),
  ];

  it("maps rows to cents and orders the lines", () => {
    const q = toQuoteRecord(quoteRow(), items);
    expect(q).toMatchObject({ number: "Q-2026-0001", totalCents: 29447, subtotalCents: 24950, taxCents: 4497, discountCents: 0 });
    expect(q.items.map((i) => [i.title, i.quantity, i.unitPriceCents, i.taxRate, i.totalCents])).toEqual([
      ["Design", "2", 10000, 21, 24200],
      ["Hosting", "1", 4950, 6, 5247],
    ]);
  });

  it("recalculating a saved quote gives the stored figures", () => {
    const q = toQuoteRecord(quoteRow(), items);
    expect(storedTotalsMatch(q)).toBe(true);
    expect(quoteTotals(q).vat).toEqual([
      { rate: 6, base: 4950, tax: 297 },
      { rate: 21, base: 20000, tax: 4200 },
    ]);
  });

  it("loads into the builder and calculates the same totals as the server", () => {
    const form = formFromQuote(toQuoteRecord(quoteRow(), items));
    expect(form.items.map((i) => [i.title, i.quantity, i.unitPrice, i.taxRate, i.discountPercent])).toEqual([
      ["Design", "2", "100.00", "21", ""],
      ["Hosting", "1", "49.50", "6", ""],
    ]);
    expect(calculateForm(form).totals?.total).toBe(29447);
  });
});

describe("new quote defaults", () => {
  it("prefills from a prospect without inventing an address", () => {
    const form = newQuoteForm({ ...DEFAULT_SETTINGS, defaultIntro: "Hallo", defaultTerms: "Voorwaarden" }, { id: "p1", companyName: "Garage Heyrick", contactName: "Jan Heyrick", email: "info@garage.be" });
    expect(form).toMatchObject({ prospectId: "p1", clientName: "Jan Heyrick", clientCompany: "Garage Heyrick", clientEmail: "info@garage.be", clientAddress: "", intro: "Hallo", terms: "Voorwaarden", language: "nl", items: [] });
    expect(form.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("addresses the company when there is no contact person, and handles no prospect", () => {
    expect(newQuoteForm(DEFAULT_SETTINGS, { id: "p1", companyName: "Geert Kips", contactName: null, email: null }).clientName).toBe("Geert Kips");
    expect(newQuoteForm(DEFAULT_SETTINGS).prospectId).toBe("");
  });

  it("a service becomes an editable snapshot line", () => {
    const line = itemFromTemplate({ id: "t1", name: "SEO setup", description: "Basis SEO", defaultUnit: "stuk", defaultUnitPrice: "450.00", defaultTaxRate: 21, active: true, sortOrder: 0 }, DEFAULT_SETTINGS);
    expect(line).toMatchObject({ templateId: "t1", title: "SEO setup", description: "Basis SEO", quantity: "1", unit: "stuk", unitPrice: "450.00", taxRate: "21" });
    expect(emptyQuoteForm().items).toEqual([]);
    expect(emptyItem().taxRate).toBe("21");
  });
});

describe("CRM integration", () => {
  const event = (id: string, type: string, createdAt: string) => ({ id, quoteId: "q1", quoteNumber: "Q-2026-0001", type, title: type, createdAt });

  it("merges quote events into the prospect timeline, newest first, without touching the other sources", () => {
    const activity = { id: "a1", prospect_id: "p", type: "note", title: "Note", description: null, occurred_on: "2026-11-01", occurred_at: null, metadata: {}, created_at: "2026-11-01T08:00:00Z" } as never;
    const items = mergeTimeline([activity], [], [event("e1", "created", "2026-11-01T12:00:00Z"), event("e2", "sent", "2026-11-03T12:00:00Z")]);
    expect(items.map((i) => i.key)).toEqual(["q:e2", "q:e1", "a:a1"]);
    expect(items[0]).toMatchObject({ kind: "quote", day: "2026-11-03" });
    expect(mergeTimeline([activity], [])).toHaveLength(1);
  });

  it("the latest active quote ignores drafts, rejected, cancelled and expired ones", () => {
    const q = (id: string, status: Parameters<typeof latestActiveQuote>[0][number]["status"], createdAt: string, validUntil: string | null = "2026-12-31") => ({ id, status, createdAt, validUntil });
    expect(latestActiveQuote([q("a", "sent", "2026-10-01"), q("b", "draft", "2026-10-05"), q("c", "rejected", "2026-10-07")], "2026-11-01")?.id).toBe("a");
    expect(latestActiveQuote([q("a", "accepted", "2026-10-01"), q("b", "sent", "2026-10-09")], "2026-11-01")?.id).toBe("b");
    expect(latestActiveQuote([q("a", "sent", "2026-10-01", "2026-10-15")], "2026-11-01")).toBeNull();
    expect(latestActiveQuote([q("a", "cancelled", "2026-10-01")], "2026-11-01")).toBeNull();
    expect(latestActiveQuote([], "2026-11-01")).toBeNull();
  });
});
