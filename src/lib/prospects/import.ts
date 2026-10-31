import { DELIVERY_STATUSES, PROSPECT_PRIORITIES, PROSPECT_STATUSES, type DeliveryStatus, type ProspectPriority, type ProspectStatus } from "./constants";
import { parseFlexibleDay } from "./dates";
import { parseMoney } from "./money";
import { emptyProspectForm, validateProspectForm, type ProspectFormValues, type ProspectInput } from "@/lib/schemas/prospect";

/** Fields a file column can be mapped to. */
export const IMPORT_FIELDS = [
  { key: "companyName", label: "Company", required: true },
  { key: "sector", label: "Sector" },
  { key: "city", label: "City" },
  { key: "websiteUrl", label: "Website" },
  { key: "email", label: "Email" },
  { key: "contactName", label: "Contact person" },
  { key: "phone", label: "Phone" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "firstContactOn", label: "First contact" },
  { key: "lastContactOn", label: "Last contact" },
  { key: "nextFollowUpOn", label: "Next follow-up" },
  { key: "estimatedValue", label: "Estimated value (€)" },
  { key: "quoteValue", label: "Quote (€)" },
  { key: "deliveryStatus", label: "Sending confirmed" },
  { key: "source", label: "Source" },
  { key: "notes", label: "Notes" },
  { key: "lastAction", label: "Last action" },
] as const;
export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export type ColumnMapping = Partial<Record<ImportFieldKey, number | null>>;

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Header names (Dutch and English, plus the legacy tracker's) recognised for each field. */
const HEADER_ALIASES: Record<ImportFieldKey, string[]> = {
  companyName: ["company", "company name", "bedrijf", "bedrijfsnaam", "naam", "name"],
  sector: ["sector", "branche", "industry"],
  city: ["city", "stad", "gemeente", "plaats"],
  websiteUrl: ["website", "website url", "url", "site", "web"],
  email: ["email", "e mail", "e mailadres", "emailadres", "mail"],
  contactName: ["contact", "contact person", "contactpersoon", "contact name", "contact naam"],
  phone: ["phone", "telefoon", "tel", "telefoonnummer", "gsm"],
  status: ["status"],
  priority: ["priority", "prioriteit"],
  firstContactOn: ["first contact", "eerste contact"],
  lastContactOn: ["last contact", "laatste contact"],
  nextFollowUpOn: ["next follow up", "next follow up date", "follow up", "volgende opvolging", "opvolging"],
  estimatedValue: ["estimated value", "estimated value eur", "estimated value ", "geschatte waarde", "geschatte waarde eur", "value", "waarde"],
  quoteValue: ["quote", "quote value", "quote eur", "quote value eur", "offerte", "offerte eur"],
  deliveryStatus: ["delivery confirmed", "sending confirmed", "contact delivery status", "verzending bevestigd", "verzending"],
  source: ["source", "bron"],
  notes: ["notes", "note", "notities", "notitie", "opmerkingen"],
  lastAction: ["last action", "laatste actie"],
};

/** Best-guess column mapping from the header row. Unmatched fields stay unmapped (null). */
export function autoMapColumns(headers: readonly string[]): ColumnMapping {
  const folded = headers.map(fold);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const aliases = HEADER_ALIASES[field.key].map(fold);
    const index = folded.findIndex((h, i) => !used.has(i) && aliases.includes(h));
    if (index !== -1) {
      mapping[field.key] = index;
      used.add(index);
    } else mapping[field.key] = null;
  }
  return mapping;
}

const STATUS_WORDS: Record<string, ProspectStatus> = {
  nieuw: "new",
  onderzoek: "researching",
  "in onderzoek": "researching",
  "klaar om te contacteren": "ready_to_contact",
  "klaar voor contact": "ready_to_contact",
  gecontacteerd: "contacted",
  "contact gelegd": "contacted",
  "opvolging nodig": "follow_up_due",
  "opvolging verschuldigd": "follow_up_due",
  "reactie ontvangen": "replied",
  geantwoord: "replied",
  "geinteresseerd": "interested",
  "concept verstuurd": "concept_sent",
  "concept gestuurd": "concept_sent",
  "meeting gepland": "meeting_planned",
  "afspraak gepland": "meeting_planned",
  "offerte verstuurd": "quote_sent",
  "offerte gestuurd": "quote_sent",
  gewonnen: "won",
  verloren: "lost",
  "geen interesse": "not_interested",
  "geen reactie": "no_response",
};
const PRIORITY_WORDS: Record<string, ProspectPriority> = { laag: "low", normaal: "normal", hoog: "high", dringend: "urgent", urgent: "urgent" };

