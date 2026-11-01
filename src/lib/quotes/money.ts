/**
 * Quote arithmetic. The ONE implementation: the builder (live totals), the server action that saves, the PDF and the exports
 * all call `calculateQuote`, so a figure can never differ between screens.
 *
 * Exact decimal arithmetic on scaled integers (BigInt), never floating point:
 *   quantity   3 decimals   (1.5 hours)           -> thousandths
 *   unit price 2 decimals   (€ 47.50)             -> cents
 *   percentage 2 decimals   (12.5 % discount)     -> basis points (1 % = 100)
 *
 * Rounding rule (documented in docs/quotes.md): amounts are whole cents and every derived amount is rounded HALF UP to the cent
 * at the moment it is produced, in this order:
 *   1. line gross      = round(quantity x unit price)
 *   2. line discount   = round(gross x discount %)         line_subtotal = gross - discount          (excl. VAT)
 *   3. quote discount  = fixed amount, or round(sum of line_subtotal x discount %)
 *                        spread over the lines in proportion to line_subtotal (largest remainder, so the shares add up
 *                        to the discount to the cent)
 *   4. line VAT        = round((line_subtotal - share) x VAT %)  — VAT is rounded PER LINE; total VAT is the sum of the
 *                        rounded line VATs, so every figure on a quote adds up exactly.
 *   5. line total      = line_subtotal - share + line VAT
 * Totals are plain sums. All values are non-negative; negative quantities/prices and discounts above 100 % are rejected.
 */

export type DecimalInput = string | number | null | undefined;

export type DiscountInput = { type: "none" | "percent" | "fixed"; value: DecimalInput };

export type LineInput = {
  quantity: DecimalInput;
  unitPrice: DecimalInput;
  discountPercent?: DecimalInput;
  taxRate: DecimalInput;
};

export type LineResult = {
  /** quantity x unit price, before any discount. */
  gross: number;
  lineDiscount: number;
  /** After the line discount, before the quote-level discount (excl. VAT). */
  subtotal: number;
  /** This line's part of the quote-level discount. */
  quoteDiscountShare: number;
  tax: number;
  /** Incl. VAT. */
  total: number;
};

export type VatGroup = { rate: number; base: number; tax: number };

export type QuoteTotals = {
  lines: LineResult[];
  /** Sum of the lines' gross amounts (before every discount). */
  grossTotal: number;
  /** Sum of the per-line discounts. */
  lineDiscountTotal: number;
  /** Sum of line subtotals (after line discounts, excl. VAT). */
  subtotal: number;
  /** The quote-level discount. */
  discountTotal: number;
  /** subtotal - discountTotal: what VAT is charged on. */
  taxableTotal: number;
  taxTotal: number;
  /** Incl. VAT. */
  total: number;
  /** VAT per rate, ascending. */
  vat: VatGroup[];
};

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export const MAX_QUANTITY = 1_000_000;
export const MAX_UNIT_PRICE = 100_000_000;

/** Reads a decimal exactly (no float round-trip): "12,5" / "12.50" / 12.5 -> scaled integer. Throws on bad or too precise input. */
function scaled(value: DecimalInput, decimals: number, label: string): bigint {
  const text = value === null || value === undefined || value === "" ? "0" : typeof value === "number" ? numberToPlain(value, label) : value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) throw new MoneyError(`${label} must be a non-negative number.`);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.replace(/0+$/, "").length > decimals) throw new MoneyError(`${label} allows at most ${decimals} decimals.`);
  return BigInt(whole + fraction.padEnd(decimals, "0").slice(0, decimals));
}

function numberToPlain(n: number, label: string): string {
  if (!Number.isFinite(n) || n < 0) throw new MoneyError(`${label} must be a non-negative number.`);
  // toString switches to exponent form for very small/large numbers; toFixed(12) keeps the digits and the check above trims zeros.
  return /e/i.test(String(n)) ? n.toFixed(12) : String(n);
}

