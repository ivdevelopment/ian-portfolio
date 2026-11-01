import { describe, expect, it } from "vitest";
import {
  canTransition,
  daysUntilExpiry,
  defaultValidUntil,
  effectiveStatus,
  isDeletable,
  isEditable,
  isOpenPipeline,
  QUOTE_STATUSES,
  QUOTE_TRANSITIONS,
  quoteFileName,
} from "@/lib/quotes/constants";
import { calculateForm, emptyItem, emptyQuoteForm, readinessIssues, toRpcPayload, validateDraft, type QuoteFormValues } from "@/lib/quotes/schema";

const valid = (over: Partial<QuoteFormValues> = {}): QuoteFormValues =>
  emptyQuoteForm({
    clientName: "Geert Kips",
    title: "Nieuwe website",
    validUntil: "2026-12-01",
    items: [emptyItem({ title: "Website design", quantity: "1", unitPrice: "1500", taxRate: "21" })],
    ...over,
  });

describe("status transitions", () => {
  it("allows the intended workflow", () => {
    expect(canTransition("draft", "ready")).toBe(true);
    expect(canTransition("ready", "sent")).toBe(true);
    expect(canTransition("sent", "accepted")).toBe(true);
    expect(canTransition("sent", "rejected")).toBe(true);
    expect(canTransition("ready", "draft")).toBe(true);
    expect(canTransition("expired", "sent")).toBe(true);
    expect(canTransition("accepted", "cancelled")).toBe(true);
  });

  it("rejects shortcuts and reversals", () => {
    expect(canTransition("draft", "sent")).toBe(false);
    expect(canTransition("draft", "accepted")).toBe(false);
    expect(canTransition("sent", "draft")).toBe(false);
    expect(canTransition("accepted", "rejected")).toBe(false);
    expect(canTransition("rejected", "accepted")).toBe(false);
    expect(canTransition("cancelled", "draft")).toBe(false);
    expect(canTransition("sent", "sent")).toBe(false);
  });

  it("cancelled is final and every status is reachable", () => {
    expect(QUOTE_TRANSITIONS.cancelled).toEqual([]);
    for (const s of QUOTE_STATUSES.filter((s) => s !== "draft")) expect(Object.values(QUOTE_TRANSITIONS).some((to) => to.includes(s))).toBe(true);
  });

  it("only drafts and ready quotes are editable; only drafts deletable", () => {
    expect(QUOTE_STATUSES.filter(isEditable)).toEqual(["draft", "ready"]);
    expect(QUOTE_STATUSES.filter(isDeletable)).toEqual(["draft"]);
  });
});

describe("derived expiry", () => {
  it("a sent quote past its validity reads as expired without changing the stored status", () => {
    expect(effectiveStatus("sent", "2026-10-31", "2026-11-01")).toBe("expired");
    expect(effectiveStatus("sent", "2026-11-01", "2026-11-01")).toBe("sent");
    expect(effectiveStatus("sent", null, "2026-11-01")).toBe("sent");
  });

  it("only sent quotes expire", () => {
    for (const s of ["draft", "ready", "accepted", "rejected", "cancelled"] as const) expect(effectiveStatus(s, "2020-01-01", "2026-11-01")).toBe(s);
  });

  it("counts days and defaults the validity", () => {
    expect(daysUntilExpiry("2026-11-15", "2026-11-01")).toBe(14);
    expect(daysUntilExpiry("2026-10-30", "2026-11-01")).toBe(-2);
    expect(daysUntilExpiry(null)).toBeNull();
    expect(defaultValidUntil(14, "2026-11-01")).toBe("2026-11-15");
    expect(defaultValidUntil(30, "2026-12-15")).toBe("2027-01-14");
  });

  it("rejected, cancelled and expired quotes are never open pipeline", () => {
    expect(isOpenPipeline("ready", null, "2026-11-01")).toBe(true);
    expect(isOpenPipeline("sent", "2026-12-01", "2026-11-01")).toBe(true);
    expect(isOpenPipeline("sent", "2026-10-01", "2026-11-01")).toBe(false);
    for (const s of ["draft", "accepted", "rejected", "cancelled", "expired"] as const) expect(isOpenPipeline(s, "2026-12-01", "2026-11-01")).toBe(false);
  });
});

