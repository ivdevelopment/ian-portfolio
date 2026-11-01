import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/quotes/form";
import { centsToDecimal } from "@/lib/quotes/money";
import { renderQuotePdf } from "@/lib/quotes/pdf/render";
import { calculateForm, emptyItem, emptyQuoteForm, type QuoteFormValues } from "@/lib/quotes/schema";
import type { QuoteRecord, QuoteSettings } from "@/lib/quotes/types";

type TextItem = { str: string; x: number; y: number; width: number };
type ParsedPdf = { pages: Array<{ text: string; items: TextItem[] }>; info: Record<string, unknown> };

async function parse(bytes: Uint8Array): Promise<ParsedPdf> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 }).promise;
  const pages: ParsedPdf["pages"] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const items = (content.items as Array<{ str?: string; transform?: number[]; width?: number }>)
      .filter((i) => typeof i.str === "string" && i.transform)
      .map((i) => ({ str: i.str!, x: i.transform![4], y: i.transform![5], width: i.width ?? 0 }));
    pages.push({ text: items.map((i) => i.str).join(" "), items });
  }
  const meta = await doc.getMetadata();
  return { pages, info: meta.info as Record<string, unknown> };
}

/** A saved-quote record built from builder values, with the lines calculated exactly as the server does. */
function quoteFrom(values: QuoteFormValues, over: Partial<QuoteRecord> = {}): QuoteRecord {
  const { totals } = calculateForm(values);
  if (!totals) throw new Error("invalid fixture");
  return {
    id: "00000000-0000-4000-8000-000000000001",
    number: "Q-2026-0004",
    status: "ready",
    statusNote: null,
    language: values.language,
    prospectId: null,
    projectId: null,
    clientName: values.clientName || null,
    clientCompany: values.clientCompany || null,
    clientEmail: values.clientEmail || null,
    clientAddress: values.clientAddress || null,
    title: values.title || null,
    intro: values.intro || null,
    notes: values.notes || null,
    terms: values.terms || null,
    currency: values.currency,
    discountType: values.discountType,
    discountValue: values.discountType === "none" ? "0.00" : Number(values.discountValue).toFixed(2),
    subtotalCents: totals.subtotal,
    discountCents: totals.discountTotal,
    taxCents: totals.taxTotal,
    totalCents: totals.total,
    validUntil: values.validUntil || null,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-02T09:30:00.000Z",
    sentAt: null,
    acceptedAt: null,
    rejectedAt: null,
    items: values.items.map((i, n) => ({
      id: `item-${n}`,
      position: n,
      templateId: null,
      title: i.title,
      description: i.description || null,
      quantity: i.quantity,
      unit: i.unit || null,
      unitPriceCents: Math.round(Number(i.unitPrice.replace(",", ".") || 0) * 100),
      discountPercent: i.discountPercent || "0",
      taxRate: Number(i.taxRate),
      subtotalCents: totals.lines[n].subtotal,
      quoteDiscountShareCents: totals.lines[n].quoteDiscountShare,
      taxCents: totals.lines[n].tax,
      totalCents: totals.lines[n].total,
    })),
    ...over,
  };
}

const base = (over: Partial<QuoteFormValues> = {}): QuoteFormValues =>
  emptyQuoteForm({
    clientName: "Geert Kips",
    clientCompany: "Kips Fietsen",
    clientEmail: "geert@geertkips.be",
    clientAddress: "Dorpsstraat 12\n3500 Hasselt",
    title: "Nieuwe website",
    intro: "Hierbij ontvangt u mijn offerte voor uw nieuwe website.",
    validUntil: "2026-11-15",
    notes: "Betaling in twee schijven.",
    terms: "Facturen zijn betaalbaar binnen 14 dagen.",
    items: [
      emptyItem({ title: "Website design", description: "Maatwerk ontwerp, 6 pagina’s", quantity: "1", unit: "stuk", unitPrice: "1200", taxRate: "21" }),
      emptyItem({ title: "Hosting & onderhoud", quantity: "12", unit: "maand", unitPrice: "29,90", taxRate: "6" }),
    ],
    ...over,
  });

const render = (values: QuoteFormValues, settings: QuoteSettings = DEFAULT_SETTINGS, over: Partial<QuoteRecord> = {}) => renderQuotePdf({ quote: quoteFrom(values, over), settings });

