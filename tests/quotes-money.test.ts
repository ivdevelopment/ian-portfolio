import { describe, expect, it } from "vitest";
import {
  calculateQuote,
  centsToDecimal,
  decimalToCents,
  formatCents,
  formatPercent,
  formatQuantity,
  MoneyError,
  plainQuantity,
  type LineInput,
} from "@/lib/quotes/money";

const line = (quantity: string | number, unitPrice: string | number, taxRate: number, discountPercent: string | number = 0): LineInput => ({ quantity, unitPrice, taxRate, discountPercent });

describe("calculateQuote: single and multiple lines", () => {
  it("one line at 21%", () => {
    const t = calculateQuote({ lines: [line(1, "1000", 21)] });
    expect(t).toMatchObject({ subtotal: 100000, discountTotal: 0, taxTotal: 21000, total: 121000, grossTotal: 100000, lineDiscountTotal: 0 });
    expect(t.vat).toEqual([{ rate: 21, base: 100000, tax: 21000 }]);
  });

  it("an empty quote is all zeros", () => {
    expect(calculateQuote({ lines: [] })).toMatchObject({ subtotal: 0, taxTotal: 0, total: 0, vat: [] });
  });

  it("supports each Belgian rate: 0, 6, 12 and 21 %", () => {
    const t = calculateQuote({ lines: [line(1, "100", 0), line(1, "100", 6), line(1, "100", 12), line(1, "100", 21)] });
    expect(t.lines.map((l) => l.tax)).toEqual([0, 600, 1200, 2100]);
    expect(t.subtotal).toBe(40000);
    expect(t.taxTotal).toBe(3900);
    expect(t.total).toBe(43900);
    expect(t.vat.map((v) => v.rate)).toEqual([0, 6, 12, 21]);
  });

  it("groups VAT by rate", () => {
    const t = calculateQuote({ lines: [line(1, "100", 21), line(2, "50", 21), line(1, "10", 6)] });
    expect(t.vat).toEqual([
      { rate: 6, base: 1000, tax: 60 },
      { rate: 21, base: 20000, tax: 4200 },
    ]);
  });

  it("handles decimal quantities and prices", () => {
    const t = calculateQuote({ lines: [line("3", "47.50", 6)] });
    expect(t.lines[0]).toMatchObject({ gross: 14250, subtotal: 14250, tax: 855, total: 15105 });
    expect(calculateQuote({ lines: [line("0.333", "10.00", 0)] }).subtotal).toBe(333);
    expect(calculateQuote({ lines: [line("2,5", "10,00", 0)] }).subtotal).toBe(2500);
  });

  it("matches known hand calculations", () => {
    // 12 x 85.00 + 1 x 1,450.00 (21%) and 6 months x 29.90 (6%)
    const t = calculateQuote({ lines: [line(12, "85", 21), line(1, "1450", 21), line(6, "29.90", 6)] });
    expect(t.subtotal).toBe(102000 + 145000 + 17940);
    expect(t.taxTotal).toBe(21420 + 30450 + 1076); // 1076.4 rounds down to 1076
    expect(t.total).toBe(t.subtotal + t.taxTotal);
  });
});

describe("rounding: half up to the cent, at every stage", () => {
  it("rounds .5 up", () => {
    // 0.50 x 21% = 0.105 -> 0.11
    expect(calculateQuote({ lines: [line(1, "0.50", 21)] }).taxTotal).toBe(11);
    // 1.5 x 3.33 = 4.995 -> 5.00
    expect(calculateQuote({ lines: [line("1.5", "3.33", 0)] }).subtotal).toBe(500);
  });

  it("rounds below .5 down", () => {
    // 0.40 x 21% = 0.084 -> 0.08
    expect(calculateQuote({ lines: [line(1, "0.40", 21)] }).taxTotal).toBe(8);
  });

  it("rounds VAT per line and sums the rounded lines", () => {
    const t = calculateQuote({ lines: [line(1, "0.50", 21), line(1, "0.50", 21), line(1, "0.50", 21)] });
    expect(t.lines.map((l) => l.tax)).toEqual([11, 11, 11]);
    expect(t.taxTotal).toBe(33); // not round(3 x 0.105) = 32
  });

  it("is not subject to binary floating point error", () => {
    // 0.1 + 0.2 style traps: 19.99 x 3 and 1.15 x 100
    expect(calculateQuote({ lines: [line(3, "19.99", 0)] }).subtotal).toBe(5997);
    expect(calculateQuote({ lines: [line(100, "1.15", 0)] }).subtotal).toBe(11500);
    expect(calculateQuote({ lines: [line("1.005", "1000", 0)] }).subtotal).toBe(100500);
  });
});

