import { DELIVERY_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "./constants";
import { toCsv, type CsvCell } from "./csv";
import type { ActivityRecord, ProspectRecord } from "./types";

export const EXPORT_FORMATS = ["csv", "xlsx", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportColumn = {
  header: string;
  kind: "text" | "date" | "money" | "datetime";
  value: (p: ProspectRecord) => string | number | null;
};

/** Useful CRM fields, in the order a person expects. Dates stay calendar days; amounts stay numbers. */
export const PROSPECT_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Company", kind: "text", value: (p) => p.company_name },
  { header: "Sector", kind: "text", value: (p) => p.sector },
  { header: "City", kind: "text", value: (p) => p.city },
  { header: "Website", kind: "text", value: (p) => p.website_url },
  { header: "Email", kind: "text", value: (p) => p.email },
  { header: "Contact person", kind: "text", value: (p) => p.contact_name },
  { header: "Phone", kind: "text", value: (p) => p.phone },
  { header: "Status", kind: "text", value: (p) => STATUS_LABELS[p.status] },
  { header: "Priority", kind: "text", value: (p) => PRIORITY_LABELS[p.priority] },
  { header: "First contact", kind: "date", value: (p) => p.first_contact_on },
  { header: "Last contact", kind: "date", value: (p) => p.last_contact_on },
  { header: "Next follow-up", kind: "date", value: (p) => p.next_follow_up_on },
  { header: "Estimated value (EUR)", kind: "money", value: (p) => p.estimated_value_eur },
  { header: "Quote value (EUR)", kind: "money", value: (p) => p.quote_value_eur },
  { header: "Sending confirmed", kind: "text", value: (p) => p.contact_delivery_status },
  { header: "Source", kind: "text", value: (p) => p.source },
  { header: "Notes", kind: "text", value: (p) => p.notes },
  { header: "Created", kind: "datetime", value: (p) => p.created_at },
  { header: "Updated", kind: "datetime", value: (p) => p.updated_at },
];

export const ACTIVITY_EXPORT_HEADERS = ["Company", "Date", "Type", "Title", "Description"] as const;

export function activityRow(a: ActivityRecord, companyName: string): Array<string | null> {
  return [companyName, a.occurred_on, a.type, activityExportTitle(a), a.description];
}

function activityExportTitle(a: ActivityRecord): string {
  if (a.type === "status_changed") {
    const from = a.metadata.from as keyof typeof STATUS_LABELS | undefined;
    const to = a.metadata.to as keyof typeof STATUS_LABELS | undefined;
    if (from && to) return `Status changed: ${STATUS_LABELS[from] ?? from} → ${STATUS_LABELS[to] ?? to}`;
  }
  return a.title;
}

export function prospectsToCsv(prospects: readonly ProspectRecord[]): string {
  const rows: CsvCell[][] = [PROSPECT_EXPORT_COLUMNS.map((c) => c.header)];
  for (const p of prospects) rows.push(PROSPECT_EXPORT_COLUMNS.map((c) => c.value(p)));
  return toCsv(rows);
}

export function prospectsToJson(prospects: readonly ProspectRecord[], activities?: ReadonlyMap<string, ActivityRecord[]>): string {
  const body = prospects.map((p) => {
    const record: Record<string, unknown> = {
      company: p.company_name,
      sector: p.sector,
      city: p.city,
      website: p.website_url,
      email: p.email,
      contact: p.contact_name,
      phone: p.phone,
      status: p.status,
      priority: p.priority,
      first_contact: p.first_contact_on,
      last_contact: p.last_contact_on,
      next_follow_up: p.next_follow_up_on,
      estimated_value_eur: p.estimated_value_eur,
      quote_value_eur: p.quote_value_eur,
      sending_confirmed: p.contact_delivery_status,
      source: p.source,
      notes: p.notes,
      created: p.created_at,
      updated: p.updated_at,
    };
    if (activities) {
      record.activities = (activities.get(p.id) ?? []).map((a) => ({
        date: a.occurred_on,
        type: a.type,
        title: activityExportTitle(a),
        description: a.description,
        metadata: a.metadata,
      }));
    }
    return record;
  });
  return JSON.stringify({ exported_at: new Date().toISOString(), count: body.length, prospects: body }, null, 2);
}

export const delivery = (p: ProspectRecord) => DELIVERY_LABELS[p.contact_delivery_status];