describe("quote PDF content", () => {
  let nl: ParsedPdf;
  let bytes: Uint8Array;
  beforeAll(async () => {
    bytes = await render(base());
    nl = await parse(bytes);
  });

  it("is a valid single-page PDF of reasonable size", () => {
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(nl.pages).toHaveLength(1);
    expect(bytes.byteLength).toBeLessThan(400_000);
  });

  it("prints the Dutch labels and the quote details", () => {
    const t = nl.pages[0].text;
    for (const word of ["OFFERTE", "Offertenummer", "Q-2026-0004", "Datum", "1 november 2026", "Geldig tot", "15 november 2026", "OMSCHRIJVING", "AANTAL", "PRIJS", "BTW", "TOTAAL"]) expect(t).toContain(word);
  });

  it("prints the letterhead, client, texts and footer contact details", () => {
    const t = nl.pages[0].text;
    for (const word of ["Ian Verlinden", "Web Design & Development", "Kips Fietsen", "Geert Kips", "Dorpsstraat 12", "3500 Hasselt", "geert@geertkips.be", "Nieuwe website", "Hierbij ontvangt u mijn offerte", "Opmerkingen".toUpperCase(), "Voorwaarden".toUpperCase(), "hello@ianverlinden.com", "ianverlinden.com", "Pagina 1 van 1"]) expect(t).toContain(word);
  });

  it("prints every line with quantity, price, VAT and amount", () => {
    const t = nl.pages[0].text;
    for (const word of ["Website design", "Maatwerk ontwerp, 6 pagina’s", "1 stuk", "€ 1.200,00", "21%", "Hosting & onderhoud", "12 maand", "€ 29,90", "6%", "€ 358,80"]) expect(t).toContain(word);
  });

  it("prints subtotal, VAT per rate and the totals clearly", () => {
    const t = nl.pages[0].text;
    for (const word of ["Totaal excl. BTW", "€ 1.558,80", "BTW 6%", "€ 21,53", "BTW 21%", "€ 252,00", "Totaal BTW", "€ 273,53", "Totaal incl. BTW", "€ 1.832,33"]) expect(t).toContain(word);
  });

  it("sets deterministic document metadata", async () => {
    expect(nl.info.Title).toBe("Offerte Q-2026-0004");
    expect(nl.info.Author).toBe("Ian Verlinden");
    expect(String(nl.info.CreationDate)).toContain("20261101");
  });

  it("produces identical bytes for the same quote", async () => {
    const again = await render(base());
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });

  it("changes when the quote changes", async () => {
    const other = await render(base({ title: "Andere titel" }));
    expect(Buffer.from(other).equals(Buffer.from(bytes))).toBe(false);
  });
});

describe("English quote", () => {
  it("uses English labels, dates and number formats", async () => {
    const pdf = await parse(await render(base({ language: "en" })));
    const t = pdf.pages[0].text;
    for (const word of ["QUOTE", "Quote number", "Date", "1 November 2026", "Valid until", "15 November 2026", "DESCRIPTION", "QTY", "PRICE", "VAT", "TOTAL", "Total excl. VAT", "Total incl. VAT", "NOTES", "TERMS", "Page 1 of 1", "€1,832.33", "VAT 21%", "VAT 6%"]) expect(t).toContain(word);
    expect(t).not.toContain("Offertenummer");
    expect(pdf.info.Title).toBe("Quote Q-2026-0004");
  });
});

describe("discounts", () => {
  it("shows a discount column and the line discounts when a line has one", async () => {
    const items = [emptyItem({ title: "Design", unitPrice: "200", discountPercent: "10", taxRate: "21" })];
    const t = (await parse(await render(base({ items })))).pages[0].text;
    expect(t).toContain("KORTING");
    expect(t).toContain("10%");
    expect(t).toContain("Korting op regels (reeds verrekend)");
    expect(t).toContain("− € 20,00");
    expect(t).toContain("€ 180,00");
    expect(t).toContain("€ 217,80");
  });

  it("shows a quote-level discount as subtotal, discount and the reduced total", async () => {
    const t = (await parse(await render(base({ discountType: "percent", discountValue: "10" })))).pages[0].text;
    expect(t).toContain("Subtotaal");
    expect(t).toContain("€ 1.558,80");
    expect(t).toContain("− € 155,88");
    expect(t).toContain("Totaal excl. BTW");
    expect(t).toContain("€ 1.402,92");
  });

  it("has no discount column or discount rows without discounts", async () => {
    const t = (await parse(await render(base()))).pages[0].text;
    expect(t).not.toContain("KORTING");
    expect(t).not.toContain("Subtotaal");
  });
});

