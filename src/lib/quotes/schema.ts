import { isIsoDay } from "@/lib/prospects/dates";
import {
  CURRENCIES,
  DEFAULT_VAT_RATE,
  DISCOUNT_TYPES,
  MAX_ITEMS,
  QUOTE_LANGUAGES,
  VAT_RATES,
  type DiscountType,
  type QuoteCurrency,
  type QuoteLanguage,
} from "./constants";
import { calculateQuote, centsToDecimal, MoneyError, parseQuantity, plainQuantity, type QuoteTotals } from "./money";

/** A line exactly as the builder holds it (all strings, so typing "1." or "" never breaks). `key` is only for React. */
export type ItemFormValues = {
  key: string;
  templateId: string;
  title: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
};

export type QuoteFormValues = {
  prospectId: string;
  language: QuoteLanguage;
  clientName: string;
  clientCompany: string;
  clientEmail: string;
  clientAddress: string;
  title: string;
  intro: string;
  currency: QuoteCurrency;
  discountType: DiscountType;
  discountValue: string;
  validUntil: string;
  notes: string;
  terms: string;
  items: ItemFormValues[];
};

let counter = 0;
export const newItemKey = () => `i${Date.now().toString(36)}${(counter++).toString(36)}`;

export function emptyItem(overrides: Partial<ItemFormValues> = {}): ItemFormValues {
  return { key: newItemKey(), templateId: "", title: "", description: "", quantity: "1", unit: "", unitPrice: "", discountPercent: "", taxRate: String(DEFAULT_VAT_RATE), ...overrides };
}

export function emptyQuoteForm(overrides: Partial<QuoteFormValues> = {}): QuoteFormValues {
  return {
    prospectId: "",
    language: "nl",
    clientName: "",
    clientCompany: "",
    clientEmail: "",
    clientAddress: "",
    title: "",
    intro: "",
    currency: "EUR",
    discountType: "none",
    discountValue: "",
    validUntil: "",
    notes: "",
    terms: "",
    items: [],
    ...overrides,
  };
}

