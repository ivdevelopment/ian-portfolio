import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseCsv } from "@/lib/prospects/csv";
import { PROSPECT_EXPORT_COLUMNS, activityRow, prospectsToCsv, prospectsToJson } from "@/lib/prospects/export";
import { autoMapColumns, buildCandidate } from "@/lib/prospects/import";
import type { ActivityRecord, ProspectRecord } from "@/lib/prospects/types";
import { buildProspectWorkbook, readFirstSheet } from "@/lib/prospects/xlsx";

const base: ProspectRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  company_name: "Geert Kips",
  sector: "Bouw",
  city: null,
  website_url: null,
  email: "geert@geertkips.be",
  contact_name: null,
  phone: null,
  status: "replied",
  priority: "normal",
  first_contact_on: "2026-10-30",
  last_contact_on: "2026-10-31",
  next_follow_up_on: "2026-11-06",
  estimated_value_eur: 1500.5,
  quote_value_eur: null,
  contact_delivery_status: "needs_verification",
  source: null,
  notes: "Getoond in Zoho Drafts; verifieer of bericht in Verzonden staat.",
  linked_project_id: null,
  linked_preview_id: null,
  legacy_ref: null,
  last_activity_on: null,
  last_activity_title: null,
  created_at: "2026-10-31T10:00:00.000Z",
  updated_at: "2026-10-31T11:00:00.000Z",
};
const evil: ProspectRecord = { ...base, id: "22222222-2222-4222-8222-222222222222", company_name: "=cmd|' /C calc'!A0", notes: "+1+1", sector: "-bad", email: "@x" };
const activity: ActivityRecord = {
  id: "a1", prospect_id: base.id, type: "status_changed", title: "Status changed", description: null, occurred_on: "2026-10-31", occurred_at: null,
  metadata: { from: "contacted", to: "replied" }, created_at: "2026-10-31T10:00:00Z",
};

describe("export contents", () => {
  it("exports every useful CRM field", () => {
    const headers = PROSPECT_EXPORT_COLUMNS.map((c) => c.header);
    for (const h of ["Company", "Sector", "City", "Website", "Email", "Contact person", "Status", "Priority", "First contact", "Last contact", "Next follow-up", "Estimated value (EUR)", "Quote value (EUR)", "Notes", "Created", "Updated"]) {
      expect(headers).toContain(h);
    }
  });

  it("CSV has the fields, no activity history, and neutralises formulas", () => {
    const rows = parseCsv(prospectsToCsv([base, evil]));
    expect(rows[0]).toContain("Company");
    expect(rows).toHaveLength(3);
    expect(rows[1][0]).toBe("Geert Kips");
    expect(rows[1][rows[0].indexOf("Status")]).toBe("Replied");
    expect(rows[1][rows[0].indexOf("Estimated value (EUR)")]).toBe("1500.5");
    expect(rows[1][rows[0].indexOf("Notes")]).toContain("verifieer");
    expect(rows[2][0].startsWith("'=")).toBe(true);
    expect(rows[2][rows[0].indexOf("Notes")]).toBe("'+1+1");
    expect(rows[2][rows[0].indexOf("Sector")]).toBe("'-bad");
    expect(rows.flat().some((c) => /Status changed/.test(c))).toBe(false);
  });

  it("JSON carries activities only when asked", () => {
    const without = JSON.parse(prospectsToJson([base]));
    expect(without.count).toBe(1);
    expect(without.prospects[0].activities).toBeUndefined();
    const withActivities = JSON.parse(prospectsToJson([base], new Map([[base.id, [activity]]])));
    expect(withActivities.prospects[0].activities).toEqual([
      { date: "2026-10-31", type: "status_changed", title: "Status changed: Contacted → Replied", description: null, metadata: { from: "contacted", to: "replied" } },
    ]);
  });

  it("describes status changes readably in the activity sheet rows", () => {
    expect(activityRow(activity, "Geert Kips")).toEqual(["Geert Kips", "2026-10-31", "status_changed", "Status changed: Contacted → Replied", null]);
  });
});

describe("XLSX export", () => {
  it("writes a Prospects and an Activities sheet with real dates and numeric euro cells", async () => {
    const buffer = await buildProspectWorkbook([base], new Map([[base.id, [activity]]]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Prospects", "Activities"]);

    const sheet = wb.getWorksheet("Prospects")!;
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    const cell = (header: string) => sheet.getRow(2).getCell(headers.indexOf(header) + 1);

    expect(cell("First contact").value).toBeInstanceOf(Date);
    expect((cell("First contact").value as Date).toISOString().slice(0, 10)).toBe("2026-10-30");
    expect(cell("Next follow-up").numFmt).toBe("yyyy-mm-dd");
    expect(typeof cell("Estimated value (EUR)").value).toBe("number");
    expect(cell("Estimated value (EUR)").value).toBe(1500.5);
    expect(cell("Quote value (EUR)").value).toBeNull();
    expect(String(cell("Status").value)).toBe("Replied");

    const log = wb.getWorksheet("Activities")!;
    expect(log.getRow(2).getCell(1).value).toBe("Geert Kips");
    expect(log.getRow(2).getCell(2).value).toBeInstanceOf(Date);
    expect(String(log.getRow(2).getCell(4).value)).toContain("Contacted → Replied");
  });

  it("omits the Activities sheet when no history is requested, and neutralises formula-looking text", async () => {
    const buffer = await buildProspectWorkbook([evil]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Prospects"]);
    const row = wb.getWorksheet("Prospects")!.getRow(2);
    expect(String(row.getCell(1).value).startsWith("'=")).toBe(true);
    for (let i = 1; i <= 19; i++) {
      const v = row.getCell(i).value;
      expect(typeof v === "object" && v !== null && "formula" in (v as object)).toBe(false);
    }
  });

  it("round-trips: an exported workbook re-imports with the same data (dates stay days)", async () => {
    const buffer = await buildProspectWorkbook([base]);
    const sheet = await readFirstSheet(buffer);
    expect(sheet.headers[0]).toBe("Company");
    const mapping = autoMapColumns(sheet.headers);
    const candidate = buildCandidate(sheet.rows[0], mapping, 2);
    expect(candidate.errors).toEqual([]);
    expect(candidate.input).toMatchObject({
      companyName: "Geert Kips", status: "replied", firstContactOn: "2026-10-30", nextFollowUpOn: "2026-11-06",
      estimatedValue: 1500.5, deliveryStatus: "needs_verification",
    });
  });
});

describe("XLSX import limits", () => {
  it("rejects an empty workbook", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Empty");
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(readFirstSheet(buffer)).rejects.toThrow(/empty/i);
  });
});