describe("discounts", () => {
  it("applies a per-line percentage", () => {
    const t = calculateQuote({ lines: [line(1, "200", 21, 10)] });
    expect(t.lines[0]).toMatchObject({ gross: 20000, lineDiscount: 2000, subtotal: 18000, tax: 3780, total: 21780 });
    expect(t).toMatchObject({ grossTotal: 20000, lineDiscountTotal: 2000, subtotal: 18000 });
  });

  it("supports fractional percentages and rounds the discount", () => {
    // 12.5% of 99.99 = 12.49875 -> 12.50
    const t = calculateQuote({ lines: [line(1, "99.99", 0, "12.5")] });
    expect(t.lines[0]).toMatchObject({ lineDiscount: 1250, subtotal: 8749 });
  });

  it("allows 100% and rejects more", () => {
    expect(calculateQuote({ lines: [line(1, "50", 21, 100)] })).toMatchObject({ subtotal: 0, total: 0 });
    expect(() => calculateQuote({ lines: [line(1, "50", 21, "100.01")] })).toThrow(/cannot be more than 100%/);
  });

  it("applies a quote-level percentage across mixed VAT rates", () => {
    const t = calculateQuote({ lines: [line(1, "100", 21), line(1, "50", 6)], discount: { type: "percent", value: 10 } });
    expect(t.subtotal).toBe(15000);
    expect(t.discountTotal).toBe(1500);
    expect(t.lines.map((l) => l.quoteDiscountShare)).toEqual([1000, 500]);
    expect(t.lines.map((l) => l.tax)).toEqual([1890, 270]);
    expect(t.taxableTotal).toBe(13500);
    expect(t.total).toBe(13500 + 2160);
  });

  it("applies a quote-level fixed amount and spreads it to the cent", () => {
    const t = calculateQuote({ lines: [line(1, "100", 21), line(1, "100", 21), line(1, "100", 21)], discount: { type: "fixed", value: "10" } });
    expect(t.lines.map((l) => l.quoteDiscountShare)).toEqual([334, 333, 333]);
    expect(t.lines.reduce((s, l) => s + l.quoteDiscountShare, 0)).toBe(1000);
    expect(t.discountTotal).toBe(1000);
  });

  it("combines line and quote discounts", () => {
    const t = calculateQuote({ lines: [line(1, "200", 21, 10)], discount: { type: "fixed", value: "30" } });
    expect(t.subtotal).toBe(18000);
    expect(t.discountTotal).toBe(3000);
    expect(t.taxableTotal).toBe(15000);
    expect(t.taxTotal).toBe(3150);
    expect(t.total).toBe(18150);
  });

  it("rejects a discount larger than the subtotal", () => {
    expect(() => calculateQuote({ lines: [line(1, "10", 21)], discount: { type: "fixed", value: "10.01" } })).toThrow(/more than the subtotal/);
    expect(() => calculateQuote({ lines: [line(1, "10", 21)], discount: { type: "percent", value: 101 } })).toThrow(MoneyError);
    expect(calculateQuote({ lines: [line(1, "10", 21)], discount: { type: "fixed", value: "10" } })).toMatchObject({ total: 0 });
  });

  it("a discount on an empty or free quote is zero", () => {
    expect(calculateQuote({ lines: [line(1, "0", 21)], discount: { type: "percent", value: 50 } }).discountTotal).toBe(0);
  });
});

