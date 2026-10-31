import { z } from "zod";
import {
  DELIVERY_STATUSES,
  PROSPECT_PRIORITIES,
  PROSPECT_STATUSES,
  type DeliveryStatus,
  type ProspectPriority,
  type ProspectStatus,
} from "@/lib/prospects/constants";
import { isIsoDay } from "@/lib/prospects/dates";
import { parseMoney } from "@/lib/prospects/money";

/** Values exactly as the form holds them (all strings). */
export type ProspectFormValues = {
  companyName: string;
  sector: string;
  city: string;
  websiteUrl: string;
  email: string;
  contactName: string;
  phone: string;
  status: ProspectStatus;
  priority: ProspectPriority;
  estimatedValue: string;
  quoteValue: string;
  firstContactOn: string;
  lastContactOn: string;
  nextFollowUpOn: string;
  deliveryStatus: DeliveryStatus;
  source: string;
  notes: string;
};

export const emptyProspectForm: ProspectFormValues = {
  companyName: "",
  sector: "",
  city: "",
  websiteUrl: "",
  email: "",
  contactName: "",
  phone: "",
  status: "new",
  priority: "normal",
  estimatedValue: "",
  quoteValue: "",
  firstContactOn: "",
  lastContactOn: "",
  nextFollowUpOn: "",
  deliveryStatus: "unknown",
  source: "",
  notes: "",
};

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

const optionalDay = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || isIsoDay(v), `Pick a valid ${label}.`)
    .transform((v) => (v === "" ? null : v));

const optionalMoney = (label: string) =>
  z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      if (v !== "" && parseMoney(v) === null) ctx.addIssue({ code: "custom", message: `Enter the ${label} as a number, for example 1500.` });
    })
    .transform((v) => (v === "" ? null : parseMoney(v)));

/** Website: kept as typed, but must be a real http(s) address (a bare domain gets https://). */
export function normalizeWebsite(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withProtocol);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return null;
    return withProtocol;
  } catch {
    return null;
  }
}

export const prospectFormSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "Enter the company name.")
    .max(200, "Keep the company name under 200 characters."),
  sector: optionalText("sector", 120),
  city: optionalText("city", 120),
  websiteUrl: z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      if (v !== "" && normalizeWebsite(v) === null) ctx.addIssue({ code: "custom", message: "Enter a valid website address." });
    })
    .transform((v) => normalizeWebsite(v)),
  email: z
    .string()
    .trim()
    .max(320, "Keep the email under 320 characters.")
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address.")
    .transform((v) => (v === "" ? null : v)),
  contactName: optionalText("contact person", 160),
  phone: optionalText("phone number", 60),
  status: z.enum(PROSPECT_STATUSES),
  priority: z.enum(PROSPECT_PRIORITIES),
  estimatedValue: optionalMoney("estimated value"),
  quoteValue: optionalMoney("quote value"),
  firstContactOn: optionalDay("first contact date"),
  lastContactOn: optionalDay("last contact date"),
  nextFollowUpOn: optionalDay("follow-up date"),
  deliveryStatus: z.enum(DELIVERY_STATUSES),
  source: optionalText("source", 160),
  notes: optionalText("notes", 10000),
});
export type ProspectInput = z.output<typeof prospectFormSchema>;

/** Database column payload for a validated form. */
export function toProspectRow(v: ProspectInput) {
  return {
    company_name: v.companyName,
    sector: v.sector,
    city: v.city,
    website_url: v.websiteUrl,
    email: v.email,
    contact_name: v.contactName,
    phone: v.phone,
    status: v.status,
    priority: v.priority,
    estimated_value_eur: v.estimatedValue,
    quote_value_eur: v.quoteValue,
    first_contact_on: v.firstContactOn,
    last_contact_on: v.lastContactOn,
    next_follow_up_on: v.nextFollowUpOn,
    contact_delivery_status: v.deliveryStatus,
    source: v.source,
    notes: v.notes,
  };
}

/** Same schema on the client and on the server; returns `{ "<field>": message }` for the first error per field. */
export function validateProspectForm(
  values: unknown,
): { ok: true; data: ProspectInput } | { ok: false; errors: Record<string, string> } {
  const parsed = prospectFormSchema.safeParse(values);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".");
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

export const idSchema = z.uuid();
export const idListSchema = z.array(z.uuid()).min(1).max(500);

/** Form values for an existing prospect (amounts as plain numbers, blanks as empty strings). */
export function prospectToFormValues(p: {
  company_name: string;
  sector: string | null;
  city: string | null;
  website_url: string | null;
  email: string | null;
  contact_name: string | null;
  phone: string | null;
  status: ProspectStatus;
  priority: ProspectPriority;
  estimated_value_eur: number | null;
  quote_value_eur: number | null;
  first_contact_on: string | null;
  last_contact_on: string | null;
  next_follow_up_on: string | null;
  contact_delivery_status: DeliveryStatus;
  source: string | null;
  notes: string | null;
}): ProspectFormValues {
  return {
    companyName: p.company_name,
    sector: p.sector ?? "",
    city: p.city ?? "",
    websiteUrl: p.website_url ?? "",
    email: p.email ?? "",
    contactName: p.contact_name ?? "",
    phone: p.phone ?? "",
    status: p.status,
    priority: p.priority,
    estimatedValue: p.estimated_value_eur === null ? "" : String(p.estimated_value_eur),
    quoteValue: p.quote_value_eur === null ? "" : String(p.quote_value_eur),
    firstContactOn: p.first_contact_on ?? "",
    lastContactOn: p.last_contact_on ?? "",
    nextFollowUpOn: p.next_follow_up_on ?? "",
    deliveryStatus: p.contact_delivery_status,
    source: p.source ?? "",
    notes: p.notes ?? "",
  };
}
