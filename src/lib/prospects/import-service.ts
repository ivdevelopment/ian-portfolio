import "server-only";

import { requireAdmin } from "@/lib/auth";
import { toProspectRow } from "@/lib/schemas/prospect";
import { parseCsv } from "./csv";
import { findBatchDuplicates, findDuplicates, type DuplicateReason } from "./duplicates";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, autoMapColumns, buildCandidate, type ColumnMapping, type ImportCandidate } from "./import";
import { listComparable } from "./queries";
import { readFirstSheet, type ParsedSheet } from "./xlsx";
import { brusselsToday } from "./dates";

export class ImportError extends Error {}

export type UploadedSheet = ParsedSheet & { fileName: string };

/** Reads an uploaded CSV or XLSX. The wizard is the only way in, and PDFs are deliberately not accepted. */
export async function readUpload(file: File): Promise<UploadedSheet> {
  const name = file.name || "upload";
  if (file.size === 0) throw new ImportError("The file is empty.");
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError("The file is larger than 5 MB.");
  const lower = name.toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());

  if (lower.endsWith(".xlsx")) {
    if (bytes.subarray(0, 2).toString("latin1") !== "PK") throw new ImportError("That is not a valid .xlsx workbook.");
    try {
      return { ...(await readFirstSheet(bytes)), fileName: name };
    } catch (error) {
      throw new ImportError(error instanceof Error ? error.message : "The workbook couldn't be read.");
    }
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    let grid: string[][];
    try {
      grid = parseCsv(bytes.toString("utf8"));
    } catch (error) {
      throw new ImportError(error instanceof Error ? error.message : "The CSV couldn't be read.");
    }
    if (grid.length === 0) throw new ImportError("The file is empty.");
    if (grid.length - 1 > MAX_IMPORT_ROWS) throw new ImportError(`The file has more than ${MAX_IMPORT_ROWS} rows. Split it and import in parts.`);
    return { headers: grid[0], rows: grid.slice(1), sheetName: "CSV", fileName: name };
  }
  throw new ImportError("Upload a .csv or .xlsx file.");
}

export function parseMapping(raw: unknown, columnCount: number): ColumnMapping {
  const out: ColumnMapping = {};
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < columnCount) (out as Record<string, number>)[key] = value;
    }
  }
  return out;
}

export type ValidatedRow = {
  row: number;
  company: string;
  email: string;
  errors: string[];
  warnings: string[];
  duplicate: null | { kind: "existing" | "batch"; label: string; reasons: DuplicateReason[]; matchId?: string };
};

export type ValidationReport = {
  rows: ValidatedRow[];
  parsed: number;
  valid: number;
  invalid: number;
  duplicates: number;
};

/** Validates every row and flags likely duplicates (existing prospects and earlier rows of the same file). */
export async function evaluate(sheet: ParsedSheet, mapping: ColumnMapping) {
  const existing = await listComparable();
  const candidates: ImportCandidate[] = sheet.rows.map((cells, i) => buildCandidate(cells, mapping, i + 2));

  const comparable = candidates.map((c) => ({ company_name: c.values.companyName, email: c.values.email || null, website_url: c.values.websiteUrl || null }));
  const batch = findBatchDuplicates(comparable);

  const rows: ValidatedRow[] = candidates.map((c, i) => {
    let duplicate: ValidatedRow["duplicate"] = null;
    if (c.input) {
      const match = findDuplicates(comparable[i], existing)[0];
      if (match) duplicate = { kind: "existing", label: match.match.company_name, reasons: match.reasons, matchId: match.match.id };
      else if (batch.has(i)) {
        const hit = batch.get(i)!;
        duplicate = { kind: "batch", label: `${candidates[hit.of].values.companyName} (row ${candidates[hit.of].row})`, reasons: hit.reasons };
      }
    }
    return { row: c.row, company: c.values.companyName, email: c.values.email, errors: c.errors, warnings: c.warnings, duplicate };
  });

  return {
    candidates,
    report: {
      rows,
      parsed: rows.length,
      valid: rows.filter((r) => r.errors.length === 0).length,
      invalid: rows.filter((r) => r.errors.length > 0).length,
      duplicates: rows.filter((r) => r.duplicate).length,
    } satisfies ValidationReport,
  };
}

export type CommitResult = { parsed: number; imported: number; skipped: number; duplicates: number; warnings: string[] };

/**
 * Inserts the confirmed rows. The server re-validates everything itself: the client only says which duplicate
 * rows to bring in anyway (by row number). Duplicates are skipped unless explicitly allowed; nothing is merged.
 */
export async function commit(sheet: UploadedSheet, mapping: ColumnMapping, importDuplicateRows: ReadonlySet<number>): Promise<CommitResult> {
  const { supabase, userId } = await requireAdmin();
  const { candidates, report } = await evaluate(sheet, mapping);
  const today = brusselsToday();

  const insertable = candidates.filter((c, i) => c.input && (!report.rows[i].duplicate || importDuplicateRows.has(c.row)));
  const warnings: string[] = [];
  for (const [i, c] of candidates.entries()) {
    const r = report.rows[i];
    for (const e of c.errors) warnings.push(`Row ${c.row} skipped: ${e}`);
    for (const w of c.warnings) warnings.push(`Row ${c.row}: ${w}`);
    if (r.duplicate && !importDuplicateRows.has(c.row) && c.input) warnings.push(`Row ${c.row} skipped as a likely duplicate of ${r.duplicate.label}.`);
  }

  let imported = 0;
  if (insertable.length > 0) {
    const { data, error } = await supabase
      .from("prospects")
      .insert(insertable.map((c) => ({ ...toProspectRow(c.input!), source: c.input!.source ?? `Import: ${sheet.fileName}`.slice(0, 160) })))
      .select("id");
    if (error) {
      console.error("[prospects] import insert failed:", error.code);
      throw new ImportError("The import couldn't be saved, so nothing was imported. Please try again.");
    }
    imported = data.length;

    // A "last action" column becomes a real activity on the day of the last contact (never a made-up time).
    const actions = insertable
      .map((c, i) => ({ c, id: data[i]?.id }))
      .filter(({ c, id }) => id && c.lastAction)
      .map(({ c, id }) => ({
        prospect_id: id!,
        type: "other" as const,
        title: c.lastAction.slice(0, 200),
        description: "Imported from the file's last-action column.",
        occurred_on: c.input!.lastContactOn ?? today,
        metadata: { imported: true } as never,
      }));
    if (actions.length > 0) await supabase.from("prospect_activities").insert(actions);
  }

  const skipped = candidates.length - imported;
  await supabase.from("prospect_imports").insert({
    source: "file import",
    file_name: sheet.fileName,
    rows_parsed: candidates.length,
    rows_imported: imported,
    rows_skipped: skipped,
    duplicates: report.duplicates,
    warnings: warnings.slice(0, 200) as never,
    created_by: userId,
  });

  return { parsed: candidates.length, imported, skipped, duplicates: report.duplicates, warnings: warnings.slice(0, 200) };
}

export { autoMapColumns };