/** The numbers of a form, or the first reason they cannot be added up. Blank amounts count as 0 so totals update while typing. */
export function calculateForm(values: Pick<QuoteFormValues, "items" | "discountType" | "discountValue">): { totals: QuoteTotals; error: null } | { totals: null; error: string } {
  try {
    const totals = calculateQuote({
      lines: values.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, discountPercent: i.discountPercent, taxRate: i.taxRate })),
      discount: { type: values.discountType, value: values.discountValue },
    });
    return { totals, error: null };
  } catch (error) {
    return { totals: null, error: error instanceof MoneyError ? error.message : "The amounts could not be calculated." };
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITS = { clientName: 200, clientCompany: 200, clientEmail: 320, clientAddress: 1000, title: 200, intro: 5000, notes: 5000, terms: 10000, itemTitle: 200, itemDescription: 5000, unit: 30 };

export type FieldErrors = Record<string, string>;

/** Rules that must hold for any save (drafts may be incomplete, but never malformed). */
export function validateDraft(values: QuoteFormValues): FieldErrors {
  const errors: FieldErrors = {};
  const tooLong = (field: keyof typeof LIMITS, value: string, label: string) => {
    if (value.trim().length > LIMITS[field]) errors[field] = `Keep the ${label} under ${LIMITS[field]} characters.`;
  };
  tooLong("clientName", values.clientName, "client name");
  tooLong("clientCompany", values.clientCompany, "company");
  tooLong("clientAddress", values.clientAddress, "address");
  tooLong("title", values.title, "title");
  tooLong("intro", values.intro, "introduction");
  tooLong("notes", values.notes, "notes");
  tooLong("terms", values.terms, "terms");
  if (values.clientEmail.trim() && (!EMAIL.test(values.clientEmail.trim()) || values.clientEmail.trim().length > LIMITS.clientEmail)) errors.clientEmail = "Enter a valid email address.";
  if (!QUOTE_LANGUAGES.includes(values.language)) errors.language = "Choose a language.";
  if (!CURRENCIES.includes(values.currency)) errors.currency = "Choose a currency.";
  if (!DISCOUNT_TYPES.includes(values.discountType)) errors.discountType = "Choose a discount type.";
  if (values.validUntil && !isIsoDay(values.validUntil)) errors.validUntil = "Enter a valid date.";
  if (values.items.length > MAX_ITEMS) errors.items = `A quote can have at most ${MAX_ITEMS} lines.`;

  values.items.forEach((item, i) => {
    const at = (field: string) => `items.${i}.${field}`;
    if (item.title.trim().length > LIMITS.itemTitle) errors[at("title")] = `Keep the title under ${LIMITS.itemTitle} characters.`;
    if (item.description.trim().length > LIMITS.itemDescription) errors[at("description")] = `Keep the description under ${LIMITS.itemDescription} characters.`;
    if (item.unit.trim().length > LIMITS.unit) errors[at("unit")] = `Keep the unit under ${LIMITS.unit} characters.`;
    if (!VAT_RATES.some((r) => String(r) === item.taxRate.trim())) errors[at("taxRate")] = "Choose 0%, 6%, 12% or 21%.";
    try {
      parseQuantity(item.quantity);
    } catch (e) {
      errors[at("quantity")] = e instanceof MoneyError ? e.message : "Enter a quantity.";
    }
  });

  // Prices, percentages and the discount all go through the one calculator. Each line is checked on its own so every bad field is named.
  const FIELD_OF = { price: "unitPrice", discount: "discountPercent", VAT: "taxRate" } as const;
  values.items.forEach((item, i) => {
    try {
      calculateQuote({ lines: [{ quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: item.discountPercent, taxRate: item.taxRate }] });
    } catch (e) {
      const msg = e instanceof MoneyError ? e.message : "Check the amounts.";
      const kind = /^Line \d+: (price|discount|VAT)/.exec(msg)?.[1] as keyof typeof FIELD_OF | undefined;
      const key = `items.${i}.${kind ? FIELD_OF[kind] : "quantity"}`;
      if (!errors[key]) errors[key] = msg.replace(/^Line \d+: /, "");
    }
  });
  if (!Object.keys(errors).some((k) => k.startsWith("items."))) {
    const calc = calculateForm(values);
    if (calc.error) errors[/discount/i.test(calc.error) ? "discountValue" : "items"] = calc.error;
  }
  return errors;
}

/** What is still missing before a quote can be marked Ready / Sent. Empty = complete. */
export function readinessIssues(values: QuoteFormValues): string[] {
  const issues: string[] = [];
  if (!values.clientName.trim()) issues.push("Add the client's name.");
  if (!values.title.trim()) issues.push("Add a title.");
  if (values.items.length === 0) issues.push("Add at least one line item.");
  values.items.forEach((item, i) => {
    if (!item.title.trim()) issues.push(`Line ${i + 1}: add a title.`);
    try {
      if (parseQuantity(item.quantity) === BigInt(0)) issues.push(`Line ${i + 1}: the quantity must be more than 0.`);
    } catch {
      issues.push(`Line ${i + 1}: enter a valid quantity.`);
    }
  });
  if (!CURRENCIES.includes(values.currency)) issues.push("Choose a valid currency.");
  if (!values.validUntil || !isIsoDay(values.validUntil)) issues.push("Choose a valid-until date.");
  return issues;
}

const nul = (v: string) => (v.trim() === "" ? null : v.trim());

/** The JSON the create_quote / update_quote functions take: text snapshots plus the figures calculated here. Throws if invalid. */
export function toRpcPayload(values: QuoteFormValues): { quote: Record<string, unknown>; items: Record<string, unknown>[]; totals: QuoteTotals } {
  const errors = validateDraft(values);
  if (Object.keys(errors).length) throw new MoneyError(Object.values(errors)[0]);
  const { totals } = calculateForm(values) as { totals: QuoteTotals };
  const quote = {
    prospect_id: nul(values.prospectId),
    language: values.language,
    client_name: nul(values.clientName),
    client_company: nul(values.clientCompany),
    client_email: nul(values.clientEmail),
    client_address: nul(values.clientAddress),
    title: nul(values.title),
    intro: nul(values.intro),
    notes: nul(values.notes),
    terms: nul(values.terms),
    currency: values.currency,
    discount_type: values.discountType,
    discount_value: values.discountType === "none" ? "0" : twoDecimals(values.discountValue),
    subtotal: centsToDecimal(totals.subtotal),
    discount_total: centsToDecimal(totals.discountTotal),
    tax_total: centsToDecimal(totals.taxTotal),
    total: centsToDecimal(totals.total),
    valid_until: nul(values.validUntil),
  };
  const items = values.items.map((item, i) => ({
    template_id: nul(item.templateId),
    // A blank title can exist in a draft; the table requires one, so keep a visible placeholder rather than failing the save.
    title: item.title.trim() || "—",
    description: nul(item.description),
    quantity: plainQuantity(item.quantity),
    unit: nul(item.unit),
    unit_price: twoDecimals(item.unitPrice),
    discount_percent: percentToDecimal(item.discountPercent),
    tax_rate: percentToDecimal(item.taxRate),
    line_subtotal: centsToDecimal(totals.lines[i].subtotal),
    quote_discount_share: centsToDecimal(totals.lines[i].quoteDiscountShare),
    line_tax: centsToDecimal(totals.lines[i].tax),
    line_total: centsToDecimal(totals.lines[i].total),
  }));
  return { quote, items, totals };
}

/** A validated amount or percentage with exactly two decimals ("12.5" -> "12.50"); blank is 0. */
function twoDecimals(value: string): string {
  return centsToDecimal(calculateQuote({ lines: [{ quantity: 1, unitPrice: value, taxRate: 0 }] }).lines[0].gross);
}

function percentToDecimal(value: string): string {
  const text = value.trim().replace(",", ".") || "0";
  const [whole, fraction = ""] = text.split(".");
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}
