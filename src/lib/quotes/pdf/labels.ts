import type { QuoteLanguage } from "../constants";

/** Every word the quote PDF prints. Dutch is the default; the client's language is chosen per quote. */
export type PdfLabels = {
  quote: string;
  quoteNumber: string;
  date: string;
  validUntil: string;
  to: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  vat: string;
  total: string;
  amountsExclVat: string;
  subtotal: string;
  quoteDiscount: string;
  totalExclVat: string;
  vatRate: (rate: string) => string;
  onAmount: (amount: string) => string;
  totalVat: string;
  totalInclVat: string;
  notes: string;
  terms: string;
  page: (n: number, of: number) => string;
  vatNumber: string;
  iban: string;
  continued: string;
};

export const PDF_LABELS: Record<QuoteLanguage, PdfLabels> = {
  nl: {
    quote: "Offerte",
    quoteNumber: "Offertenummer",
    date: "Datum",
    validUntil: "Geldig tot",
    to: "Aan",
    description: "Omschrijving",
    quantity: "Aantal",
    unitPrice: "Prijs",
    discount: "Korting",
    vat: "BTW",
    total: "Totaal",
    amountsExclVat: "Bedragen per regel zijn exclusief BTW.",
    subtotal: "Subtotaal",
    quoteDiscount: "Korting",
    totalExclVat: "Totaal excl. BTW",
    vatRate: (rate) => `BTW ${rate}`,
    onAmount: (amount) => `op ${amount}`,
    totalVat: "Totaal BTW",
    totalInclVat: "Totaal incl. BTW",
    notes: "Opmerkingen",
    terms: "Voorwaarden",
    page: (n, of) => `Pagina ${n} van ${of}`,
    vatNumber: "BTW-nr.",
    iban: "IBAN",
    continued: "vervolg",
  },
  en: {
    quote: "Quote",
    quoteNumber: "Quote number",
    date: "Date",
    validUntil: "Valid until",
    to: "To",
    description: "Description",
    quantity: "Qty",
    unitPrice: "Price",
    discount: "Discount",
    vat: "VAT",
    total: "Total",
    amountsExclVat: "Line amounts exclude VAT.",
    subtotal: "Subtotal",
    quoteDiscount: "Discount",
    totalExclVat: "Total excl. VAT",
    vatRate: (rate) => `VAT ${rate}`,
    onAmount: (amount) => `on ${amount}`,
    totalVat: "Total VAT",
    totalInclVat: "Total incl. VAT",
    notes: "Notes",
    terms: "Terms",
    page: (n, of) => `Page ${n} of ${of}`,
    vatNumber: "VAT no.",
    iban: "IBAN",
    continued: "continued",
  },
};

/** "2026-11-15" -> "15 november 2026" / "15 November 2026". A calendar day never shifts with the server's time zone. */
export function formatPdfDay(day: string, language: QuoteLanguage): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "nl" ? "nl-BE" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