export function parseStatus(raw: string): ProspectStatus | null {
  const key = fold(raw);
  if (!key) return null;
  const direct = PROSPECT_STATUSES.find((s) => fold(s) === key || fold(s.replace(/_/g, " ")) === key);
  return direct ?? STATUS_WORDS[key] ?? null;
}
export function parsePriority(raw: string): ProspectPriority | null {
  const key = fold(raw);
  if (!key) return null;
  return PROSPECT_PRIORITIES.find((p) => p === key) ?? PRIORITY_WORDS[key] ?? null;
}
export function parseDelivery(raw: string): DeliveryStatus | null {
  if (!raw.trim()) return "unknown";
  const key = fold(raw);
  if (["ja", "yes", "true", "confirmed", "bevestigd", "1"].includes(key)) return "confirmed";
  if (["controleer", "check", "verify", "needs verification", "needs_verification", "nakijken"].includes(key)) return "needs_verification";
  if (["unknown", "onbekend", "nee", "no", "false", "0"].includes(key)) return "unknown";
  return (DELIVERY_STATUSES as readonly string[]).includes(key) ? (key as DeliveryStatus) : null;
}

export type ImportCandidate = {
  /** 1-based row number in the file (header is row 1). */
  row: number;
  values: ProspectFormValues;
  /** Valid, normalised input; null when the row has errors. */
  input: ProspectInput | null;
  lastAction: string;
  errors: string[];
  warnings: string[];
};

const text = (cell: unknown): string => {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return parseFlexibleDay(cell) ?? "";
  return String(cell).trim();
};

/** Turns one file row into a validated candidate. Nothing is guessed: unknown values are errors, blanks stay blank. */
export function buildCandidate(cells: readonly unknown[], mapping: ColumnMapping, rowNumber: number): ImportCandidate {
  const get = (key: ImportFieldKey) => {
    const index = mapping[key];
    return index === null || index === undefined ? "" : text(cells[index]);
  };
  const errors: string[] = [];
  const warnings: string[] = [];
  const values: ProspectFormValues = { ...emptyProspectForm };

  values.companyName = get("companyName");
  values.sector = get("sector");
  values.city = get("city");
  values.websiteUrl = get("websiteUrl");
  values.email = get("email");
  values.contactName = get("contactName");
  values.phone = get("phone");
  values.source = get("source");
  values.notes = get("notes");

  const statusRaw = get("status");
  if (statusRaw) {
    const status = parseStatus(statusRaw);
    if (status) values.status = status;
    else errors.push(`Unknown status "${statusRaw}".`);
  }
  const priorityRaw = get("priority");
  if (priorityRaw) {
    const priority = parsePriority(priorityRaw);
    if (priority) values.priority = priority;
    else errors.push(`Unknown priority "${priorityRaw}".`);
  }
  const deliveryRaw = get("deliveryStatus");
  const delivery = parseDelivery(deliveryRaw);
  if (delivery) values.deliveryStatus = delivery;
  else warnings.push(`Unrecognised sending status "${deliveryRaw}"; stored as unknown.`);

  for (const [key, label] of [
    ["firstContactOn", "first contact"],
    ["lastContactOn", "last contact"],
    ["nextFollowUpOn", "next follow-up"],
  ] as const) {
    const index = mapping[key];
    const raw = index === null || index === undefined ? "" : cells[index];
    if (raw === "" || raw === null || raw === undefined) continue;
    const day = parseFlexibleDay(raw);
    if (day) values[key] = day;
    else errors.push(`Invalid ${label} date "${text(raw)}".`);
  }
  for (const [key, label] of [
    ["estimatedValue", "estimated value"],
    ["quoteValue", "quote"],
  ] as const) {
    const index = mapping[key];
    const raw = index === null || index === undefined ? "" : cells[index];
    if (raw === "" || raw === null || raw === undefined) continue;
    const amount = parseMoney(raw);
    if (amount === null) errors.push(`Invalid ${label} "${text(raw)}".`);
    else values[key] = String(amount);
  }

  if (!values.companyName) errors.push("Company name is missing.");

  const checked = validateProspectForm(values);
  if (!checked.ok) for (const message of Object.values(checked.errors)) if (!errors.includes(message)) errors.push(message);

  return {
    row: rowNumber,
    values,
    input: errors.length === 0 && checked.ok ? checked.data : null,
    lastAction: get("lastAction"),
    errors,
    warnings,
  };
}

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** A cell value as the wizard shows and stores it (dates become ISO days, everything else text). */
export function toCellText(cell: unknown): string {
  return text(cell);
}
