import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { brusselsDay } from "@/lib/mail/timeline";
import { formatCents, formatPercent, formatQuantity } from "../money";
import { quoteTotals } from "../summary";
import type { QuoteRecord, QuoteSettings } from "../types";
import { loadPdfFonts, type PdfFontBytes } from "./fonts";
import { PDF_LABELS, formatPdfDay, type PdfLabels } from "./labels";

/**
 * Branded quote PDF, drawn directly with pdf-lib: no headless browser, no network, no randomness.
 * The same quote always produces the same bytes (fixed metadata dates, fixed font names).
 *
 * Layout: A4, navy accent. First page has the letterhead, client and quote details, title and introduction; the line items
 * follow as a table whose header repeats on every page, then the totals (kept together), notes and terms. Every page has a
 * footer with the business details and "page n of m".
 */

export type QuotePdfInput = { quote: QuoteRecord; settings: QuoteSettings };

const PAGE = { w: 595.28, h: 841.89 };
const M = { left: 48, right: 48, top: 54, bottom: 76 };
const W = PAGE.w - M.left - M.right;

const NAVY = rgb(0.059, 0.165, 0.29);
const INK = rgb(0.09, 0.1, 0.13);
const GREY = rgb(0.4, 0.43, 0.48);
const LINE = rgb(0.86, 0.88, 0.91);

type Fonts = { regular: PDFFont; medium: PDFFont; semibold: PDFFont };

/** Characters the embedded font cannot draw become "?" instead of an empty box; control characters become spaces. */
function makeSanitizer(has: (codePoint: number) => boolean) {
  return (input: string | null | undefined): string => {
    let out = "";
    for (const ch of (input ?? "").normalize("NFC").replace(/\r\n?/g, "\n")) {
      const cp = ch.codePointAt(0)!;
      if (ch === "\n") out += ch;
      else if (cp === 0x09 || cp === 0xa0) out += " ";
      else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp === 0x200b || cp === 0xfeff) continue;
      else out += has(cp) ? ch : "?";
    }
    return out;
  };
}

class Writer {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  /** Distance from the top edge of the page. */
  y = 0;

  constructor(
    private readonly pdf: PDFDocument,
    readonly fonts: Fonts,
    private readonly onNewPage: (w: Writer) => void,
  ) {}

  get limit() {
    return PAGE.h - M.bottom;
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE.w, PAGE.h]);
    this.pages.push(this.page);
    this.page.drawRectangle({ x: 0, y: PAGE.h - 5, width: PAGE.w, height: 5, color: NAVY });
    this.y = M.top;
    this.onNewPage(this);
  }

  /** Starts a new page when `height` does not fit. Returns whether it did. */
  ensure(height: number): boolean {
    if (this.y + height <= this.limit) return false;
    this.newPage();
    return true;
  }

  width(font: PDFFont, size: number, text: string) {
    return font.widthOfTextAtSize(text, size);
  }

  /** Draws one line of text inside a line box of `lineHeight` starting at the current y (does not advance y). */
  text(text: string, x: number, o: { font: PDFFont; size: number; color?: ReturnType<typeof rgb>; align?: "left" | "right"; lineHeight?: number; at?: number }) {
    if (!text) return;
    const lineHeight = o.lineHeight ?? o.size * 1.4;
    const top = o.at ?? this.y;
    const baseline = PAGE.h - (top + (lineHeight - o.size) / 2 + o.size * 0.8);
    const w = o.align === "right" ? this.width(o.font, o.size, text) : 0;
    this.page.drawText(text, { x: x - w, y: baseline, size: o.size, font: o.font, color: o.color ?? INK });
  }

  rule(y: number, x1: number, x2: number, color = LINE, thickness = 0.6) {
    this.page.drawLine({ start: { x: x1, y: PAGE.h - y }, end: { x: x2, y: PAGE.h - y }, thickness, color });
  }

  /** Greedy word wrap. Words longer than the line are broken by character. Deterministic for a given font. */
  wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      if (paragraph.trim() === "") {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of paragraph.split(" ")) {
        if (!word) continue;
        const trial = line ? `${line} ${word}` : word;
        if (this.width(font, size, trial) <= maxWidth) {
          line = trial;
          continue;
        }
        if (line) lines.push(line);
        line = "";
        if (this.width(font, size, word) <= maxWidth) {
          line = word;
          continue;
        }
        let chunk = "";
        for (const ch of word) {
          if (chunk && this.width(font, size, chunk + ch) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      }
      lines.push(line);
    }
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }
}