describe("page breaks", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => emptyItem({ title: `Dienst nummer ${i + 1}`, description: i % 3 === 0 ? "Een korte beschrijving van deze dienst." : "", quantity: "1", unitPrice: String(10 + i), taxRate: "21" }));

  it("flows many lines over several pages, repeating the header and numbering every page", async () => {
    const pdf = await parse(await render(base({ items: many(70) })));
    expect(pdf.pages.length).toBeGreaterThan(2);
    pdf.pages.forEach((page, i) => {
      expect(page.text).toContain(`Pagina ${i + 1} van ${pdf.pages.length}`);
      expect(page.text).toContain("Q-2026-0004");
      expect(page.text).toContain("hello@ianverlinden.com");
      if (i > 0 && page.text.includes("Dienst nummer")) expect(page.text).toContain("OMSCHRIJVING");
    });
    const all = pdf.pages.map((p) => p.text).join(" ");
    for (let i = 1; i <= 70; i++) expect(all).toContain(`Dienst nummer ${i} `);
    // The totals appear exactly once, on the last page that holds lines or after them.
    expect(all.match(/Totaal incl\. BTW/g)).toHaveLength(1);
  });

  it("keeps everything inside the margins", async () => {
    const pdf = await parse(await render(base({ items: many(40) })));
    for (const page of pdf.pages) {
      for (const item of page.items) {
        if (!item.str.trim()) continue;
        expect(item.x, item.str).toBeGreaterThanOrEqual(47);
        expect(item.x + item.width, item.str).toBeLessThanOrEqual(595.28 - 47);
        expect(item.y, item.str).toBeGreaterThan(20);
        expect(item.y, item.str).toBeLessThan(841.89 - 20);
      }
    }
  });

  it("splits a very long description across pages without losing a word", async () => {
    const words = Array.from({ length: 900 }, (_, i) => `woord${i}`).join(" ");
    const pdf = await parse(await render(base({ items: [emptyItem({ title: "Uitgebreid pakket", description: words, unitPrice: "500" })] })));
    expect(pdf.pages.length).toBeGreaterThan(1);
    const all = pdf.pages.map((p) => p.text).join(" ");
    expect(all).toContain("woord0 ");
    expect(all).toContain("woord899");
    expect(all).toContain("Totaal incl. BTW");
  });

  it("breaks an unbreakable word instead of overflowing", async () => {
    const pdf = await parse(await render(base({ items: [emptyItem({ title: "A".repeat(200), description: "x".repeat(300), unitPrice: "1" })] })));
    for (const item of pdf.pages[0].items) if (item.str.trim()) expect(item.x + item.width).toBeLessThanOrEqual(595.28 - 47);
  });

  it("keeps the totals together, moving them to the next page when they do not fit", async () => {
    for (const n of [16, 17, 18, 19, 20, 21, 22]) {
      const pdf = await parse(await render(base({ items: many(n), notes: "", terms: "" })));
      const holder = pdf.pages.filter((p) => p.text.includes("Totaal incl. BTW"));
      expect(holder).toHaveLength(1);
      expect(holder[0].text).toContain("Totaal excl. BTW");
      expect(holder[0].text).toContain("BTW 21%");
    }
  });

  it("splits long notes and terms over pages", async () => {
    const text = Array.from({ length: 200 }, (_, i) => `Voorwaarde ${i + 1}: dit is een uitgebreide zin die de pagina vult.`).join("\n");
    const pdf = await parse(await render(base({ terms: text })));
    expect(pdf.pages.length).toBeGreaterThan(1);
    const all = pdf.pages.map((p) => p.text).join(" ");
    expect(all).toContain("Voorwaarde 1:");
    expect(all).toContain("Voorwaarde 200:");
  });
});

