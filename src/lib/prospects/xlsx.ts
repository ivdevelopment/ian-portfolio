import "server-only";

import ExcelJS from "exceljs";
import { neutralizeFormula } from "./csv";
import { ACTIVITY_EXPORT_HEADERS, PROSPECT_EXPORT_COLUMNS, activityRow } from "./export";
import { MAX_IMPORT_ROWS, toCellText } from "./import";
import { isIsoDay } from "./dates";
import type { ActivityRecord, ProspectRecord } from "./types";

const day = (value: string): Date => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const safeText = (value: string | null): string | null => (value === null ? null : neutralizeFormula(value));

/** "Prospects" (+ "Activities") workbook: real dates, EUR numeric cells, formula-safe text. Never HTML. */
export async function buildProspectWorkbook(
  prospects: readonly ProspectRecord[],
  activities?: ReadonlyMap<string, ActivityRecord[]>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ianverlinden.com";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Prospects", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = PROSPECT_EXPORT_COLUMNS.map((c) => ({
    header: c.header,
    key: c.header,
    width: c.kind === "text" ? (c.header === "Notes" ? 50 : 22) : 16,
    style:
      c.kind === "date"
        ? { numFmt: "yyyy-mm-dd" }
        : c.kind === "datetime"
          ? { numFmt: "yyyy-mm-dd hh:mm" }
          : c.kind === "money"
            ? { numFmt: '"€" #,##0.00' }
            : {},
  }));
  sheet.getRow(1).font = { bold: true };

  for (const p of prospects) {
    sheet.addRow(
      PROSPECT_EXPORT_COLUMNS.map((c) => {
        const value = c.value(p);
        if (value === null) return null;
        if (c.kind === "date") return day(String(value));
        if (c.kind === "datetime") return new Date(String(value));
        if (c.kind === "money") return value;
        return safeText(String(value));
      }),
    );
  }

  if (activities) {
    const log = wb.addWorksheet("Activities", { views: [{ state: "frozen", ySplit: 1 }] });
    log.columns = ACTIVITY_EXPORT_HEADERS.map((h) => ({ header: h, key: h, width: h === "Description" ? 60 : h === "Title" ? 40 : 22 }));
    log.getRow(1).font = { bold: true };
    const names = new Map(prospects.map((p) => [p.id, p.company_name]));
    for (const [id, list] of activities) {
      for (const a of list) {
        const row = activityRow(a, names.get(id) ?? "");
        log.addRow([safeText(row[0]), isIsoDay(row[1]) ? day(row[1]) : row[1], row[2], safeText(row[3]), safeText(row[4])]);
      }
    }
    log.getColumn(2).numFmt = "yyyy-mm-dd";
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type ParsedSheet = { headers: string[]; rows: string[][]; sheetName: string };

/** Reads the first worksheet. Dates become ISO days, formulas their cached result; everything is text for the wizard. */
export async function readFirstSheet(buffer: Buffer | ArrayBuffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("The workbook has no worksheets.");

  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let i = 1; i <= sheet.columnCount; i++) {
      const cell = row.getCell(i);
      let value: unknown = cell.value;
      if (value && typeof value === "object" && !(value instanceof Date)) {
        const v = value as { result?: unknown; text?: unknown; richText?: Array<{ text: string }>; hyperlink?: string };
        value = v.result ?? v.text ?? (v.richText ? v.richText.map((r) => r.text).join("") : (v.hyperlink ?? ""));
      }
      cells.push(toCellText(value));
    }
    grid.push(cells);
  });
  if (grid.length === 0) throw new Error("The first worksheet is empty.");
  if (grid.length - 1 > MAX_IMPORT_ROWS) throw new Error(`The file has more than ${MAX_IMPORT_ROWS} rows. Split it and import in parts.`);
  return { headers: grid[0], rows: grid.slice(1), sheetName: sheet.name };
}