type Column = { key: "desc" | "qty" | "price" | "disc" | "vat" | "amount"; label: string; width: number; right: number };

export async function renderQuotePdf(input: QuotePdfInput, fontBytes?: PdfFontBytes): Promise<Uint8Array> {
  const { quote, settings } = input;
  const L: PdfLabels = PDF_LABELS[quote.language];
  const lang = quote.language;
  const money = (cents: number) => formatCents(cents, quote.currency, lang);
  const totals = quoteTotals(quote);

  const bytes = fontBytes ?? (await loadPdfFonts());
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const embed = (data: Uint8Array, name: string) => pdf.embedFont(data, { subset: true, customName: name });
  const fonts: Fonts = { regular: await embed(bytes.regular, "Geist-Regular"), medium: await embed(bytes.medium, "Geist-Medium"), semibold: await embed(bytes.semibold, "Geist-SemiBold") };
  const probe = fontkit.create(bytes.regular as Buffer);
  const clean = makeSanitizer((cp) => probe.hasGlyphForCodePoint(cp));

  pdf.setTitle(`${L.quote} ${quote.number}`);
  pdf.setAuthor(clean(settings.businessName));
  pdf.setSubject(clean(quote.title));
  pdf.setCreator("ianverlinden.com");
  pdf.setProducer("ianverlinden.com quotes");
  pdf.setKeywords([]);
  pdf.setCreationDate(new Date(quote.createdAt));
  pdf.setModificationDate(new Date(quote.updatedAt));

  const business = clean(settings.businessName) || "Ian Verlinden";

  // Table geometry. The discount column only exists when some line has a discount.
  const hasDiscount = quote.items.some((i) => Number(i.discountPercent) > 0);
  const cols: Column[] = [];
  {
    const widths = { qty: 58, price: 66, disc: 38, vat: 32, amount: 72 };
    const gap = 6;
    const order = (["qty", "price", ...(hasDiscount ? (["disc"] as const) : []), "vat", "amount"] as const).map((key) => ({ key, width: widths[key] }));
    const fixed = order.reduce((s, c) => s + c.width + gap, 0);
    cols.push({ key: "desc", label: L.description, width: W - fixed, right: M.left + W - fixed });
    let right = M.left + W - fixed + 0;
    for (const c of order) {
      right += gap + c.width;
      cols.push({ key: c.key, label: { qty: L.quantity, price: L.unitPrice, disc: L.discount, vat: L.vat, amount: L.total }[c.key], width: c.width, right });
    }
  }
  const descCol = cols[0];

  const drawTableHeader = (w: Writer) => {
    for (const c of cols) {
      if (c.key === "desc") w.text(c.label.toUpperCase(), M.left, { font: fonts.medium, size: 7.5, color: GREY, lineHeight: 14 });
      else w.text(c.label.toUpperCase(), c.right, { font: fonts.medium, size: 7.5, color: GREY, align: "right", lineHeight: 14 });
    }
    w.y += 16;
    w.rule(w.y, M.left, M.left + W, NAVY, 1);
    w.y += 6;
  };

  let inTable = false;
  const w = new Writer(pdf, fonts, (writer) => {
    if (writer.pages.length > 1) {
      writer.text(business, M.left, { font: fonts.semibold, size: 9, color: NAVY });
      writer.text(`${L.quote} ${quote.number} · ${L.continued}`, M.left + W, { font: fonts.regular, size: 9, color: GREY, align: "right" });
      writer.y += 30;
      if (inTable) drawTableHeader(writer);
    }
  });
  w.newPage();

  /* ------------------------------ letterhead ------------------------------ */
  const top = w.y;
  w.text(business, M.left, { font: fonts.semibold, size: 17, color: NAVY, lineHeight: 24 });
  if (settings.businessTagline.trim()) w.text(clean(settings.businessTagline), M.left, { font: fonts.regular, size: 9.5, color: GREY, lineHeight: 16, at: top + 25 });
  w.text(L.quote.toUpperCase(), M.left + W, { font: fonts.semibold, size: 24, color: NAVY, align: "right", lineHeight: 32, at: top - 2 });
  w.y = top + 66;

  /* ------------------------------ client + details ------------------------------ */
  const blockTop = w.y;
  const colW = 250;
  w.text(L.to.toUpperCase(), M.left, { font: fonts.medium, size: 7.5, color: GREY, lineHeight: 12 });
  let leftY = blockTop + 16;
  const company = clean(quote.clientCompany).trim();
  const person = clean(quote.clientName).trim();
  const clientLines: Array<{ text: string; font: PDFFont; size: number; color?: ReturnType<typeof rgb> }> = [];
  if (company) clientLines.push({ text: company, font: fonts.medium, size: 11 });
  if (person && person !== company) clientLines.push({ text: person, font: fonts.regular, size: 10 });
  for (const line of w.wrap(clean(quote.clientAddress), fonts.regular, 10, colW)) clientLines.push({ text: line, font: fonts.regular, size: 10 });
  if (quote.clientEmail?.trim()) clientLines.push({ text: clean(quote.clientEmail), font: fonts.regular, size: 10, color: GREY });
  for (const l of clientLines.flatMap((c) => w.wrap(c.text, c.font, c.size, colW).map((text) => ({ ...c, text })))) {
    w.text(l.text, M.left, { font: l.font, size: l.size, color: l.color, lineHeight: 15, at: leftY });
    leftY += 15;
  }

  const meta: Array<[string, string]> = [
    [L.quoteNumber, quote.number],
    [L.date, formatPdfDay(brusselsDay(quote.createdAt), lang)],
  ];
  if (quote.validUntil) meta.push([L.validUntil, formatPdfDay(quote.validUntil, lang)]);
  let rightY = blockTop;
  const metaX = M.left + W - 215;
  for (const [label, value] of meta) {
    w.text(label, metaX, { font: fonts.regular, size: 9, color: GREY, lineHeight: 17, at: rightY });
    w.text(value, M.left + W, { font: fonts.medium, size: 10, align: "right", lineHeight: 17, at: rightY });
    rightY += 18;
  }
  w.y = Math.max(leftY, rightY) + 26;

  /* ------------------------------ title + introduction ------------------------------ */
  const title = clean(quote.title).trim();
  if (title) {
    for (const line of w.wrap(title, fonts.semibold, 14, W)) {
      w.ensure(22);
      w.text(line, M.left, { font: fonts.semibold, size: 14, color: NAVY, lineHeight: 22 });
      w.y += 22;
    }
    w.y += 4;
  }
  const paragraph = (text: string, opts: { size?: number; color?: ReturnType<typeof rgb>; font?: PDFFont } = {}) => {
    const size = opts.size ?? 10;
    const lineHeight = size * 1.5;
    const lines = w.wrap(clean(text), opts.font ?? fonts.regular, size, W);
    lines.forEach((line, i) => {
      // Keep at least two lines together at the bottom of a page.
      w.ensure(i === 0 ? lineHeight * Math.min(2, lines.length) : lineHeight);
      w.text(line, M.left, { font: opts.font ?? fonts.regular, size, color: opts.color ?? INK, lineHeight });
      w.y += lineHeight;
    });
  };
  if (quote.intro?.trim()) {
    paragraph(quote.intro);
    w.y += 8;
  }
  w.y += 10;

  /* ------------------------------ line items ------------------------------ */
  w.ensure(16 + 6 + 40);
  inTable = true;
  drawTableHeader(w);

  const TITLE_LH = 15;
  const DESC_LH = 12.5;
  quote.items.forEach((item) => {
    const left: Array<{ text: string; font: PDFFont; size: number; lh: number; color?: ReturnType<typeof rgb> }> = [];
    for (const t of w.wrap(clean(item.title), fonts.medium, 10, descCol.width)) left.push({ text: t, font: fonts.medium, size: 10, lh: TITLE_LH });
    if (item.description?.trim()) for (const t of w.wrap(clean(item.description), fonts.regular, 8.5, descCol.width)) left.push({ text: t, font: fonts.regular, size: 8.5, lh: DESC_LH, color: GREY });
    if (left.length === 0) left.push({ text: "", font: fonts.medium, size: 10, lh: TITLE_LH });

    const qtyText = clean(`${formatQuantity(item.quantity, lang)}${item.unit ? ` ${item.unit}` : ""}`);
    const qtyCol = cols.find((c) => c.key === "qty")!;
    const qtyLines = w.wrap(qtyText, fonts.regular, 9.5, qtyCol.width);
    const cells: Array<[Column["key"], string]> = [
      ["price", money(item.unitPriceCents)],
      ["vat", formatPercent(item.taxRate, lang)],
      ["amount", money(item.subtotalCents)],
    ];
    if (hasDiscount) cells.push(["disc", Number(item.discountPercent) > 0 ? formatPercent(Number(item.discountPercent), lang) : "—"]);

    const leftHeight = left.reduce((s, l) => s + l.lh, 0);
    const rowHeight = Math.max(leftHeight, qtyLines.length * TITLE_LH);
    // A row starts only where its first two lines fit; longer descriptions continue on the next page.
    if (w.ensure(Math.min(rowHeight, left[0].lh + (left[1]?.lh ?? 0)))) {
      /* header was redrawn by the new page */
    }

    const startPage = w.pages.length;
    const rowTop = w.y;
    qtyLines.forEach((line, i) => w.text(line, qtyCol.right, { font: fonts.regular, size: 9.5, align: "right", lineHeight: TITLE_LH, at: rowTop + i * TITLE_LH }));
    for (const [key, value] of cells) {
      const c = cols.find((x) => x.key === key)!;
      w.text(value, c.right, { font: key === "amount" ? fonts.medium : fonts.regular, size: 9.5, color: key === "amount" ? INK : key === "price" ? INK : GREY, align: "right", lineHeight: TITLE_LH, at: rowTop });
    }
    left.forEach((l, i) => {
      if (i > 0) w.ensure(l.lh);
      w.text(l.text, M.left, { font: l.font, size: l.size, color: l.color, lineHeight: l.lh });
      w.y += l.lh;
    });
    if (w.pages.length === startPage) w.y = Math.max(w.y, rowTop + qtyLines.length * TITLE_LH);
    w.y += 8;
    w.rule(w.y - 1, M.left, M.left + W);
    w.y += 7;
  });
  inTable = false;

  /* ------------------------------ totals ------------------------------ */
  type Row = { label: string; value: string; hint?: string; strong?: boolean; muted?: boolean };
  const rows: Row[] = [];
  if (totals.discountTotal > 0) rows.push({ label: L.subtotal, value: money(totals.subtotal) }, { label: L.quoteDiscount, value: `− ${money(totals.discountTotal)}` });
  rows.push({ label: L.totalExclVat, value: money(totals.taxableTotal), strong: true });
  for (const v of totals.vat) rows.push({ label: L.vatRate(formatPercent(v.rate, lang)), value: money(v.tax), hint: L.onAmount(money(v.base)), muted: true });
  if (totals.vat.length > 1) rows.push({ label: L.totalVat, value: money(totals.taxTotal) });

  const BOX_W = 250;
  const boxX = M.left + W - BOX_W;
  const totalsHeight = rows.length * 17 + 14 + 30 + (totals.lineDiscountTotal > 0 ? 17 : 0);
  w.y += 4;
  w.ensure(totalsHeight);
  const totalsTop = w.y;
  w.text(L.amountsExclVat, M.left, { font: fonts.regular, size: 8, color: GREY, lineHeight: 17, at: totalsTop });
  if (totals.lineDiscountTotal > 0) {
    const label = lang === "nl" ? "Korting op regels (reeds verrekend)" : "Line discounts (already included)";
    w.text(label, boxX, { font: fonts.regular, size: 8.5, color: GREY, lineHeight: 17 });
    w.text(`− ${money(totals.lineDiscountTotal)}`, M.left + W, { font: fonts.regular, size: 8.5, color: GREY, align: "right", lineHeight: 17 });
    w.y += 17;
  }
  for (const row of rows) {
    w.text(row.label, boxX, { font: row.strong ? fonts.medium : fonts.regular, size: 9.5, color: row.muted ? GREY : INK, lineHeight: 17 });
    if (row.hint) {
      const labelWidth = w.width(row.strong ? fonts.medium : fonts.regular, 9.5, row.label);
      w.text(row.hint, boxX + labelWidth + 6, { font: fonts.regular, size: 8, color: GREY, lineHeight: 17 });
    }
    w.text(row.value, M.left + W, { font: row.strong ? fonts.medium : fonts.regular, size: 9.5, color: row.muted ? GREY : INK, align: "right", lineHeight: 17 });
    w.y += 17;
  }
  w.y += 4;
  w.rule(w.y, boxX, M.left + W, NAVY, 1);
  w.y += 4;
  w.text(L.totalInclVat, boxX, { font: fonts.semibold, size: 11, color: NAVY, lineHeight: 24 });
  w.text(money(totals.total), M.left + W, { font: fonts.semibold, size: 13, color: NAVY, align: "right", lineHeight: 24 });
  w.y += 24 + 22;

  /* ------------------------------ notes + terms ------------------------------ */
  const section = (heading: string, body: string | null | undefined) => {
    if (!body?.trim()) return;
    w.ensure(16 + 22 * 2);
    w.text(heading.toUpperCase(), M.left, { font: fonts.medium, size: 8, color: NAVY, lineHeight: 16 });
    w.y += 18;
    paragraph(body, { size: 9, color: INK });
    w.y += 14;
  };
  section(L.notes, quote.notes);
  section(L.terms, quote.terms);

  /* ------------------------------ footer on every page ------------------------------ */
  const contact = [settings.businessEmail, settings.businessWebsite, settings.businessPhone].map((s) => clean(s).trim()).filter(Boolean).join("  ·  ");
  const legal = [
    settings.businessAddress.trim() ? clean(settings.businessAddress).replace(/\n+/g, ", ") : "",
    settings.businessVatNumber.trim() ? `${L.vatNumber} ${clean(settings.businessVatNumber)}` : "",
    settings.businessIban.trim() ? `${L.iban} ${clean(settings.businessIban)}` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  const total = w.pages.length;
  w.pages.forEach((page, index) => {
    w.page = page;
    const base = PAGE.h - M.bottom + 14;
    w.rule(base, M.left, M.left + W);
    const lines = [[business, settings.businessTagline.trim() ? clean(settings.businessTagline) : ""].filter(Boolean).join("  ·  "), contact, legal].filter(Boolean);
    lines.forEach((line, i) => w.text(line, M.left, { font: i === 0 ? fonts.medium : fonts.regular, size: 8, color: i === 0 ? NAVY : GREY, lineHeight: 12, at: base + 8 + i * 12 }));
    w.text(L.page(index + 1, total), M.left + W, { font: fonts.regular, size: 8, color: GREY, align: "right", lineHeight: 12, at: base + 8 });
    w.text(quote.number, M.left + W, { font: fonts.medium, size: 8, color: GREY, align: "right", lineHeight: 12, at: base + 20 });
  });

  return pdf.save();
}
