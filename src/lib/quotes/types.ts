import type { Database } from "@/types/database";
import type { DiscountType, QuoteCurrency, QuoteLanguage, QuoteStatus } from "./constants";
import { decimalToCents, plainQuantity } from "./money";

type Tables = Database["public"]["Tables"];
export type QuoteRow = Tables["quotes"]["Row"];
export type QuoteItemRow = Tables["quote_items"]["Row"];

/** One line as the admin screens and the PDF read it. Money is whole cents; quantity/percentages stay exact decimal strings. */
export type QuoteItemRecord = {
  id: string;
  position: number;
  templateId: string | null;
  title: string;
  description: string | null;
  quantity: string;
  unit: string | null;
  unitPriceCents: number;
  discountPercent: string;
  taxRate: number;
  subtotalCents: number;
  quoteDiscountShareCents: number;
  taxCents: number;
  totalCents: number;
};

export type QuoteRecord = {
  id: string;
  number: string;
  status: QuoteStatus;
  statusNote: string | null;
  language: QuoteLanguage;
  prospectId: string | null;
  projectId: string | null;
  clientName: string | null;
  clientCompany: string | null;
  clientEmail: string | null;
  clientAddress: string | null;
  title: string | null;
  intro: string | null;
  notes: string | null;
  terms: string | null;
  currency: QuoteCurrency;
  discountType: DiscountType;
  /** Percentage ("10.00") or amount ("50.00"), as stored. */
  discountValue: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  items: QuoteItemRecord[];
};

/** A quote row plus the prospect it points at (for list and detail screens). */
export type QuoteProspect = { id: string; companyName: string; status: string; quoteValueCents: number | null };
export type QuoteWithProspect = QuoteRecord & { prospect: QuoteProspect | null };

export type QuoteActivityRecord = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type QuoteSettings = {
  defaultLanguage: QuoteLanguage;
  defaultTaxRate: number;
  defaultValidityDays: number;
  defaultIntro: string;
  defaultTerms: string;
  businessName: string;
  businessTagline: string;
  businessEmail: string;
  businessWebsite: string;
  businessPhone: string;
  businessAddress: string;
  businessVatNumber: string;
  businessIban: string;
};

export type QuoteTemplateRecord = {
  id: string;
  name: string;
  description: string;
  defaultUnit: string;
  /** Decimal string ("800.00") or "" when no price is set. */
  defaultUnitPrice: string;
  defaultTaxRate: number;
  active: boolean;
  sortOrder: number;
};

const percent = (value: number | string) => {
  const [whole, fraction = ""] = String(value).split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
};

export function toItemRecord(row: QuoteItemRow): QuoteItemRecord {
  return {
    id: row.id,
    position: row.position,
    templateId: row.template_id,
    title: row.title,
    description: row.description,
    quantity: plainQuantity(row.quantity),
    unit: row.unit,
    unitPriceCents: decimalToCents(row.unit_price),
    discountPercent: percent(row.discount_percent),
    taxRate: Number(row.tax_rate),
    subtotalCents: decimalToCents(row.line_subtotal),
    quoteDiscountShareCents: decimalToCents(row.quote_discount_share),
    taxCents: decimalToCents(row.line_tax),
    totalCents: decimalToCents(row.line_total),
  };
}

export function toQuoteRecord(row: QuoteRow, items: readonly QuoteItemRow[] = []): QuoteRecord {
  return {
    id: row.id,
    number: row.quote_number,
    status: row.status as QuoteStatus,
    statusNote: row.status_note,
    language: row.language as QuoteLanguage,
    prospectId: row.prospect_id,
    projectId: row.project_id,
    clientName: row.client_name,
    clientCompany: row.client_company,
    clientEmail: row.client_email,
    clientAddress: row.client_address,
    title: row.title,
    intro: row.intro,
    notes: row.notes,
    terms: row.terms,
    currency: row.currency as QuoteCurrency,
    discountType: row.discount_type as DiscountType,
    discountValue: Number(row.discount_value).toFixed(2),
    subtotalCents: decimalToCents(row.subtotal),
    discountCents: decimalToCents(row.discount_total),
    taxCents: decimalToCents(row.tax_total),
    totalCents: decimalToCents(row.total),
    validUntil: row.valid_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
    rejectedAt: row.rejected_at,
    items: [...items].sort((a, b) => a.position - b.position).map(toItemRecord),
  };
}
