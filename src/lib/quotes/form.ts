import { centsToDecimal } from "./money";
import { DEFAULT_VAT_RATE, defaultValidUntil } from "./constants";
import { emptyItem, emptyQuoteForm, newItemKey, type ItemFormValues, type QuoteFormValues } from "./schema";
import type { QuoteRecord, QuoteSettings, QuoteTemplateRecord } from "./types";

export const DEFAULT_SETTINGS: QuoteSettings = {
  defaultLanguage: "nl",
  defaultTaxRate: DEFAULT_VAT_RATE,
  defaultValidityDays: 14,
  defaultIntro: "",
  defaultTerms: "",
  businessName: "Ian Verlinden",
  businessTagline: "Web Design & Development",
  businessEmail: "hello@ianverlinden.com",
  businessWebsite: "ianverlinden.com",
  businessPhone: "",
  businessAddress: "",
  businessVatNumber: "",
  businessIban: "",
};

/** A saved quote as the builder holds it. */
export function formFromQuote(quote: QuoteRecord): QuoteFormValues {
  return {
    prospectId: quote.prospectId ?? "",
    language: quote.language,
    clientName: quote.clientName ?? "",
    clientCompany: quote.clientCompany ?? "",
    clientEmail: quote.clientEmail ?? "",
    clientAddress: quote.clientAddress ?? "",
    title: quote.title ?? "",
    intro: quote.intro ?? "",
    currency: quote.currency,
    discountType: quote.discountType,
    discountValue: quote.discountType === "none" ? "" : quote.discountValue,
    validUntil: quote.validUntil ?? "",
    notes: quote.notes ?? "",
    terms: quote.terms ?? "",
    items: quote.items.map(
      (i): ItemFormValues => ({
        key: newItemKey(),
        templateId: i.templateId ?? "",
        title: i.title,
        description: i.description ?? "",
        quantity: i.quantity,
        unit: i.unit ?? "",
        unitPrice: centsToDecimal(i.unitPriceCents),
        discountPercent: Number(i.discountPercent) === 0 ? "" : i.discountPercent,
        taxRate: String(i.taxRate),
      }),
    ),
  };
}

/** A new quote: the settings' language, validity, intro and terms; optionally prefilled from a prospect (nothing is invented). */
export function newQuoteForm(settings: QuoteSettings, prospect?: { id: string; companyName: string; contactName: string | null; email: string | null }): QuoteFormValues {
  return emptyQuoteForm({
    prospectId: prospect?.id ?? "",
    language: settings.defaultLanguage,
    // The quote is addressed to the contact person when there is one, and to the company otherwise.
    clientName: prospect ? (prospect.contactName?.trim() || prospect.companyName) : "",
    clientCompany: prospect ? prospect.companyName : "",
    clientEmail: prospect?.email ?? "",
    validUntil: defaultValidUntil(settings.defaultValidityDays),
    intro: settings.defaultIntro,
    terms: settings.defaultTerms,
    items: [],
  });
}

/** A template added to a quote becomes an editable snapshot line. */
export function itemFromTemplate(template: QuoteTemplateRecord, settings: Pick<QuoteSettings, "defaultTaxRate">): ItemFormValues {
  return emptyItem({
    templateId: template.id,
    title: template.name,
    description: template.description,
    quantity: "1",
    unit: template.defaultUnit,
    unitPrice: template.defaultUnitPrice,
    taxRate: String(template.defaultTaxRate ?? settings.defaultTaxRate),
  });
}