describe("download file name", () => {
  it("builds a safe name from the number and the client", () => {
    expect(quoteFileName("Q-2026-0004", "Geert Kips")).toBe("Q-2026-0004-geert-kips.pdf");
    expect(quoteFileName("Q-2026-0004", "Jan", "Café Zoë & Zonen")).toBe("Q-2026-0004-cafe-zoe-zonen.pdf");
    expect(quoteFileName("Q-2026-0004", null)).toBe("Q-2026-0004.pdf");
    expect(quoteFileName("Q-2026-0004", "../../etc/passwd")).toBe("Q-2026-0004-etc-passwd.pdf");
    expect(quoteFileName("Q-2026-0004", "A".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("form validation", () => {
  it("accepts a complete form and an incomplete draft", () => {
    expect(validateDraft(valid())).toEqual({});
    expect(validateDraft(emptyQuoteForm())).toEqual({});
  });

  it("rejects malformed values even in a draft", () => {
    expect(validateDraft(valid({ clientEmail: "not-an-email" })).clientEmail).toBeTruthy();
    expect(validateDraft(valid({ validUntil: "2026-02-31" })).validUntil).toBeTruthy();
    expect(validateDraft(valid({ title: "x".repeat(201) })).title).toBeTruthy();
    expect(validateDraft(valid({ currency: "XYZ" as never })).currency).toBeTruthy();
  });

  it("flags the exact field with a bad number", () => {
    const e = validateDraft(valid({ items: [emptyItem({ title: "A", unitPrice: "-5" }), emptyItem({ title: "B", quantity: "-1" }), emptyItem({ title: "C", discountPercent: "101" })] }));
    expect(e["items.0.unitPrice"]).toBeTruthy();
    expect(e["items.1.quantity"]).toBeTruthy();
    expect(e["items.2.discountPercent"]).toBeTruthy();
  });

  it("only the four VAT rates are offered", () => {
    expect(validateDraft(valid({ items: [emptyItem({ title: "A", taxRate: "9" })] }))["items.0.taxRate"]).toBeTruthy();
    for (const r of ["0", "6", "12", "21"]) expect(validateDraft(valid({ items: [emptyItem({ title: "A", taxRate: r })] }))["items.0.taxRate"]).toBeUndefined();
  });

  it("flags a discount larger than the subtotal", () => {
    expect(validateDraft(valid({ discountType: "fixed", discountValue: "5000" })).discountValue).toMatch(/subtotal/);
    expect(validateDraft(valid({ discountType: "percent", discountValue: "150" })).discountValue).toBeTruthy();
  });

  it("lists what is missing before Ready", () => {
    expect(readinessIssues(valid())).toEqual([]);
    const issues = readinessIssues(emptyQuoteForm());
    expect(issues).toEqual(expect.arrayContaining(["Add the client's name.", "Add a title.", "Add at least one line item."]));
    expect(readinessIssues(valid({ items: [emptyItem({ title: "", quantity: "0" })] }))).toEqual(expect.arrayContaining(["Line 1: add a title.", "Line 1: the quantity must be more than 0."]));
    expect(readinessIssues(valid({ validUntil: "" }))).toContain("Choose a valid-until date.");
  });
});

describe("save payload", () => {
  it("carries exact decimal strings and the calculated figures", () => {
    const { quote, items, totals } = toRpcPayload(
      valid({ items: [emptyItem({ title: "Hosting", quantity: "2,5", unit: "maand", unitPrice: "19,90", discountPercent: "10", taxRate: "6" })], discountType: "fixed", discountValue: "5" }),
    );
    expect(quote).toMatchObject({ client_name: "Geert Kips", currency: "EUR", discount_type: "fixed", discount_value: "5.00", valid_until: "2026-12-01", client_email: null });
    expect(items[0]).toMatchObject({ title: "Hosting", quantity: "2.5", unit: "maand", unit_price: "19.90", discount_percent: "10.00", tax_rate: "6.00" });
    // 2.5 x 19.90 = 49.75, less 10% (4.975 -> 4.98) = 44.77; less the 5.00 quote discount = 39.77; VAT 6% = 2.3862 -> 2.39
    expect(totals).toMatchObject({ subtotal: 4477, discountTotal: 500, taxTotal: 239, total: 4216 });
    expect(quote).toMatchObject({ subtotal: "44.77", discount_total: "5.00", tax_total: "2.39", total: "42.16" });
    expect(items[0]).toMatchObject({ line_subtotal: "44.77", quote_discount_share: "5.00", line_tax: "2.39", line_total: "42.16" });
  });

  it("refuses an invalid form and keeps drafts with blank line titles saveable", () => {
    expect(() => toRpcPayload(valid({ clientEmail: "nope" }))).toThrow();
    expect(toRpcPayload(valid({ items: [emptyItem({ title: "" })] })).items[0].title).toBe("—");
  });

  it("calculateForm reports the problem instead of throwing", () => {
    expect(calculateForm({ items: [emptyItem({ unitPrice: "abc" })], discountType: "none", discountValue: "" }).error).toBeTruthy();
    expect(calculateForm({ items: [], discountType: "none", discountValue: "" }).totals?.total).toBe(0);
  });
});