describe("invalid input", () => {
  it("rejects negative quantity, price and VAT", () => {
    expect(() => calculateQuote({ lines: [line(-1, "10", 21)] })).toThrow(MoneyError);
    expect(() => calculateQuote({ lines: [line(1, "-10", 21)] })).toThrow(MoneyError);
    expect(() => calculateQuote({ lines: [line(1, "10", -6)] })).toThrow(MoneyError);
    expect(() => calculateQuote({ lines: [line(1, -10, 21)] })).toThrow(MoneyError);
  });

  it("rejects garbage and too much precision instead of rounding silently", () => {
    expect(() => calculateQuote({ lines: [line("abc", "10", 21)] })).toThrow(MoneyError);
    expect(() => calculateQuote({ lines: [line(1, "10.001", 21)] })).toThrow(/at most 2 decimals/);
    expect(() => calculateQuote({ lines: [line("1.0005", "10", 21)] })).toThrow(/at most 3 decimals/);
    expect(() => calculateQuote({ lines: [line(Number.NaN, "10", 21)] })).toThrow(MoneyError);
    expect(() => calculateQuote({ lines: [line(Infinity, "10", 21)] })).toThrow(MoneyError);
    expect(() => calculateQuote({ lines: [line("1e3", "10", 21)] })).toThrow(MoneyError);
  });

  it("rejects absurd sizes", () => {
    expect(() => calculateQuote({ lines: [line(2_000_000, "1", 21)] })).toThrow(/too large/);
    expect(() => calculateQuote({ lines: [line(1, "999999999", 21)] })).toThrow(/too large/);
  });

  it("treats blank amounts as zero so live totals work while typing", () => {
    expect(calculateQuote({ lines: [{ quantity: "", unitPrice: "", discountPercent: "", taxRate: "21" }] }).total).toBe(0);
  });

  it("accepts numbers that came from JSON", () => {
    expect(calculateQuote({ lines: [line(2.5, 10.1, 21)] }).subtotal).toBe(2525);
  });
});

describe("consistency: every figure adds up, on random quotes", () => {
  // Small deterministic PRNG so a failure is reproducible.
  let seed = 20261103;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

  it("holds for 300 random quotes", () => {
    for (let n = 0; n < 300; n++) {
      const lines: LineInput[] = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => ({
        quantity: (Math.floor(rand() * 20000) / 1000).toFixed(3),
        unitPrice: (Math.floor(rand() * 500000) / 100).toFixed(2),
        discountPercent: (Math.floor(rand() * 5000) / 100).toFixed(2),
        taxRate: pick([0, 6, 12, 21]),
      }));
      const discountType = pick(["none", "percent", "fixed"] as const);
      const probe = calculateQuote({ lines });
      const value = discountType === "percent" ? (rand() * 100).toFixed(2) : discountType === "fixed" ? centsToDecimal(Math.floor(rand() * probe.subtotal)) : 0;
      const t = calculateQuote({ lines, discount: { type: discountType, value } });

      expect(t.lines.reduce((s, l) => s + l.subtotal, 0)).toBe(t.subtotal);
      expect(t.lines.reduce((s, l) => s + l.quoteDiscountShare, 0)).toBe(t.discountTotal);
      expect(t.lines.reduce((s, l) => s + l.tax, 0)).toBe(t.taxTotal);
      expect(t.lines.reduce((s, l) => s + l.total, 0)).toBe(t.total);
      expect(t.subtotal - t.discountTotal + t.taxTotal).toBe(t.total);
      expect(t.vat.reduce((s, v) => s + v.tax, 0)).toBe(t.taxTotal);
      expect(t.vat.reduce((s, v) => s + v.base, 0)).toBe(t.taxableTotal);
      expect(t.grossTotal - t.lineDiscountTotal).toBe(t.subtotal);
      for (const l of t.lines) {
        expect(l.quoteDiscountShare).toBeLessThanOrEqual(l.subtotal);
        expect(l.total).toBe(l.subtotal - l.quoteDiscountShare + l.tax);
      }
      // Deterministic: the same input always gives the same figures.
      expect(calculateQuote({ lines, discount: { type: discountType, value } })).toEqual(t);
    }
  });
});

describe("formatting and conversion", () => {
  it("converts cents to an exact decimal string and back", () => {
    expect(centsToDecimal(123450)).toBe("1234.50");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(0)).toBe("0.00");
    expect(decimalToCents("1234.50")).toBe(123450);
    expect(decimalToCents("0.1")).toBe(10);
    expect(decimalToCents(null)).toBe(0);
  });

  it("formats money in Dutch and English", () => {
    expect(formatCents(123450)).toBe("€ 1.234,50");
    expect(formatCents(123450, "EUR", "en")).toBe("€1,234.50");
    expect(formatCents(5)).toBe("€ 0,05");
  });

  it("formats quantities and percentages", () => {
    expect(plainQuantity("2.50")).toBe("2.5");
    expect(plainQuantity("3")).toBe("3");
    expect(formatQuantity("2.5")).toBe("2,5");
    expect(formatQuantity("2.5", "en")).toBe("2.5");
    expect(formatPercent(21)).toBe("21%");
    expect(formatPercent(12.5)).toBe("12,5%");
    expect(formatPercent(12.5, "en")).toBe("12.5%");
  });
});
