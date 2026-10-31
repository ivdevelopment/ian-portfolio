/** Dependency-free CSV reading and writing, with protection against spreadsheet formula injection. */

export type CsvCell = string | number | null | undefined;

/**
 * A cell that a spreadsheet would run as a formula (starts with = + - @, or a tab / carriage return that
 * some programs strip first) is prefixed with an apostrophe so it stays inert text.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value) : neutralizeFormula(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 with a BOM and CRLF line ends so Excel opens accents correctly. `;` is not used as a delimiter. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Picks the delimiter used by the first line (Belgian Excel writes `;`). */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => {
    let n = 0;
    let quoted = false;
    for (const c of first) {
      if (c === '"') quoted = !quoted;
      else if (c === ch && !quoted) n++;
    }
    return n;
  };
  const options: Array<"," | ";" | "\t"> = [",", ";", "\t"];
  return options.reduce((best, d) => (count(d) > count(best) ? d : best), ",");
}

export class CsvError extends Error {}

/** RFC 4180 parser: quoted fields, doubled quotes, embedded newlines. Blank lines are skipped. */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;

  const endField = () => {
    row.push(field);
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c !== "") || wasQuoted) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      quoted = true;
      wasQuoted = true;
    } else if (c === sep) endField();
    else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (c === "\n") endRow();
    else field += c;
  }
  if (quoted) throw new CsvError("The file has an unclosed quote.");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