describe("special characters", () => {
  it("renders accents, euro signs, quotes, dashes and ampersands", async () => {
    const values = base({
      clientCompany: "Café “Zoë” & Zonen BV",
      clientName: "Jean-François D’Hondt",
      title: "Offerte – ontwerp & ontwikkeling (50% voorschot) — €",
      intro: "Wij maken ’t mooi: ß ñ ł ø é è ê ï ü ç … × ½",
      items: [emptyItem({ title: "L’équipe: naïve façade", description: "Prijs in € – excl. BTW; “speciaal” tarief", unitPrice: "1234,56" })],
    });
    const t = (await parse(await render(values))).pages[0].text;
    for (const word of ["Café “Zoë” & Zonen BV", "Jean-François D’Hondt", "Offerte – ontwerp & ontwikkeling (50% voorschot) — €", "ß ñ ł ø é è ê ï ü ç … × ½", "L’équipe: naïve façade", "“speciaal”", "€ 1.234,56"]) expect(t).toContain(word);
  });

  it("replaces characters the font cannot draw and drops control characters, without failing", async () => {
    const t = (await parse(await render(base({ title: "Ready ✓ 😀 done\u0000\u0007 end", intro: "tab\there​zero" })))).pages[0].text;
    expect(t).toContain("Ready ? ? done end");
    expect(t).toContain("tab here");
    expect(t).not.toMatch(/[\u0000\u0007]/);
  });

  it("treats text that looks like markup or formulas as plain text", async () => {
    const t = (await parse(await render(base({ title: "<script>alert(1)</script> =SUM(A1)", intro: "(Hello) \\ [x] {y}" })))).pages[0].text;
    expect(t).toContain("<script>alert(1)</script> =SUM(A1)");
    expect(t).toContain("(Hello) \\ [x] {y}");
  });
});

describe("optional content", () => {
  it("renders a bare quote without printing placeholders", async () => {
    const values = emptyQuoteForm({ clientName: "Geert", items: [emptyItem({ title: "Iets", unitPrice: "10" })] });
    const t = (await parse(await render(values, DEFAULT_SETTINGS, { validUntil: null }))).pages[0].text;
    for (const bad of ["undefined", "null", "NaN", "[object"]) expect(t).not.toContain(bad);
    expect(t).not.toContain("Geldig tot");
    expect(t).not.toContain("OPMERKINGEN");
    expect(t).toContain("€ 12,10");
  });

  it("renders a quote without lines", async () => {
    const t = (await parse(await render(emptyQuoteForm({ clientName: "Geert", title: "Leeg" })))).pages[0].text;
    expect(t).toContain("Totaal incl. BTW");
    expect(t).toContain("€ 0,00");
  });

  it("prints VAT number, IBAN and address only when they are set", async () => {
    const without = (await parse(await render(base()))).pages[0].text;
    expect(without).not.toContain("BTW-nr.");
    expect(without).not.toContain("IBAN");
    const settings: QuoteSettings = { ...DEFAULT_SETTINGS, businessVatNumber: "BE 0123.456.789", businessIban: "BE68 5390 0754 7034", businessAddress: "Voorbeeldstraat 1\n3500 Hasselt", businessPhone: "+32 470 00 00 00" };
    const withAll = (await parse(await render(base(), settings))).pages[0].text;
    for (const word of ["BTW-nr. BE 0123.456.789", "IBAN BE68 5390 0754 7034", "Voorbeeldstraat 1, 3500 Hasselt", "+32 470 00 00 00"]) expect(withAll).toContain(word);
  });

  it("uses the settings' business name and tagline", async () => {
    const t = (await parse(await render(base(), { ...DEFAULT_SETTINGS, businessName: "Studio Verlinden", businessTagline: "Webdesign" }))).pages[0].text;
    expect(t).toContain("Studio Verlinden");
    expect(t).toContain("Webdesign");
  });

  it("formats other currencies", async () => {
    const t = (await parse(await render(base({ currency: "USD", language: "en", items: [emptyItem({ title: "X", unitPrice: "1000", taxRate: "0" })] })))).pages[0].text;
    expect(t).toContain("US$1,000.00");
  });
});

describe("helpers used by the PDF", () => {
  it("centsToDecimal feeds the figures the PDF prints", () => {
    expect(centsToDecimal(183233)).toBe("1832.33");
  });
});