/** Round-half-up integer division for non-negative numbers. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  return (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
}

export function parseQuantity(value: DecimalInput): bigint {
  const q = scaled(value, 3, "Quantity");
  if (q > BigInt(MAX_QUANTITY) * BigInt(1000)) throw new MoneyError("Quantity is too large.");
  return q;
}

export function parsePriceCents(value: DecimalInput, label = "Price"): number {
  const cents = scaled(value, 2, label);
  if (cents > BigInt(MAX_UNIT_PRICE) * BigInt(100)) throw new MoneyError(`${label} is too large.`);
  return Number(cents);
}

function parseBasisPoints(value: DecimalInput, label: string): bigint {
  const bp = scaled(value, 2, label);
  if (bp > BigInt(10000)) throw new MoneyError(`${label} cannot be more than 100%.`);
  return bp;
}

/** Calculates one quote. Pure and deterministic; throws MoneyError for invalid input. */
export function calculateQuote(input: { lines: readonly LineInput[]; discount?: DiscountInput }): QuoteTotals {
  const base = input.lines.map((line, i) => {
    const n = i + 1;
    const quantity = parseQuantity(line.quantity);
    const priceCents = BigInt(parsePriceCents(line.unitPrice, `Line ${n}: price`));
    const gross = divRound(quantity * priceCents, BigInt(1000));
    const lineDiscount = divRound(gross * parseBasisPoints(line.discountPercent, `Line ${n}: discount`), BigInt(10000));
    return { gross, lineDiscount, subtotal: gross - lineDiscount, rate: parseBasisPoints(line.taxRate, `Line ${n}: VAT`) };
  });

  const subtotal = base.reduce((sum, l) => sum + l.subtotal, BigInt(0));
  const discount = input.discount ?? { type: "none", value: 0 };
  let quoteDiscount = BigInt(0);
  if (discount.type === "percent") quoteDiscount = divRound(subtotal * parseBasisPoints(discount.value, "Discount"), BigInt(10000));
  else if (discount.type === "fixed") quoteDiscount = BigInt(parsePriceCents(discount.value, "Discount"));
  if (quoteDiscount > subtotal) throw new MoneyError("The discount cannot be more than the subtotal.");

  const shares = allocate(quoteDiscount, base.map((l) => l.subtotal));
  const lines: LineResult[] = base.map((l, i) => {
    const taxable = l.subtotal - shares[i];
    const tax = divRound(taxable * l.rate, BigInt(10000));
    return {
      gross: Number(l.gross),
      lineDiscount: Number(l.lineDiscount),
      subtotal: Number(l.subtotal),
      quoteDiscountShare: Number(shares[i]),
      tax: Number(tax),
      total: Number(taxable + tax),
    };
  });

  const groups = new Map<bigint, VatGroup>();
  base.forEach((l, i) => {
    const group = groups.get(l.rate) ?? { rate: Number(l.rate) / 100, base: 0, tax: 0 };
    group.base += lines[i].subtotal - lines[i].quoteDiscountShare;
    group.tax += lines[i].tax;
    groups.set(l.rate, group);
  });

  const sum = (pick: (l: LineResult) => number) => lines.reduce((s, l) => s + pick(l), 0);
  const taxTotal = sum((l) => l.tax);
  return {
    lines,
    grossTotal: sum((l) => l.gross),
    lineDiscountTotal: sum((l) => l.lineDiscount),
    subtotal: Number(subtotal),
    discountTotal: Number(quoteDiscount),
    taxableTotal: Number(subtotal - quoteDiscount),
    taxTotal,
    total: Number(subtotal - quoteDiscount) + taxTotal,
    vat: [...groups.values()].sort((a, b) => a.rate - b.rate),
  };
}

/** Splits `amount` over `weights` in proportion, to the cent: floor shares, then the leftover cents go to the largest remainders (ties: earlier line). */
function allocate(amount: bigint, weights: readonly bigint[]): bigint[] {
  const total = weights.reduce((a, b) => a + b, BigInt(0));
  if (amount === BigInt(0) || total === BigInt(0)) return weights.map(() => BigInt(0));
  const parts = weights.map((w, i) => ({ i, share: (amount * w) / total, remainder: (amount * w) % total }));
  let left = amount - parts.reduce((s, p) => s + p.share, BigInt(0));
  for (const p of [...parts].sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1))) {
    if (left <= BigInt(0)) break;
    p.share += BigInt(1);
    left -= BigInt(1);
  }
  return parts.map((p) => p.share);
}

/** 123450 -> "1234.50": the exact decimal string for a numeric column. */
export function centsToDecimal(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

/** "1234.50" (numeric column) -> 123450 cents. */
export function decimalToCents(value: string | number | null | undefined): number {
  return parsePriceCents(value ?? 0);
}

/** "1.5" -> exact thousandths as plain text with up to 3 decimals ("1.5", "2", "0.125"). */
export function plainQuantity(value: DecimalInput): string {
  const q = parseQuantity(value);
  const whole = q / BigInt(1000);
  const fraction = (q % BigInt(1000)).toString().padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(locale: string, currency: string) {
  const key = `${locale}|${currency}`;
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })));
  return f;
}

/** Cents -> "€ 1.234,50" (nl-BE) or "€1,234.50" (en). Always two decimals on a quote. */
export function formatCents(cents: number, currency = "EUR", locale: "nl" | "en" = "nl"): string {
  return formatter(locale === "nl" ? "nl-BE" : "en-GB", currency).format(cents / 100).replace(/ /g, " ");
}

/** A quantity as people read it: 1, 2.5, 0.125 (nl uses a comma). */
export function formatQuantity(value: DecimalInput, locale: "nl" | "en" = "nl"): string {
  const text = plainQuantity(value);
  return locale === "nl" ? text.replace(".", ",") : text;
}

export function formatPercent(value: number, locale: "nl" | "en" = "nl"): string {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${locale === "nl" ? text.replace(".", ",") : text}%`;
}
